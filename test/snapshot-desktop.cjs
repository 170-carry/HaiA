process.env.HAIA_TEST='1';
const {app,BrowserWindow,session}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const dir=process.argv[2], phase=process.argv[3];
if (!dir || !['seed','upgrade','restart'].includes(phase)) throw Error('请指定隔离测试目录');
const id='56c42f11-f875-4ffc-990e-74797b6314ef', chat='10000000000@c.us';
app.setPath('userData',dir);
app.on('window-all-closed',()=>{});
app.on('session-created',ses=>{if(ses!==session.defaultSession)ses.protocol.handle('https',()=>new Response('<html></html>',{headers:{'Content-Type':'text/html'}}));});
const read=fs.readFileSync,bundle=require.resolve('@wppconnect/wa-js');
fs.readFileSync=(file,...args)=>read(file===bundle?path.join(__dirname,'mock-provider.js'):file,...args);
async function until(fn) {
  for(let i=0;i<160;i++) {const v=await fn();if(v)return v;await new Promise(r=>setTimeout(r,100));}
  throw Error('Timed out '+fn);
}
async function seed(ses) {
  fs.writeFileSync(path.join(dir,'accounts.json'),JSON.stringify([{id,name:'历史账号'}]));
  const w=new BrowserWindow({show:false,webPreferences:{session:ses,sandbox:true}});
  try {
    await w.loadURL('data:text/html,<html></html>',{baseURLForDataURL:'https://web.whatsapp.com/'});
    await w.webContents.executeJavaScript(`new Promise((resolve,reject)=>{
      const q=indexedDB.open('model-storage',1);
      q.onupgradeneeded=()=>{for(const n of ['contact','chat','message'])q.result.createObjectStore(n,{keyPath:'id'});};
      q.onsuccess=()=>{
        const db=q.result,tx=db.transaction(['contact','chat','message'],'readwrite'),chat='${chat}';
        tx.objectStore('contact').put({id:chat,pushname:'历史联系人'});
        tx.objectStore('chat').put({id:chat,unreadCount:3});
        for(let i=1;i<=137;i++)tx.objectStore('message').put({id:'false_'+chat+'_'+i,t:1700000000+i,type:'chat',body:'测试原文 '+i});
        tx.objectStore('message').put({id:'false_'+chat+'_missing',t:1710000000,type:'ciphertext'});
        tx.oncomplete=()=>{db.close();resolve(true);};tx.onerror=()=>reject(tx.error);
      };q.onerror=()=>reject(q.error);
    })`);
    await ses.flushStorageData();
  } finally {w.destroy();}
}
if(phase!=='seed') require('../src/main/app.cjs');
(async()=>{
  await app.whenReady();
  const ses=session.fromPartition('persist:wa-'+id);
  if(phase==='seed') {await seed(ses);app.quit();return;}
  const shell=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('file:'))?.webContents);
  const call=(name,...args)=>shell.executeJavaScript('window.desk.'+name+'(...'+JSON.stringify(args)+')');
  await until(async()=>(await call('state')).accounts[0]?.dropped);
  await call('select',id);
  const feed=await call('state');
  assert.equal(feed.messages[0].title,'历史联系人');assert.equal(feed.messages[0].text,'测试原文 137');assert.equal(feed.messages[0].unreadCount,3);
  await call('openChat',id,chat);
  const page=await call('state');assert.equal(page.count,137);assert.equal(page.messages.length,100);
  await until(()=>shell.executeJavaScript("get('snapshot-banner').checkVisibility() && get('composer').hidden && get('bubbles').textContent.includes('测试原文 137')"));
  await assert.rejects(call('send',id,chat,'不得发送'),/尚未连接/);
  await call('more');assert.equal((await call('state')).messages.at(-1).text,'测试原文 1');
  const found=await call('searchHistory',id,'测试原文 11',chat);assert(found.rows.length);
  await call('openHistoryHit',id,chat,found.rows[0].id);
  assert.equal((await call('state')).accounts[0].unread,3);
  const key=JSON.stringify([id,chat]);
  if (phase==='upgrade') {
    await shell.executeJavaScript(`(async()=>{
      await composerDisk.put('text',${JSON.stringify(key)},'草'.repeat(7000));
      await composerDisk.put('extras',${JSON.stringify(key)},{quoted:{id:'q1'},files:[{file:new File(['完整草稿附件'],'draft.txt',{type:'text/plain'})}]});
      await composerDisk.put('mentions',${JSON.stringify(key)},{text:'@user',spans:[{id:'user@c.us',label:'@user',start:0}]});
      return true;
    })()`);
    await ses.clearData(); // Drop only this fixture's WhatsApp partition.
  } else {
    const draft=await shell.executeJavaScript(`(async()=>{
      const key=${JSON.stringify(key)},extras=await composerDisk.get('extras',key);
      return [(await composerDisk.get('text',key)).length,extras.quoted.id,await extras.files[0].file.text(),(await composerDisk.get('mentions',key)).spans[0].label];
    })()`);
    assert.deepEqual(draft,[7000,'q1','完整草稿附件','@user']);
  }
  console.log('PASS '+phase+' · recovered exact bodies, pagination, unread, search, read-only UI and IPC');
  app.quit();
})().catch(error=>{console.error(error);app.exit(1);});
