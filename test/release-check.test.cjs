const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os=require('node:os'), path=require('node:path');
const {fixture}=require('./update-fixture.cjs');
const {verifyManifest,targets,endpoint}=require('../src/main/updates/manifest.cjs');
const {verifyFile}=require('../src/main/updates/download.cjs');
const {updateRoutes}=require('../src/main/updates/service.cjs');

test('only signed stable forward updates for the matching architecture are eligible',()=>{
  const f=fixture(), env=f.envelope();
  for(const [target,suffix] of Object.entries(targets)) {
    const release=verifyManifest(env,f.publicKey,target,'0.9.12');
    assert.equal(release.available,true);assert.ok(release.url.endsWith(suffix));
    assert.equal(verifyManifest(env,f.publicKey,target,'1.0.0').available,false);
    assert.equal(verifyManifest(env,f.publicKey,target,'0.10.0').available,false);
  }
  assert.throws(()=>verifyManifest({...env,payload:f.envelope({...f.manifest,version:'1.0.0'}).payload},f.publicKey,'darwin-arm64','0.9.12'),/签名/);
  assert.throws(()=>verifyManifest(f.envelope({...f.manifest,version:'1.0.0-beta'}),f.publicKey,'win32-x64','0.9.12'),/不匹配/);
});
test('download verifies bytes and recovers across restarts, applying only after user confirmation',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'haia-update-test-'));
  t.after(()=>fs.rm(dir,{force:true,recursive:true}));
  const f=fixture(), states=[]; let applied=0,quit=0,broken=true;
  const options={publicKey:f.publicKey,target:'darwin-arm64',
    app:{getPath:()=>dir,getVersion:()=>'0.9.12',isPackaged:true},notify:s=>states.push(s),
    quit:()=>quit++,apply:async(file,release)=>{await verifyFile(file,release);applied++;},
    fetch:async url=>broken && url!==endpoint?new Response(Buffer.alloc(f.bytes.length)):f.fetch(url)};
  let service=updateRoutes(options);
  assert.equal((await service.checkUpdate()).stage,'available');
  await assert.rejects(service.installUpdate(),/请先下载/);
  await assert.rejects(service.downloadUpdate(),/校验失败/);
  assert.equal(service.updateState().stage,'available');
  broken=false;
  assert.equal((await service.downloadUpdate()).stage,'ready');
  assert.ok(states.some(s=>s.stage==='downloading' && s.percent===100));
  service=updateRoutes(options);
  assert.equal((await service.checkUpdate()).stage,'ready');
  assert.equal(applied,0);await service.installUpdate();assert.equal(applied,1);assert.equal(quit,1);
});
