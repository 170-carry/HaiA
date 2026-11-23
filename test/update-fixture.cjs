const {generateKeyPairSync,sign,createHash} = require('node:crypto');
const {targets,endpoint} = require('../src/main/updates/manifest.cjs');
function fixture(version='0.10.0') {
  const {publicKey,privateKey}=generateKeyPairSync('ed25519');
  const bytes=Buffer.from('fixture update bytes');
  const platforms={};
  for(const [target,suffix] of Object.entries(targets)) {
    platforms[target]={name:'HaiA-'+version+'-'+suffix,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
  }
  const manifest={format:1,app:'com.relaydesk.desktop',version,platforms};
  function envelope(value=manifest) {
    const payload=Buffer.from(JSON.stringify(value));
    return {payload:payload.toString('base64'),signature:sign(null,payload,privateKey).toString('base64')};
  }
  return {publicKey,bytes,manifest,envelope,fetch:async url=>url===endpoint?Response.json(envelope()):new Response(bytes)};
}
module.exports={fixture};
