// Sign the hashes of the final installers. Only the public key is distributed with HaiA.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {createHash,sign} = require('node:crypto');
const {targets,verifyManifest} = require('../src/main/updates/manifest.cjs');
const {version} = require('../package.json');
async function main() {
  const dir = path.resolve(__dirname,'../dist',version);
  const privatePath = process.env.HAIA_UPDATE_KEY_FILE || path.join(os.homedir(),'Library','Application Support','HaiA Release','update-ed25519.pem');
  const publicKey = fs.readFileSync(path.join(__dirname,'../src/main/updates/public.pem'));
  const platforms = {};
  for (const [target,suffix] of Object.entries(targets)) {
    const name = 'HaiA-'+version+'-'+suffix, file = path.join(dir,name), hash = createHash('sha256');
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
    platforms[target] = {name,size:fs.statSync(file).size,sha256:hash.digest('hex')};
  }
  const payload = Buffer.from(JSON.stringify({format:1,app:'com.relaydesk.desktop',version,platforms}));
  const envelope = {payload:payload.toString('base64'),signature:sign(null,payload,fs.readFileSync(privatePath)).toString('base64')};
  for (const target of Object.keys(targets)) verifyManifest(envelope,publicKey,target,version);
  await fs.promises.writeFile(path.join(dir,'latest.json.tmp'),JSON.stringify(envelope)+'\n');
  await fs.promises.rename(path.join(dir,'latest.json.tmp'),path.join(dir,'latest.json'));
  console.log('Signed dist/'+version+'/latest.json');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
