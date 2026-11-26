const {app}=require('electron');
const path=require('node:path');
const fs=require('node:fs');
function runSnapshotWorker() {
  const at=process.argv.indexOf('--haia-login-snapshot');
  if(at<0)return false;
  const [source,target,temp]=process.argv.slice(at+1);
  if(![source,target,temp].every(p=>typeof p==='string' && path.isAbsolute(p))) {app.exit(1);return true;}
  const control=fs.mkdtempSync(path.join(temp,'worker-'));
  app.setPath('userData',control);app.setPath('sessionData',control);
  app.on('window-all-closed',()=>{});
  app.whenReady().then(()=>require('./login-stores.cjs').authSnapshot(source,target,temp))
    .then(()=>app.exit(0),error=>{console.error(error.message);app.exit(1);});
  return true;
}
module.exports={runSnapshotWorker};
