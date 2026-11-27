// Uses real WhatsApp, never mocks or blocks the network. Run on the source and target OS with the same private folder.
// HAIA_LIVE_SOURCE_PROFILE=/path/to/current/profile HAIA_LIVE_ACCOUNT=<uuid> electron test/live-transfer.cjs <folder> export
// electron test/live-transfer.cjs <folder> import|restart
// An import that cannot authenticate or sync exits nonzero. No pairing API or message sending API is called.
process.env.HAIA_TEST='1';
const {app,BrowserWindow,dialog,webContents,session}=require('electron');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {inspect,storageCounts}=require('./live-transfer/probe.cjs');
const [folderArg,phase]=process.argv.filter(arg=>arg!=='--no-sandbox').slice(2),folder=folderArg&&path.resolve(folderArg);
if (!folder || !['export','import','restart'].includes(phase)) throw Error('Expected private test folder and export/import/restart phase');
fs.mkdirSync(folder,{recursive:true,mode:0o700});
const file=path.join(folder,'transfer.haia'), baselinePath=path.join(folder,'baseline.json');
const source=phase==='export',expectedText=process.env.HAIA_LIVE_EXPECT_TEXT||'';
const profile=source?process.env.HAIA_LIVE_SOURCE_PROFILE:path.join(folder,'target-profile');
if (!profile || (source&&!process.env.HAIA_LIVE_ACCOUNT)) throw Error('Source profile and account must be selected explicitly');
if (!source) fs.mkdirSync(profile,{recursive:true,mode:0o700});
app.setPath('userData',profile);app.setPath('sessionData',profile);
if(process.env.HAIA_LIVE_NO_SANDBOX==='1')app.commandLine.appendSwitch('no-sandbox');
dialog.showErrorBox=(title,message)=>{console.error('LIVE_APP_ERROR '+title+': '+message);app.exit(1);};
dialog.showSaveDialog=async()=>({filePath:file});dialog.showOpenDialog=async()=>({filePaths:[file]});
require('../src/main/app.cjs');
const report={phase,appVersion:require('../package.json').version,startedAt:new Date().toISOString(),host:{platform:process.platform,arch:process.arch,
  electron:process.versions.electron,chrome:process.versions.chrome},network:'real',passwordSupplied:false,pairingRequested:false,samples:[]};
