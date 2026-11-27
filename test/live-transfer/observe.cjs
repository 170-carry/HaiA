// Records real native connection states without taking over sessions or sending messages.
const {app,session,webContents,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const {inspect}=require('./probe.cjs');
const {sendSelfMessage,readSelfMessages,selfChat,resumeSelfMessage}=require('./self-message.cjs');
const args=process.argv.filter(a=>a!=='--no-sandbox').slice(2);
const [root,label]=args;
if(!root||!['environment-a','environment-b'].includes(label))throw Error('Expected test root and environment label');
const folder=path.join(root,label),profile=path.join(folder,'target-profile');
const baseline=JSON.parse(fs.readFileSync(path.join(folder,'baseline.json')));
const plan=process.env.HAIA_SELF_TEST_AUTHORIZED==='1'?JSON.parse(fs.readFileSync(path.join(root,'self-test-plan.json'))):null;
const report={label,run:plan?.id||null,platform:process.platform,startedAt:new Date().toISOString(),samples:[]};
const file=path.join(folder,'concurrent-report.json');
process.env.HAIA_TEST='1';app.setPath('userData',profile);app.setPath('sessionData',profile);
require('../../src/main/app.cjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function bounded(p,ms){let timer;try{return await Promise.race([p,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('probe timeout')),ms)})])}finally{clearTimeout(timer)}}
(async()=>{
 await app.whenReady();await sleep(1500);
 const ui=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('file:'))?.webContents;
 const id=JSON.parse(fs.readFileSync(path.join(profile,'accounts.json')))[0].id;
 const ses=session.fromPartition('persist:wa-'+id);
 for(let n=0;n<60;n++){
  const page=webContents.getAllWebContents().find(w=>!w.isDestroyed()&&w.session===ses&&w.getURL().startsWith('https://web.whatsapp.com'));
  const row=page?await bounded(page.executeJavaScript('('+inspect.toString()+')('+JSON.stringify(baseline.salt)+',false)'),10000).catch(e=>({error:e.message})):{};
  if(plan&&page&&row.authenticated&&row.transport?.state==='CONNECTED'){
   const guard=path.join(folder,'self-send.json');
   const other=label==='environment-a'?'environment-b':'environment-a';
   let peer;try{peer=JSON.parse(fs.readFileSync(path.join(root,other,'concurrent-report.json')))}catch{}
   if(!fs.existsSync(guard)&&peer?.run===plan.id&&peer.samples.at(-1)?.transport?.state==='CONNECTED'){
    fs.writeFileSync(guard,JSON.stringify({attempted:true,run:plan.id}),{mode:0o600});
    const text=plan.texts[label==='environment-a'?0:1];
    const sent=await bounded(page.executeJavaScript('('+sendSelfMessage.toString()+')('+JSON.stringify(text)+')'),20000).catch(e=>({error:e.message}));
    fs.writeFileSync(guard,JSON.stringify({...sent,run:plan.id}),{mode:0o600});report.send={ok:!!sent.id,error:sent.error};
   }
   row.selfTests=await bounded(page.executeJavaScript('('+readSelfMessages.toString()+')('+JSON.stringify(plan.texts)+')'),10000).catch(e=>({error:e.message}));
   if(!report.resumeChecked&&fs.existsSync(guard)){
    const saved=JSON.parse(fs.readFileSync(guard));
    if(saved.id)report.resumed=await page.executeJavaScript('('+resumeSelfMessage.toString()+')('+JSON.stringify(saved.id)+')');
    report.resumeChecked=true;
   }
   if(ui&&Array.isArray(row.selfTests)&&row.selfTests.some(x=>x.seen)){
    if(!report.openedSelf){
     const own=await page.executeJavaScript('('+selfChat.toString()+')('+JSON.stringify(plan.texts)+')');
     if(own)try{await ui.executeJavaScript('window.desk.openChat('+JSON.stringify(id)+','+JSON.stringify(own)+')');report.openedSelf=true;}catch(e){report.uiError=e.message;}
    }
    row.uiSelfTests=await ui.executeJavaScript('window.desk.state().then(s=>'+JSON.stringify(plan.texts)+'.map(t=>s.messages.some(m=>m.text===t)))');
   }
  }
  row.at=new Date().toISOString();report.samples.push(row);
  if(ui)report.appState=await bounded(ui.executeJavaScript('window.desk.state().then(s=>s.accounts.map(a=>({status:a.status})))'),3000).catch(()=>[]);
  fs.writeFileSync(file,JSON.stringify(report,null,2),{mode:0o600});
  if(n%5===0)console.log(JSON.stringify({label,sample:n,ready:row.ready,mode:row.stream?.mode,socket:row.transport?.state,status:report.appState?.[0]?.status}));
  await sleep(2000);
 }
 if(plan&&ui){BrowserWindow.fromWebContents(ui).show();await sleep(300);fs.writeFileSync(path.join(folder,'self-tests.png'),(await ui.capturePage()).toPNG(),{mode:0o600});}
 ses.flushStorageData();await ses.cookies.flushStore();report.completedAt=new Date().toISOString();fs.writeFileSync(file,JSON.stringify(report,null,2),{mode:0o600});app.quit();
})().catch(e=>{report.error=e.message;fs.writeFileSync(file,JSON.stringify(report,null,2),{mode:0o600});console.error(e.message);app.exit(1)});
