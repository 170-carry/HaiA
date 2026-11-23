const {verify} = require('node:crypto');
const releases = 'https://github.com/170-carry/HaiA/releases';
const endpoint = releases + '/latest/download/latest.json';
const targets = {'darwin-arm64':'arm64.dmg','darwin-x64':'x64.dmg','win32-x64':'x64.exe'};
const versionPattern = /^(?:0|[1-9]\d{0,6})\.(?:0|[1-9]\d{0,6})\.(?:0|[1-9]\d{0,6})$/;

function verifyManifest(envelope, key, target, installed) {
  if (typeof envelope?.payload !== 'string' || envelope.payload.length > 16384 || typeof envelope.signature !== 'string') throw Error('更新清单格式有误');
  const bytes = Buffer.from(envelope.payload, 'base64');
  if (!verify(null,bytes,key,Buffer.from(envelope.signature,'base64'))) throw Error('更新清单签名不正确');
  const manifest = JSON.parse(bytes.toString('utf8'));
  if (typeof manifest?.version !== 'string' || manifest.format !== 1 || manifest.app !== 'com.relaydesk.desktop' || !versionPattern.test(manifest.version) || !versionPattern.test(installed)) throw Error('更新清单与 HaiA 不匹配');
  const file = manifest.platforms?.[target], name = 'HaiA-'+manifest.version+'-'+targets[target];
  if (!targets[target] || file?.name !== name || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > 1024**3 || !/^[a-f0-9]{64}$/.test(file.sha256)) throw Error('没有适用于此平台的有效更新包');
  const current = installed.split('.').map(Number);
  const difference = manifest.version.split('.').map((v,i)=>Number(v)-current[i]).find(v=>v!==0);
  return {available:difference>0,version:manifest.version,name,size:file.size,sha256:file.sha256,
    url:releases+'/download/v'+manifest.version+'/'+name};
}
module.exports={endpoint,targets,versionPattern,verifyManifest};
