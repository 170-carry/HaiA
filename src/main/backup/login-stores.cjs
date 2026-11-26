const fs=require('node:fs/promises');
const path=require('node:path');
const {BrowserWindow,session,MessageChannelMain}=require('electron');
const {acceptSnapshot,sendSnapshot}=require('./login-frame.cjs');
const allowed={
  'wawc':['user','ps_meta','ps_tokens'],
  'signal-storage':null,
  'wawc_db_enc':null,
  'model-storage':['account-linking','acs-tokens','device-list','direct-connection-keys','sync-keys','coexv2-bot-secret'],
  'worker-storage':['local_storage']
};
const stores=['IndexedDB','Local Storage'];
async function copyStores(source,target) {
  await fs.mkdir(target,{recursive:true,mode:0o700});
  for(const name of stores)await fs.cp(path.join(source,name),path.join(target,name),{recursive:true,filter:file=>path.basename(file)!=='LOCK'});
}
async function authSnapshot(source,target,temp) {
  const profile=await fs.mkdtemp(path.join(temp,'snapshot-'));
  await copyStores(source,profile);
  const isolated=session.fromPath(profile,{cache:false});
  const output=target;
  await fs.mkdir(output,{recursive:true,mode:0o700});
  const clean=session.fromPath(output,{cache:false});
  isolated.protocol.handle('https',()=>new Response('<html></html>',{headers:{'Content-Type':'text/html'}}));
  clean.protocol.handle('https',()=>new Response('<html></html>',{headers:{'Content-Type':'text/html'}}));
  isolated.webRequest.onBeforeRequest({urls:['http://*/*','ws://*/*','wss://*/*']},(_,done)=>done({cancel:true}));
  const options=ses=>({show:false,webPreferences:{session:ses,sandbox:true,contextIsolation:true,nodeIntegration:false,preload:path.join(__dirname,'login-preload.cjs')}});
  const window=new BrowserWindow(options(isolated)),destination=new BrowserWindow(options(clean));
  try {
    await Promise.all([window.loadURL('https://web.whatsapp.com'),destination.loadURL('https://web.whatsapp.com')]);
    const ready="window.haiaPortReady=new Promise(resolve=>addEventListener('message',event=>{if(event.source===window&&event.data==='haia-snapshot-port'&&event.ports.length)resolve(event.ports[0]);},{once:true}));true";
    await Promise.all([window.webContents.executeJavaScript(ready),destination.webContents.executeJavaScript(ready)]);
    void destination.webContents.executeJavaScript('('+acceptSnapshot.toString()+')()');
    const {port1,port2}=new MessageChannelMain();
    window.webContents.postMessage('haia-snapshot-port',null,[port1]);
    destination.webContents.postMessage('haia-snapshot-port',null,[port2]);
    await window.webContents.executeJavaScript('('+sendSnapshot.toString()+')('+JSON.stringify(allowed)+')');
    await clean.flushStorageData();
  }finally{window.destroy();destination.destroy();isolated.protocol.unhandle('https');clean.protocol.unhandle('https');}
}
module.exports={copyStores,authSnapshot,stores};
