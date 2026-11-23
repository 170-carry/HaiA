const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {pack, unpack, readJson} = require('../src/main/backup/package.cjs');
const {capture, validate, chatFile} = require('../src/main/backup/records.cjs');
const {Inbox} = require('../src/main/inbox.cjs');

test('selected account, paginated history and attachments survive an authenticated backup round trip', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'haia-backup-test-'));
  t.after(()=>fs.rm(dir,{force:true,recursive:true}));
  const records=path.join(dir,'records'), restored=path.join(dir,'restored');
  await fs.mkdir(records); await fs.mkdir(restored);
  const chat='123456@c.us', account={id:randomUUID(),name:'fixture'};
  const row=(id,text,time,extra={})=>({chat,id,text,time,...extra});
  const attachment=path.join(dir,'example.txt');
  await fs.writeFile(attachment,'attached document');
  const newest=[row('two','newest message',2), row('three','example.txt',3,{media:{name:'example.txt',kind:'document'}})];
  const session={account,status:'online',identity:'100001@c.us',
    call:async(method, id, cursor)=>{
      if(method==='backupChats') return [{chat,title:'Chat',unread:7}];
      assert.equal(id,chat);
      return cursor ? {rows:[row('one','older message',1)],next:null} : {rows:newest,next:'two'};
    }};
  const desk={sessions:new Map([[account.id,session]]),inbox:new Inbox()};
  desk.inbox.byAccount.set(randomUUID(),new Map([['other',row('other','other account',4)]]));
  const m=await capture(desk,session,records,[[chat,'draft']],()=>{},async()=>({path:attachment}));
  assert.equal(m.chats[0].count,3); assert.equal(m.phone,'100001'); assert.equal(m.chats[0].unread,7);
  const backup=path.join(dir,'test.haia'), pass='test password';
  await pack(records,backup,pass);
  const bytes=await fs.readFile(backup);
  assert.equal(bytes.includes(Buffer.from('older message')),false);
  await assert.rejects(unpack(backup,restored,path.join(dir,'bad.tar'),'incorrect password'),/完整性/);
  assert.deepEqual(await fs.readdir(restored),[]);
  await unpack(backup,restored,path.join(dir,'good.tar'),pass);
  assert.deepEqual(await validate(restored),m);
  const rows=await readJson(restored,chatFile(chat));
  assert.deepEqual(rows.map(row=>row.text),['older message','newest message','example.txt']);
  assert.equal(await fs.readFile(path.join(restored,rows[2].attachment),'utf8'),'attached document');
  bytes[bytes.length-1]^=1; await fs.writeFile(backup,bytes);
  await assert.rejects(unpack(backup,restored,path.join(dir,'tampered.tar'),pass),/完整性/);
});

test('older pages span file boundaries without skipping or repeating messages',async t=>{
  const {writeChat,historyPage}=require('../src/main/backup/chat-pages.cjs');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'haia-pages-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const summary={chat:'01234@c.us',count:253};
  const ids=Array.from({length:summary.count},(_,i)=>i+1);
  await writeChat(dir,summary.chat,ids);
  const newest=await historyPage(dir,summary,0), middle=await historyPage(dir,summary,100), oldest=await historyPage(dir,summary,200);
  assert.deepEqual([...oldest,...middle,...newest],ids);
  assert.deepEqual(await historyPage(dir,summary,300),[]);
});

test('archive refuses a symbolic link even if its name is admissible',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'haia-safe-import-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const source=path.join(dir,'source'),target=path.join(dir,'target');
  await fs.mkdir(source); await fs.mkdir(target);
  await fs.writeFile(path.join(source,'manifest.json'),'{}');
  const entry='file-'+'a'.repeat(64);
  await fs.symlink('manifest.json',path.join(source,entry));
  const file=path.join(dir,'archive');
  await pack(source,file,'testing password');
  await assert.rejects(unpack(file,target,path.join(dir,'payload.tar'),'testing password'),/目录无效/);
  assert.deepEqual(await fs.readdir(target),[]);
});

test('an offline account can export its name and drafts even before it has any messages',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'haia-offline-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const account={id:randomUUID(),name:'offline',phone:'100002'};
  const session={account,status:'pair',identity:'99999999@lid'};
  const desk={sessions:new Map([[account.id,session]]),inbox:new Inbox()};
  const drafts=[['2345@g.us','@Team hello',[{start:0,label:'@Team',id:'6789@lid'}]]];
  const exported=await capture(desk,session,dir,drafts,()=>{});
  assert.equal(exported.phone,'100002');
  assert.deepEqual(exported.chats,[]);
  assert.deepEqual((await validate(dir)).drafts,drafts);
});

test('batch restore reserves exact account matches and rolls back newly installed records on failure',async t=>{
  const {restoreSelection}=require('../src/main/backup/collection.cjs');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'haia-batch-restore-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const root=path.join(dir,'backups'), owner={id:randomUUID(),name:'Existing',phone:'123456'};
  const bundles=[];
  for(const source of [randomUUID(),owner.id]){
    const folder=await fs.mkdtemp(path.join(dir,'snapshot-'));
    bundles.push({dir:folder,meta:{source,id:randomUUID(),name:'Imported',phone:owner.phone,drafts:[]}});
  }
  const desk={accounts:{items:[owner],save:()=>{throw Error('no space');}},attach:()=>{},select:()=>{},publish:()=>{}};
  await assert.rejects(restoreSelection(desk,root,bundles),/no space/);
  assert.equal(desk.accounts.items.length,1);
  for(const id of await fs.readdir(root)) assert.deepEqual(await fs.readdir(path.join(root,id)),[]);
  for(const bundle of bundles) await fs.mkdir(bundle.dir);
  desk.accounts.save=items=>{desk.accounts.items=items};
  const result=await restoreSelection(desk,root,bundles);
  assert.equal(desk.accounts.items.length,2);
  assert.notEqual(result[0].account,owner.id);
  assert.equal(result[1].account,owner.id);
});