const save=()=>fs.writeFileSync(path.join(folder,phase+'-report.json'),JSON.stringify(report,null,2),{mode:0o600});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function finish(code) {
  const partitions=new Set(webContents.getAllWebContents().filter(w=>!w.isDestroyed()).map(w=>w.session));
  for(const partition of partitions){partition.flushStorageData();await partition.cookies.flushStore();}
  process.exitCode=code;app.quit();
}
const browser=(id)=>webContents.getAllWebContents().find(w=>!w.isDestroyed()&&w.session===session.fromPartition('persist:wa-'+id)&&w.getURL().startsWith('https://web.whatsapp.com'));
(async()=>{
  await app.whenReady();await sleep(1500);
  const ui=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('file:'))?.webContents;
  if (!ui) throw Error('HaiA window did not load');
  const call=code=>ui.executeJavaScript(code);
  let id=process.env.HAIA_LIVE_ACCOUNT,baseline;
  if (!source) {
    baseline=JSON.parse(fs.readFileSync(baselinePath,'utf8'));
    if(phase==='import'){
      const current=await call('window.desk.state()');
      report.emptyBeforeImport=current.accounts.length===0;
      if(current.accounts.length)throw Error('Target profile must be empty for first import');
      const result=await call('window.desk.backupImport()');
      if(result?.needsPassword)throw Error('Unexpected password request');
      id=result?.login?.find(row=>row.account&&!row.skipped)?.account;
      if(!id)throw Error('No account was imported');
      report.importCompleted=true;

    } else id=(await call('window.desk.state()')).accounts[0]?.id;
  }
  const salt=source?crypto.randomUUID():baseline.salt;
  let connected=false;
  for (let elapsed=0;elapsed<180;elapsed+=3) {
    const state=await call('window.desk.state()'),account=state.accounts.find(a=>a.id===id);
    const page=browser(id);
    const result=page?await page.executeJavaScript('('+inspect.toString()+')('+JSON.stringify(salt)+',false)').catch(error=>({probeError:error.message.slice(0,120)})):{};
    report.samples.push({seconds:elapsed,status:account?.status,...result});save();
    if(account?.status==='online'&&result.authenticated&&result.online&&result.transport?.state==='CONNECTED'&&result.stream?.mode==='MAIN'){connected=true;break;}
    if(account?.status==='pair'&&elapsed>=30)throw Error('Import reached the QR/pairing screen');
    if(elapsed%15===0)console.log('LIVE_STATE '+JSON.stringify({phase,seconds:elapsed,status:account?.status,...result}));
    await sleep(3000);
  }
  if(!connected)throw Error(report.samples.at(-1)?.authenticated?'Account authenticated but initial sync did not reach the main ready state before timeout':'Real account did not authenticate before timeout');
  report.authenticationPassed=true;save();
  await sleep(5000);
  report.identity=await browser(id).executeJavaScript('('+inspect.toString()+')('+JSON.stringify(salt)+',true,'+JSON.stringify(expectedText)+')');
  if(!source && process.env.HAIA_LIVE_AUTH_ONLY==='1'){
    if(report.identity.identityHash!==baseline.identityHash)throw Error('Imported account identity does not match source');
    report.archiveSha256=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    if(process.env.HAIA_LIVE_CAPTURE_AUTH==='1'){
      BrowserWindow.fromWebContents(ui).show();BrowserWindow.fromWebContents(ui).focus();
      await sleep(500);fs.writeFileSync(path.join(folder,phase+'-connected.png'),(await ui.capturePage()).toPNG(),{mode:0o600});
    }
    report.scope='authentication-only';report.passed=true;report.completedAt=new Date().toISOString();save();console.log('AUTHENTICATION_ONLY_PASS '+phase);await finish(0);return;
  }
  if(source){
    fs.writeFileSync(baselinePath,JSON.stringify({salt,exportedAt:Date.now(),...report.identity}),{mode:0o600});
    const result=await call('window.desk.backupExport('+JSON.stringify([id])+')');
    if(!result?.size)throw Error('No archive was created');
    report.export={bytes:result.size,accounts:result.accounts,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')};
    console.log('REAL_EXPORT '+JSON.stringify(report.export));
  }else{
    if(report.identity.identityHash!==baseline.identityHash)throw Error('Imported account identity does not match source');
    const first=report.identity;
    for(let elapsed=0;elapsed<(expectedText?300:120);elapsed+=10){
      await sleep(10000);
      const current=await browser(id).executeJavaScript('('+inspect.toString()+')('+JSON.stringify(salt)+',true,'+JSON.stringify(expectedText)+')');
      const counts=await browser(id).executeJavaScript('('+storageCounts.toString()+')()');
      report.samples.push({watchSeconds:elapsed+10,...current,stored:counts});save();
      if(current.textMessages>0&&current.chats>0&&(!expectedText||current.messages.some(m=>m.expected&&!m.outgoing))){report.synced=current;break;}
    }
    if(!report.synced)throw Error(expectedText?'Expected incoming test-message body was not received':'Authenticated but no message bodies synced');
    if(expectedText){
      const state=await call('window.desk.state()');
      const hit=state.messages.find(m=>m.text===expectedText&&!m.pendingText&&!m.outgoing);
      report.expectedIncoming=report.synced.messages.filter(m=>m.expected&&!m.outgoing).length;
      report.uiBodyMatched=!!hit;
      if(!hit)throw Error('Message reached WhatsApp but HaiA did not display its body');
      await call('window.desk.openChat('+JSON.stringify(id)+','+JSON.stringify(hit.chat)+')');
      BrowserWindow.fromWebContents(ui).show();BrowserWindow.fromWebContents(ui).focus();
      await sleep(1200);fs.writeFileSync(path.join(folder,phase+'-received-message.png'),(await ui.capturePage()).toPNG(),{mode:0o600});
    }
    const originals=new Map(baseline.messages.map(row=>[row.idHash,row]));
    report.matchedBodies=report.synced.messages.filter(row=>row.bodyHash&&originals.get(row.idHash)?.bodyHash===row.bodyHash).length;
    report.newBodies=report.synced.messages.filter(row=>row.bodyHash&&row.time*1000>=baseline.exportedAt).length;
    console.log('REAL_IMPORT '+JSON.stringify({phase,authenticated:true,online:true,chats:report.synced.chats,textMessages:report.synced.textMessages,matchedBodies:report.matchedBodies,newBodies:report.newBodies,initialChats:first.chats}));
  }
  report.passed=true;report.completedAt=new Date().toISOString();save();await finish(0);
})().catch(async error=>{report.passed=false;report.error=error.message;save();console.error('LIVE_FAILED '+error.message);await finish(1);});
