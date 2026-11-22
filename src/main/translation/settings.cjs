const fs = require('node:fs');
const path = require('node:path');
const {languages,names} = require('./providers.cjs');
const {freeNames} = require('./free-providers.cjs');
class TranslationSettings {
  constructor(directory, vault) {
    this.file = path.join(directory,'translation.json');
    this.vault = vault;
  }
  read() {
    try {
      const saved=JSON.parse(fs.readFileSync(this.file,'utf8'));
      saved.engine ??= Object.keys(saved.keys || {}).length ? 'keyed' : 'googleFree';
      saved.voice ??= 'en';
      return saved;
    }
    catch (e) { if (e.code === 'ENOENT') return {engine:'googleFree',auto:false,incoming:'zh-CN',draft:'en',voice:'en',region:'',keys:{}}; throw new Error('无法读取翻译设置'); }
  }
  public() {
    const {engine,auto,incoming,draft,voice,region,keys} = this.read();
    return {engine,auto,incoming,draft,voice,region, languages:Object.entries(languages).map(([id,[name]])=>({id,name})),
      providers:Object.entries(names).map(([id,name])=>({id,name,configured:!!keys[id]}))};
  }
  save(input) {
    if (!Object.hasOwn(languages,input.incoming) || !Object.hasOwn(languages,input.draft)) throw new Error('请选择支持的目标语言');
    const next = this.read();
    for (const id of Object.keys(names)) {
      const key = input.keys?.[id];
      if (key === undefined) continue;
      if (key === null) { delete next.keys[id]; continue; }
      if (typeof key !== 'string' || key.length > 4096 || !key.trim()) throw new Error('API Key 格式无效');
      if (!this.vault.isEncryptionAvailable()) throw new Error('系统密钥存储暂不可用');
      next.keys[id] = this.vault.encryptString(key.trim()).toString('base64');
    }
    const engine=input.engine ?? next.engine;
    if (engine !== 'keyed' && !Object.hasOwn(freeNames,engine)) throw new Error('请选择翻译服务');
    if (engine==='keyed' && !Object.values(next.keys).some(Boolean)) throw new Error('请先配置至少一个翻译服务');
    Object.assign(next,{engine,auto:input.auto === true,incoming:input.incoming,draft:input.draft,region:String(input.region || '').trim().slice(0,80)});
    fs.writeFileSync(this.file+'.tmp',JSON.stringify(next),{mode:0o600});
    fs.renameSync(this.file+'.tmp',this.file);
    return this.public();
  }
  // 'none' keeps dictated text in the spoken language.
  setVoice(value) {
    if (value !== 'none' && !Object.hasOwn(languages,value)) throw new Error('请选择支持的目标语言');
    const next = this.read();
    next.voice = value;
    fs.writeFileSync(this.file+'.tmp',JSON.stringify(next),{mode:0o600});
    fs.renameSync(this.file+'.tmp',this.file);
    return this.public();
  }
  decrypt(value) { return this.vault.decryptString(Buffer.from(value,'base64')); }
}
module.exports = {TranslationSettings};

