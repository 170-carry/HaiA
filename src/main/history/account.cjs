const {randomUUID}=require('node:crypto');
const path=require('node:path');
const {recover}=require('./recovery.cjs');
const {backfill}=require('./backfill.cjs');
const {WebAccount}=require('../web-account.cjs');
const writeErrors=require('./write-errors.cjs');
const reassignment=require('./reassignment.cjs');

const standard=id=>String(id || '').replace(/:\d+@/,'@').replace(/@s\.whatsapp\.net$/,'@c.us');
function archived(account) {
  return {account,status:'snapshot',close(){this.disposed=true;},load(){},moreHistory(){},call(){return Promise.reject(Error('此账号已退出 WhatsApp'));}};
}
function attach(desk,account) {
  const store=desk.inbox.open(account.id);
  const session=account.historyOnly ? archived(account) : new WebAccount(account,(s,b)=>writeErrors.receive(desk,s,b),s=>recover(desk,path.dirname(desk.accounts.file),s,store));
  session.historyStore=store;
  session.unread=[...(desk.inbox.conversations.unread.get(account.id)?.values() || [])].reduce((sum,n)=>sum+n,0);
  session.identity=store.get('identity') || '';
  desk.sessions.set(account.id,session);
}
// A slot re-linked to a different number gets a new history. Keep the previous
// number visible under its own read-only entry, including its local files.
function isolate(desk,s,next) {
  const previous=s.identity || (s.account.phone && /^\d+(?::\d+)?@(c\.us|s\.whatsapp\.net)$/.test(next) ? s.account.phone+'@c.us' : '');
  if (!previous || !next || standard(previous)===standard(next)) return false;
  const id=s.account.id, inbox=desk.inbox, old=s.historyStore;
  const pending=desk.accounts.items.find(a=>a.snapshotFrom===id);
  const copy=pending || {...s.account,id:randomUUID(),snapshotFrom:id,draftId:s.account.draftId || id,historyOnly:true,linked:true,
    dropped:s.account.dropped || {at:Date.now(),reason:'identity_changed'}};
  if (!pending) desk.accounts.save([...desk.accounts.items,copy]);
  if (inbox.stores.has(id)) old.close();
  inbox.stores.delete(id);
  reassignment.finish(desk.accounts,inbox.root,copy);
  s.account=desk.accounts.items.find(a=>a.id===id);
  inbox.clear(id);
  attach(desk,desk.accounts.items.find(a=>a.id===copy.id));
  s.historyStore=inbox.open(id);
  s.historyStore.set('legacy','1');
  s.historyRetry=0;
  return true;
}
function record(desk,s,batch) {
  const store=s.historyStore;
  const state=batch.status==='online' ? 'linked' : s.account.dropped && batch.status==='pair' ? 'logged-out' : null;
  if (state && store.get('account-state')!==state) store.transaction(()=>{
    require('./journal.cjs').event(store,state,'whatsapp',s.account.id);
    store.set('account-state',state);
  });
  if(batch.status==='online' && s.identity) {
    if(store.get('identity')!==s.identity) store.set('identity',s.identity);
    desk.inbox.captureDirectory(s.account.id,batch);
    backfill(s,store,()=>{store.restore(desk.inbox,s.account.id);desk.publish();},()=>writeErrors.report(desk,s,true));
  }
}
function finish(desk,session,last) {
  if (!last || last.identity!==session.identity) return;
  const id=session.account.id;
  desk.inbox.mergeUnread(id,last);
  desk.inbox.captureDirectory(id,last);
  if(last.directory) desk.inbox.conversations.index(id,last.directory);
  if(last.chatUnread) desk.inbox.conversations.setUnread(id,last.chatUnread);
  desk.inbox.add(id,last.messages || []);
  for (const [key,ack] of last.acknowledgements || []) desk.inbox.receipt(id,key,ack);
  for (const [key,change] of last.changes || []) desk.inbox.patch(id,key,change);
}
module.exports={attach,isolate,record,finish};
