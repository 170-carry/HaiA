const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const {translationRoutes} = require('../src/main/translation/service.cjs');
const {Inbox} = require('../src/main/inbox.cjs');
test('configured providers fail over in order and secrets stay outside public settings', async t=>{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'relay-translation-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const vault = {isEncryptionAvailable:()=>true, encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()};
  const seen = [];
  let failure = 2;
  const api = translationRoutes(dir,vault,async(url,request)=>{
    seen.push([url,request]);
    if (seen.length <= failure) return new Response('',{status:429});
    const body = url.includes('deepl') ? {translations:[{text:'bonjour'}]} : url.includes('microsoft') ?
      [{translations:[{text:'bonjour'}]}] : {data:{translations:[{translatedText:'bonjour'}]}};
    return Response.json(body);
  });
  const options = {engine:'keyed',auto:true,incoming:'zh-CN',draft:'fr',region:'eastasia',keys:{deepl:'private:fx',azure:'azure-example',google:'google-example'}};
  assert.equal(api.translationSettings().engine,'googleFree');
  assert.equal(JSON.stringify(api.saveTranslationSettings(options)).includes('private:fx'),false);
  assert.equal((await api.translate('sample','draft')).provider,'Google Cloud Translation');
  assert.match(seen[0][0],/api-free.deepl.com/); assert.equal(JSON.parse(seen[0][1].body).target_lang,'FR');
  assert.equal(seen[1][1].headers['Ocp-Apim-Subscription-Region'],'eastasia');
  assert.equal(seen[2][1].headers['X-Goog-Api-Key'],'google-example');
  assert.equal(JSON.parse(seen[2][1].body).format,'text');
  assert.equal((await api.translate('repeat','incoming')).provider,'Google Cloud Translation');
  assert.equal(seen.length,4);
  api.saveTranslationSettings({...options,keys:{deepl:null}}); failure=0;
  assert.equal((await api.translate('sample','incoming')).provider,'Microsoft Translator');
  api.saveTranslationSettings(options);
  assert.equal((await api.translate('sample','draft')).provider,'DeepL');
  api.saveTranslationSettings(options); failure=100;
  await assert.rejects(api.translate('sample','draft'),/DeepL.*Microsoft Translator.*Google Cloud Translation/);
});
test('receipt events before and after message ingestion are scoped and cannot create duplicate messages',()=>{
  const inbox=new Inbox(), msg={id:'m',chat:'contact',text:'hi',title:'Contact',outgoing:true,time:1,ack:1};
  inbox.receipt('A','m',2); inbox.add('A',[msg]); inbox.add('B',[msg]);
  inbox.receipt('A','m',3); inbox.add('A',[msg]); inbox.receipt('A','m',5);
  assert.equal(inbox.page(10,'A').messages[0].ack,3); assert.equal(inbox.page(10,'B').messages[0].ack,1);
  assert.equal(inbox.page(10).count,2);
});
test('free default falls back without opening a billable provider, even with a saved key',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'relay-free-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const seen=[];
  const api=translationRoutes(dir,{isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s)},async url=>{
    const request=new URL(url); seen.push(request.hostname);
    if(request.hostname==='translate.googleapis.com')return new Response('',{status:429});
    if(request.hostname==='api.mymemory.translated.net') {
      assert.ok(Buffer.byteLength(request.searchParams.get('q'))<=500);
      return Response.json({responseStatus:200,responseData:{translatedText:'译文'}});
    }
    throw new Error('unexpected hostname');
  });
  api.saveTranslationSettings({auto:true,incoming:'zh-CN',draft:'en',keys:{azure:'example'}});
  const response=await api.translate('Hello world. '.repeat(120),'incoming');
  assert.equal(response.provider,'MyMemory');assert.ok(response.text.length>2);
  assert.deepEqual([...new Set(seen)],['translate.googleapis.com','api.mymemory.translated.net']);
  const {splitBytes}=require('../src/main/translation/free-providers.cjs');
  const multilingual='你好。 😀 Hello! '.repeat(130);
  const chunks=splitBytes(multilingual,500);
  assert.equal(chunks.join(''),multilingual);
  assert.ok(chunks.every(chunk=>Buffer.byteLength(chunk)<=500));
});
test('Apertium uses the detected language and Caiyun uses the official token and auto direction',async()=>{
  const {translateFree}=require('../src/main/translation/free-providers.cjs');
  const {requestTranslation}=require('../src/main/translation/providers.cjs');
  const result=await translateFree(async url=>{
    if(url.includes('/identifyLang'))return Response.json({eng:.95,spa:.2});
    assert.equal(new URL(url).searchParams.get('langpair'),'eng|spa');
    return Response.json({responseStatus:200,responseData:{translatedText:'Hola'}});
  },'apertium','Hello','es');
  assert.equal(result,'Hola');
  assert.equal(await requestTranslation(async(url,req)=>{
    assert.equal(req.headers['X-Authorization'],'token example');assert.equal(JSON.parse(req.body).trans_type,'auto2zh');
    return Response.json({target:['你好']});
  },'caiyun','example','hello','zh-CN'),'你好');
});


test('speech recognition falls back to the next free service and rejects non-audio input', async () => {
  const {speechService} = require('../src/main/translation/speech.cjs');
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push(url);
    if (url.includes('hf-audio')) return {ok:false,status:503};
    assert.match(options.headers['Content-Type'],/^multipart\/form-data; boundary=/);
    assert.ok(options.body.includes('whisper-large-v3'));
    return {ok:true,json:async()=>({text:' 样品周三发货 '})};
  };
  const transcribe = speechService(fetcher);
  const audio = 'data:audio/webm;codecs=opus;base64,' + Buffer.alloc(2000,1).toString('base64');
  assert.deepEqual(await transcribe(audio),{text:'样品周三发货',provider:'OVHcloud Whisper'});
  await transcribe(audio);
  assert.equal(calls.filter(url=>url.includes('hf-audio')).length,1);
  await assert.rejects(()=>transcribe('data:text/html;base64,AAAA'),/录音无效/);
});
