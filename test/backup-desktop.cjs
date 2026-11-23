// Run with an empty fixture directory and a phase of export, import, or restart.
process.env.HAIA_TEST='1';
const {app, BrowserWindow, dialog, session, webContents}=require('electron');
const fs=require('node:fs'), path=require('node:path'), assert=require('node:assert/strict');
const [dir, phase,mode]=process.argv.slice(2);
const multi=mode==='multi';
if(!dir || !['export','import','restart'].includes(phase)) throw new Error('需要测试目录和阶段');
const profile=path.join(dir,phase==='export'?'source':'destination'), file=path.join(dir,'fixture.haia');
fs.mkdirSync(profile,{recursive:true});
app.setPath('userData',profile);
app.on('session-created',s=>{
  if(s!==session.defaultSession) s.protocol.handle('https',()=>new Response('<html>fixture</html>',{headers:{'Content-Type':'text/html'}}));
});
const read=fs.readFileSync, bundle=require.resolve('@wppconnect/wa-js');
fs.readFileSync=function(f,...args){return read.call(fs,f===bundle?path.join(__dirname,'mock-provider.js'):f,...args)};
dialog.showSaveDialog=async()=>({filePath:file});
dialog.showOpenDialog=async()=>({filePaths:[file]});
require('../src/main/app.cjs');
async function until(fn) {
  for(let i=0;i<150;i++){const result=await fn(); if(result)return result; await new Promise(r=>setTimeout(r,100));}
  throw new Error('Timeout: '+fn);
}
(async()=>{
  await app.whenReady();
  const wc=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('file:'))?.webContents);
  const ui=code=>wc.executeJavaScript(code);
  await until(()=>ui("typeof backupHistory==='object' && !!get('open-backup').onclick && !!state"));
  const click=id=>ui("get("+JSON.stringify(id)+").click()");
  const pass=()=>ui("get('backup-pass').value='isolated fixture password'");
  if(phase==='export') {
    await ui("api.add('测试账号')");
    const id=await until(()=>ui('state.accounts[0]?.id'));
    const w=await until(()=>webContents.getAllWebContents().find(w=>w.session===session.fromPartition('persist:wa-'+id)));
    await until(()=>w.executeJavaScript("typeof window.sample==='function' && typeof window.relayReader==='object'").catch(()=>false));
    await w.executeJavaScript("localStorage.owner='123456@c.us';sample('fixture message','one');true");
    await until(()=>ui("state.accounts[0].status==='online'"));
    if(multi) {
      await ui("api.add('第二个账号')");
      const second=await until(()=>ui('state.accounts[1]?.id'));
      const w2=await until(()=>webContents.getAllWebContents().find(w=>w.session===session.fromPartition('persist:wa-'+second)));
      await until(()=>w2.executeJavaScript("typeof window.sample==='function' && typeof window.relayReader==='object'").catch(()=>false));
      await w2.executeJavaScript("localStorage.owner='789000@c.us';sample('second inbox','one');true");
      await until(()=>ui("state.accounts[1].status==='online'"));
      await ui("api.add('未选择的账号')"); await until(()=>ui("state.accounts.length===3"));
    }
  }
  await click('open-backup');
  assert.equal(await ui("get('open-backup').getBoundingClientRect().bottom <= get('open-settings').getBoundingClientRect().top"),true);
  if(phase==='export') {
    if(multi){
      await click('backup-all');
      await ui("get('backup-choices').querySelectorAll('input')[2].click()");
      assert.equal(await ui("get('backup-all').indeterminate && get('backup-choices').querySelectorAll(':checked').length===2"),true);
    }
    await pass(); await click('backup-export');
    await until(()=>ui("get('backup-status').textContent.includes('"+(multi?'2':'1')+" 条消息')"));
  }
  if(phase!=='restart') {
    await pass(); await click('backup-import');
    await until(()=>ui("get('backup-log').textContent.includes('fixture message')"));
    await pass(); await click('backup-import');
    await until(()=>ui("get('backup-status').textContent.includes('已导入，可以查看')"));
    assert.equal(await ui("state.accounts.length"),multi?(phase==='export'?3:2):1);
    if(multi){
      await ui("get('backup-account').value=state.accounts[1].id;get('backup-account').dispatchEvent(new Event('change'))");
      await until(()=>ui("get('backup-log').textContent.includes('second inbox') && !get('backup-log').textContent.includes('fixture message')"));
    }
    if(phase==='export') assert.equal(await ui("state.accounts[0].status"),'online');
    else await until(()=>ui("state.accounts[0].status==='pair'"));
  } else {
    await until(()=>ui("get('backup-log').textContent.includes('fixture message')"));
    assert.equal(await ui("get('backup-version').options.length"),1);
    await click('backup-close');
    await ui("api.remove(state.accounts[0].id)");
    if(multi) await ui("api.state().then(s=>api.remove(s.accounts[0].id))");
    assert.deepEqual(fs.readdirSync(path.join(profile,'account-backups')),[]);
  }
  console.log('Backup desktop '+phase+' passed');app.exit(0);
})().catch(e=>{console.error(e); app.exit(1);});
