// Moves a signed-in account from one data folder to another, as between two computers.
// Run with an empty fixture directory and a phase: export, then import.
process.env.HAIA_TEST='1';
const {app, BrowserWindow, dialog, session, webContents}=require('electron');
const fs=require('node:fs'), path=require('node:path'), assert=require('node:assert/strict');
const [dir, phase]=process.argv.slice(2);
if(!dir || !['export','import'].includes(phase)) throw new Error('需要测试目录和阶段');
const profile=path.join(dir,phase==='export'?'computer-a':'computer-b'), file=path.join(dir,'accounts.haia');
fs.mkdirSync(profile,{recursive:true});
app.setPath('userData',profile);
app.on('session-created',s=>{
  if(s!==session.defaultSession && !s.storagePath.includes('snapshot-')) s.protocol.handle('https',()=>new Response('<html>fixture</html>',{headers:{'Content-Type':'text/html'}}));
});
const read=fs.readFileSync, bundle=require.resolve('@wppconnect/wa-js');
fs.readFileSync=function(f,...args){return read.call(fs,f===bundle?path.join(__dirname,'mock-provider.js'):f,...args)};
dialog.showSaveDialog=async()=>({filePath:file});
dialog.showOpenDialog=async()=>({filePaths:[file]});
require('../src/main/app.cjs');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn) {
  for(let i=0;i<200;i++){const result=await fn(); if(result)return result; await pause(100);}
  throw new Error('Timeout: '+fn);
}
const shot=async(wc,name)=>{ if(process.env.RELAY_UI_CAPTURE){ BrowserWindow.fromWebContents(wc).show(); BrowserWindow.fromWebContents(wc).focus(); await wc.executeJavaScript("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))"); await pause(1200); fs.writeFileSync(path.join(process.env.RELAY_UI_CAPTURE,name),(await wc.capturePage()).toPNG()); } };
const page=id=>until(()=>webContents.getAllWebContents().find(w=>!w.isDestroyed() && w.session===session.fromPartition('persist:wa-'+id) && w.getURL().startsWith('https:')));
// A record in IndexedDB stands for WhatsApp's keys and local messages, which live there.
const put="new Promise((done,fail)=>{const open=indexedDB.open('wawc',1);open.onupgradeneeded=()=>open.result.createObjectStore('user');open.onerror=()=>fail(open.error);open.onsuccess=()=>{const tx=open.result.transaction('user','readwrite');tx.objectStore('user').put('kept across computers','note');tx.oncomplete=()=>{open.result.close();done(true)};};})";
const take="new Promise((done,fail)=>{const open=indexedDB.open('wawc',1);open.onupgradeneeded=()=>open.result.createObjectStore('user');open.onerror=()=>fail(open.error);open.onsuccess=()=>{const ask=open.result.transaction('user').objectStore('user').get('note');ask.onsuccess=()=>done(ask.result ?? null);};})";
(async()=>{
  await app.whenReady();
  const wc=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('file:'))?.webContents);
  const ui=code=>wc.executeJavaScript(code);
  await until(()=>ui("typeof backupHistory==='object' && !!get('open-backup').onclick && !!state"));
  if(phase==='export') {
    await ui("api.add('销售一号')");
    const id=await until(()=>ui('state.accounts[0]?.id'));
    const w=await page(id);
    await w.session.cookies.set({url:'https://web.whatsapp.com/',name:'wa_web_access_token',value:'fixture-live-access-token',domain:'.web.whatsapp.com',secure:true,httpOnly:true,sameSite:'no_restriction'});
    await until(()=>w.executeJavaScript("typeof window.sample==='function' && typeof window.relayReader==='object'").catch(()=>false));
    await w.executeJavaScript("localStorage.owner='123456@c.us';sample('carried message','one');true");
    assert.equal(await w.executeJavaScript(put),true);
    await w.executeJavaScript(`(async()=>{
      const write=async(name,store,value,key='fixture')=>{const db=await new Promise(resolve=>{const q=indexedDB.open(name,1);q.onupgradeneeded=()=>{q.result.createObjectStore(store);if(name==='model-storage')q.result.createObjectStore('user-prefs')};q.onsuccess=()=>resolve(q.result)});await new Promise((resolve,reject)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).put(value,key);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error)});db.close();};
      await write('model-storage','message','private history excluded from login export');
      await write('model-storage','user-prefs','required-registration-key','WAADVSecretKey');
      await write('model-storage','user-prefs',{initialCompleted:true,recentCompleted:true},'WAHistorySyncStatus');
      await write('model-storage','user-prefs',true,'WAInitialHistorySynced');
      await write('model-storage','user-prefs','private history progress excluded','WAHistorySyncTotalProcessedMessageCount');
      const key=await crypto.subtle.generateKey({name:'AES-GCM',length:128},false,['encrypt','decrypt']);
      await write('signal-storage','signal-meta-store',key);
    })()`);

    await until(()=>ui("state.accounts[0].status==='online'"));
    await ui("api.add('还没登录')");
    await until(()=>ui("state.accounts.length===2"));
    await ui("get('open-backup').click()");
    // Only the signed-in account can be ticked.
    await until(()=>ui("get('backup-dialog').open && get('backup-choices').querySelectorAll('input').length===2"));
    assert.deepEqual(await ui("[...get('backup-choices').querySelectorAll('input')].map(i=>i.disabled)"),[false,true]);
    await ui("const box=get('backup-choices').querySelector('input'); if(!box.checked) box.click()");
    await shot(wc,'account-transfer.png');
    await ui("get('backup-export').click()");
    await until(()=>ui("get('backup-status').textContent.includes('已导出 1 个账号')"));
    // The account comes back by itself after the short pause for copying.
    await until(()=>ui("state.accounts[0].status==='online'"));
    const size=fs.statSync(file).size;
    assert.ok(size>200 && size<20*1048576,'export size '+size);
    assert.equal(fs.readFileSync(file).subarray(0,13).toString(),'HaiA-login-v2');
    const payload=require('node:zlib').gunzipSync(fs.readFileSync(file).subarray(Buffer.byteLength('HaiA-login-v2\n')+32));
    assert.equal(payload.includes(Buffer.from('private history excluded from login export')),false);
    assert.equal(payload.includes(Buffer.from('private history progress excluded')),false);
    console.log('PASS: login export without message records, '+size+' bytes');
  } else {
    assert.equal(await ui('state.accounts.length'),0);
    await ui("get('open-backup').click(); get('backup-tab-import').click()");
    await until(()=>ui("get('backup-dialog').open && !get('backup-import').hidden && get('backup-owners').hidden"));
    await shot(wc,'account-transfer-import.png');
    await ui("get('backup-import').click()");
    await until(()=>ui("get('backup-status').textContent==='导入完成'"));
    // Signed in without pairing, under the same name and number, with what the page had stored.
    await until(()=>ui("state.accounts.length===1 && state.accounts[0].status==='online' && state.accounts[0].name==='销售一号'"));
    const importedId=await ui('state.accounts[0].id');
    const cookies=await session.fromPartition('persist:wa-'+importedId).cookies.get({name:'wa_web_access_token'});
    assert.equal(cookies[0]?.value,'fixture-live-access-token');
    const prefKeys=await (await page(importedId)).executeJavaScript("new Promise((resolve,reject)=>{const q=indexedDB.open('model-storage');q.onsuccess=()=>{const db=q.result,ask=db.transaction('user-prefs').objectStore('user-prefs').getAllKeys();ask.onsuccess=()=>{db.close();resolve(ask.result)};ask.onerror=()=>reject(ask.error)};q.onerror=()=>reject(q.error)})");
    assert.deepEqual(prefKeys,['WAADVSecretKey','WAHistorySyncStatus','WAInitialHistorySynced']);
    const id=await ui('state.accounts[0].id'), w=await page(id);
    assert.equal(await w.executeJavaScript('localStorage.owner'),'123456@c.us');
    assert.equal(await w.executeJavaScript(take),'kept across computers');
    const verified=await w.executeJavaScript(`(async()=>{
      const read=async(name,store)=>{const db=await new Promise(resolve=>{const q=indexedDB.open(name,1);q.onsuccess=()=>resolve(q.result)});const data=await new Promise(resolve=>{const q=db.transaction(store).objectStore(store).get('fixture');q.onsuccess=()=>resolve(q.result)});db.close();return data;};
      const key=await read('signal-storage','signal-meta-store');
      const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv:new Uint8Array(12)},key,new Uint8Array([1,2,3]));
      return {extractable:key.extractable,usable:encrypted.byteLength>0,noHistory:(await read('model-storage','message'))===undefined};
    })()`);
    assert.deepEqual(verified,{extractable:false,usable:true,noHistory:true});
    // Importing the same file again leaves the signed-in account alone.
    await ui("get('backup-import').click()");
    await until(()=>ui("get('backup-status').textContent==='导入完成'"));
    assert.equal(await ui('state.accounts.length'),1);
    console.log('PASS: login import on a second data folder, signed in with stored data');
  }
  app.exit(0);
})().catch(error=>{console.error(error.stack || error.message || String(error));app.exit(1);});
