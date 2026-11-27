const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {HistoryInbox}=require('../src/main/history/inbox.cjs');
const {translationCache}=require('../src/main/history/translations.cjs');
const {keep,retained}=require('../src/main/history/attachments.cjs');
const {receive,replay}=require('../src/main/history/write-errors.cjs');

function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'haia-durability-')),id=randomUUID(),chat='12345@c.us';
  let inbox;
  const f={root,id,chat,reopen(){inbox?.close();inbox=new HistoryInbox(root);this.inbox=inbox;this.store=inbox.open(id);},
    message(key,text,extra={}){return {id:key,chat,text,time:1700000000000,type:'chat',title:'测试',outgoing:true,...extra};}};
  f.reopen();
  t.after(()=>{inbox.close();fs.rmSync(root,{force:true,recursive:true});});
  return f;
}
test('early changes survive a restart, long originals remain intact and provenance is indexed',t=>{
  const f=fixture(t),body='中文'.repeat(40000)+'末尾';
  f.inbox.receipt(f.id,'early',3);
  f.inbox.patch(f.id,'early',{text:body});
  f.reopen();
  f.inbox.add(f.id,[f.message('early','初稿',{ack:1}),f.message('raw',body,{originalText:body+'@12345'})],'web-search');
  assert.equal(f.inbox.find(f.id,'early').ack,3);
  assert.equal(f.inbox.find(f.id,'early').text,body);
  f.reopen();
  assert.equal(f.store.row('raw').originalText,body+'@12345');
  assert.deepEqual(f.store.search('末尾',false,f.chat).map(m=>m.id).sort(),['early','raw']);
  const query='SELECT source FROM events WHERE ref=? ORDER BY seq DESC LIMIT 10';
  assert.match(f.store.sql('EXPLAIN QUERY PLAN '+query).all('early').map(v=>v.detail).join(' '),/events_record/);
  assert.deepEqual(f.store.sql(query).all('early').map(e=>e.source),['web-search','web-change','web-receipt']);
  f.inbox.add(f.id,[f.message('early','初稿',{ack:1})]);
  assert.equal(f.store.row('early').text,body);
  f.inbox.patch(f.id,'raw',{revoked:true});
  f.inbox.add(f.id,[f.message('raw',body,{edited:true,originalText:'不应恢复'})]);
  assert.equal(f.store.row('raw').originalText,undefined);
  assert.equal(f.store.row('raw').type,'revoked');
});
test('failed disk transaction can be replayed without duplicate events or loss to the UI cache',t=>{
  const f=fixture(t),batch={messages:[f.message('a','first'),f.message('b','second')]};
  const realSave=f.store.save.bind(f.store),session={account:{name:'fixture'}};
  f.store.save=(row,...args)=>{
    if(row.id==='b') throw Object.assign(Error('full'),{code:'ERR_SQLITE_ERROR'});
    return realSave(row,...args);
  };
  const desk={receive:(_s,b)=>f.inbox.add(f.id,b.messages),win:{isDestroyed:()=>true},publish(){}};
  const onBatch=(s,b)=>receive(desk,s,b);
  assert.equal(onBatch(session,batch),false);assert.equal(f.store.row('a'),null);
  assert.equal(f.inbox.find(f.id,'a'),undefined);assert(session.storageError);
  f.store.save=realSave;assert(replay(session,onBatch));assert.equal(session.storageError,false);
  onBatch(session,batch);
  f.reopen();assert.deepEqual(f.store.page(f.chat,5).messages.map(m=>m.id),['b','a']);
  assert.equal(f.store.sql('SELECT count(*) AS n FROM events WHERE ref=?').get('a').n,1);
});
test('downloaded originals and translations reopen offline, edit and revoke invalidate saved content',async t=>{
  const f=fixture(t),msg=f.message('file','文件说明',{media:{kind:'document',name:'example.txt',mime:'text/plain',caption:true}});
  f.inbox.add(f.id,[msg]);
  const source=path.join(f.root,'original');
  fs.writeFileSync(source,'actual local bytes');
  await keep(f.store,f.store.row('file'),source);
  const ref={accountId:f.id,id:'file',chat:f.chat};
  const routes={translationSettings:()=>({engine:'test',incoming:'zh-CN'}),translate:async()=>({text:'译文',provider:'test'})};
  const cached=()=>translationCache(routes,{sessions:new Map([[f.id,{historyStore:f.store}]])});
  assert.equal((await cached()(msg.text,'incoming',ref)).text,'译文');
  f.reopen();fs.unlinkSync(source);
  routes.translate=()=>{throw Error('offline');};
  assert.equal((await cached()(msg.text,'incoming',ref)).text,'译文');
  assert.equal(fs.readFileSync((await retained(f.store,f.store.row('file'))).path,'utf8'),'actual local bytes');
  f.inbox.patch(f.id,'file',{text:'修改后的说明'});await assert.rejects(cached()('修改后的说明','incoming',ref),/offline/);
  f.inbox.patch(f.id,'file',{revoked:true});assert.equal(await retained(f.store,msg),null);
});
test('interrupted account reassignment recovers the old identity in its own snapshot',t=>{
  const {Accounts}=require('../src/main/accounts.cjs');
  const {finishInterrupted}=require('../src/main/history/reassignment.cjs');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'haia-reassignment-'));
  t.after(()=>fs.rmSync(root,{force:true,recursive:true}));
  const accounts=new Accounts(root), original=accounts.add('first'), copy={...original,id:randomUUID(),historyOnly:true,snapshotFrom:original.id};
  let inbox=new HistoryInbox(root);
  inbox.open(original.id);
  inbox.add(original.id,[{id:'old',chat:'123@c.us',time:1,text:'旧号正文',title:'旧号'}]);
  inbox.close();
  accounts.save([...accounts.items,copy]);
  // Simulate process death after the directory rename, before the catalog commit.
  fs.renameSync(path.join(inbox.root,original.id),path.join(inbox.root,copy.id));
  const backup=path.join(root,'account-backups',original.id);
  fs.mkdirSync(backup,{recursive:true});fs.writeFileSync(path.join(backup,'proof'),'old owner');
  const restarted=new Accounts(root);
  finishInterrupted(restarted,inbox.root);finishInterrupted(restarted,inbox.root);
  inbox=new HistoryInbox(root);t.after(()=>inbox.close());
  assert.equal(inbox.open(copy.id).row('old').text,'旧号正文');
  assert.equal(inbox.open(original.id).row('old'),null);
  assert.equal(inbox.open(original.id).get('legacy'),'1');
  const saved=new Accounts(root).items;
  assert(!saved.some(a=>a.snapshotFrom));
  assert.equal(saved.find(a=>a.historyOnly).draftId,original.id);
  assert.notEqual(saved.find(a=>!a.historyOnly).draftId,original.id);
  assert.equal(fs.readFileSync(path.join(root,'account-backups',copy.id,'proof'),'utf8'),'old owner');
});
test('a committed WAL snapshot survives abrupt termination of its writer',async t=>{
  const {spawn}=require('node:child_process');
  const {once}=require('node:events');
  const f=fixture(t),writer=randomUUID();
  const child=spawn(process.execPath,['-e',`
    const {HistoryInbox}=require(process.argv[1]);
    const inbox=new HistoryInbox(process.argv[2]),id=process.argv[3];
    inbox.open(id);
    inbox.add(id,[{id:'committed',chat:'123@c.us',text:'已落盘',title:'测试',time:1}]);
    process.send('committed');
    setInterval(()=>{},1000);
  `,require.resolve('../src/main/history/inbox.cjs'),f.root,writer],{stdio:['ignore','ignore','inherit','ipc']});
  t.after(()=>child.kill('SIGKILL'));
  const exited=once(child,'exit');
  assert.equal(await Promise.race([once(child,'message').then(([msg])=>msg),exited.then(()=>null)]),'committed');
  child.kill('SIGKILL');await exited;
  const reopened=f.inbox.open(writer);
  assert.equal(reopened.row('committed').text,'已落盘');
  assert.equal(reopened.sql('SELECT source FROM events WHERE ref=?').get('committed').source,'web-sync');
});
test('the first account event persists even before a conversation has been opened',t=>{
  const f=fixture(t),newAccount=randomUUID();
  f.inbox.receipt(newAccount,'initial',3);
  f.inbox.add(newAccount,[f.message('initial','首次收到的原文',{ack:1})]);
  f.reopen();
  const row=f.inbox.open(newAccount).row('initial');
  assert.equal(row.text,'首次收到的原文');assert.equal(row.ack,3);
});
