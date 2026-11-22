const freeNames = {googleFree:'Google 免费翻译',memory:'MyMemory',apertium:'Apertium'};
const targets = {en:'eng',es:'spa',fr:'fra',de:'deu',pt:'por'};
function splitBytes(text,limit) {
  const pieces=[]; let chunk='',size=0;
  for(const char of text) {
    const bytes=Buffer.byteLength(char);
    if(size+bytes>limit) {
      const boundary = Math.max(...['\n','。','！','？','. ','? ','! ',' '].map(mark=>chunk.lastIndexOf(mark)));
      const cut = boundary >= chunk.length/2 ? boundary+1 : chunk.length;
      pieces.push(chunk.slice(0,cut));
      chunk=chunk.slice(cut); size=Buffer.byteLength(chunk);
    }
    size+=bytes;chunk+=char;
  }
  if(chunk) pieces.push(chunk);
  return pieces;
}
async function json(fetcher,base,params) {
  const url=new URL(base);
  for (const [key,value] of Object.entries(params)) url.searchParams.set(key,value);
  const res=await fetcher(url.href,{redirect:'error',credentials:'omit',signal:AbortSignal.timeout(9000)});
  if (!res.ok) throw Object.assign(new Error('服务请求失败'),{status:res.status});
  return res.json();
}
function checkText(value) {
  if (typeof value!=='string' || !value.trim()) throw new Error('服务未返回有效译文');
  return value;
}
async function translateFree(fetcher,id,text,target) {
  if(id==='apertium') {
    if(!targets[target]) throw Object.assign(new Error('该语言对暂不支持'),{status:422});
    const guesses=await json(fetcher,'https://apertium.org/apy/identifyLang',{q:Array.from(text).slice(0,300).join('')});
    const [source]=Object.entries(guesses).filter(([,score])=>typeof score==='number').sort((a,b)=>b[1]-a[1])[0] || [];
    if(!source) throw Object.assign(new Error('无法识别源语言'),{status:422});
    if(source===targets[target]) return text;
    const values=[];
    for(const chunk of splitBytes(text,1450)) {
      const result=await json(fetcher,'https://apertium.org/apy/translate',{langpair:source+'|'+targets[target],q:chunk,format:'txt',markUnknown:'no'});
      if(Number(result.responseStatus)!==200) throw Object.assign(new Error('语言对暂不可用'),{status:422});
      values.push(checkText(result.responseData?.translatedText));
    }
    return values.join('');
  }
  const values=[];
  for(const chunk of splitBytes(text,id==='memory'?500:1450)) {
    if(!chunk.trim()){values.push(chunk);continue;}
    if(id==='googleFree') {
      const result=await json(fetcher,'https://translate.googleapis.com/translate_a/single',{client:'gtx',sl:'auto',tl:target,dt:'t',dj:'1',q:chunk});
      values.push(checkText(result.sentences?.map(s=>s.trans || '').join('')));
    } else {
      const result=await json(fetcher,'https://api.mymemory.translated.net/get',{q:chunk,langpair:'Autodetect|'+target});
      if(result.quotaFinished || Number(result.responseStatus)!==200) throw Object.assign(new Error('免费服务暂不可用'),{status:result.quotaFinished ? 429 : Number(result.responseStatus) || 502});
      values.push(checkText(result.responseData?.translatedText));
    }
  }
  return values.join('');
}
module.exports={freeNames,translateFree,splitBytes};

