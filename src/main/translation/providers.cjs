const languages = {
  'zh-CN':['简体中文','ZH-HANS','zh-Hans'], 'zh-TW':['繁體中文','ZH-HANT','zh-Hant'],
  en:['English','EN-US','en'], ja:['日本語','JA','ja'], ko:['한국어','KO','ko'],
  es:['Español','ES','es'], fr:['Français','FR','fr'], de:['Deutsch','DE','de'],
  pt:['Português','PT-BR','pt'], ar:['العربية','AR','ar'], id:['Indonesia','ID','id']
};
const names = {deepl:'DeepL',azure:'Microsoft Translator',google:'Google Cloud Translation',caiyun:'彩云小译'};
const contracts = {
  deepl(key,text,target) {
    const host = key.endsWith(':fx') ? 'api-free.deepl.com' : 'api.deepl.com';
    return {url:'https://' + host + '/v2/translate', headers:{Authorization:'DeepL-Auth-Key '+key},
      body:{text:[text],target_lang:languages[target][1]}, extract:data=>data.translations?.[0]?.text};
  },
  azure(key,text,target,region) {
    const headers = {'Ocp-Apim-Subscription-Key':key};
    if (region) headers['Ocp-Apim-Subscription-Region'] = region;
    return {url:'https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&to='+languages[target][2],
      headers, body:[{Text:text}], extract:data=>data[0]?.translations?.[0]?.text};
  },
  caiyun(key,text,target) {
    const lang = {'zh-CN':'zh','zh-TW':'zh-Hant',en:'en',ja:'ja',ko:'ko'}[target];
    if (!lang) throw Object.assign(new Error('该目标语言暂不支持'),{status:422});
    return {url:'https://api.interpreter.caiyunai.com/v1/translator',headers:{'X-Authorization':'token '+key},
      body:{source:[text],trans_type:'auto2'+lang,detect:true,request_id:require('node:crypto').randomUUID()},extract:data=>data.target?.[0]};
  },
  google(key,text,target) {
    return {url:'https://translation.googleapis.com/language/translate/v2', headers:{'X-Goog-Api-Key':key},
      body:{q:text,target,format:'text'}, extract:data=>data.data?.translations?.[0]?.translatedText};
  }
};
function decodeGoogleText(value) {
  const named = {amp:'&',quot:'"',apos:"'",lt:'<',gt:'>'};
  return value.replace(/&(amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi,(entity,code)=>{
    if (code[0] !== '#') return named[code.toLowerCase()];
    const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2),16) : Number(code.slice(1));
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
  });
}
async function requestTranslation(fetcher, id, key, text, target, region) {
  const request = contracts[id](key,text,target,region);
  const response = await fetcher(request.url, {method:'POST',headers:{'Content-Type':'application/json',...request.headers},
    body:JSON.stringify(request.body), redirect:'error',signal:AbortSignal.timeout(10000)});
  if (!response.ok) throw Object.assign(new Error('翻译服务请求失败'),{status:response.status});
  const value = request.extract(await response.json());
  if (typeof value !== 'string' || !value.trim()) throw new Error('翻译服务返回空内容');
  return id === 'google' ? decodeGoogleText(value) : value;
}
module.exports = {languages,names,requestTranslation};

