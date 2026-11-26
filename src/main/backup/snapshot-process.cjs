const {app}=require('electron');
const {execFile}=require('node:child_process');
const fs=require('node:fs/promises');
const path=require('node:path');
const {copyStores}=require('./login-stores.cjs');
const execute=require('node:util').promisify(execFile);
async function authSnapshot(source,target,temp) {
  const args=app.isPackaged?[]:[path.join(__dirname,'../app.cjs')];
  const output=await fs.mkdtemp(path.join(temp,'ready-'));
  try {
    await execute(process.execPath,[...args,'--haia-login-snapshot',source,output,temp],{timeout:120000,maxBuffer:1024*1024,windowsHide:true});
  } catch(error) {
    throw Error('生成登录快照失败：'+(error.stderr || error.message).trim().slice(-1200));
  }
  await copyStores(output,target);
}
module.exports={authSnapshot};
