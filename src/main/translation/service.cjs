const {TranslationSettings} = require('./settings.cjs');
const {names,requestTranslation} = require('./providers.cjs');
const {freeNames,translateFree} = require('./free-providers.cjs');
const {speechService} = require('./speech.cjs');
function translationRoutes(directory,vault,fetcher=fetch) {
  const settings = new TranslationSettings(directory,vault);
  const cooldown = new Map(), transcribe = speechService(fetcher);
  async function translate(text,mode) {
    if (typeof text !== 'string' || !text.trim() || text.length > 30000) throw new Error('请选择 1 至 30000 个字符的文本');
    if (!['incoming','draft','voice'].includes(mode)) throw new Error('无效的翻译方向');
    const config = settings.read();
    const free = config.engine !== 'keyed';
    const providers = free ? [config.engine,...Object.keys(freeNames).filter(id=>id!==config.engine)] : Object.keys(names).filter(id=>config.keys[id]);
    if (!providers.length) throw new Error('请先在翻译设置中填写 API Key');
    const issues = [];
    for (const id of providers) {
      const suspended = cooldown.get(id);
      if (suspended?.until > Date.now()) { issues.push(suspended.reason); continue; }
      try {
        if (free && id==='apertium' && !['en','es','fr','de','pt'].includes(config[mode])) continue;
        const value = free ? await translateFree(fetcher,id,text,config[mode]) : await requestTranslation(fetcher,id,settings.decrypt(config.keys[id]),text,config[mode],config.region);
        return {text:value,provider:freeNames[id] || names[id],target:config[mode]};
      } catch (e) {
        const reason = (freeNames[id] || names[id]) + (e.status ? '（HTTP '+e.status+'）' : '（连接或响应异常）');
        issues.push(reason);
        if ([401,403,429,456].includes(e.status) || e.status >= 500 || !e.status) cooldown.set(id,{reason,until:Date.now()+30000});
      }
    }
    throw new Error('翻译暂不可用：'+issues.join('、')+(free ? '。请稍后重试。' : '。请检查密钥或额度。'));
  }
  // Speech becomes text first, then goes through the same translation chain as typed drafts.
  async function dictate(audio) {
    const heard = await transcribe(audio);
    const target = settings.read().voice;
    if (!heard.text) throw new Error('没有识别到语音内容，请靠近麦克风重试');
    if (target === 'none') return {...heard, translated:heard.text, target};
    try {
      const result = await translate(heard.text,'voice');
      return {...heard, translated:result.text, target, translator:result.provider};
    } catch (e) { return {...heard, translated:heard.text, target, issue:e.message}; }
  }
  return {dictate, saveVoiceLanguage:value=>settings.setVoice(value), translate, translationSettings:()=>settings.public(), saveTranslationSettings:input=>{
    const saved = settings.save(input); cooldown.clear(); return saved;
  }};
}
module.exports = {translationRoutes};

