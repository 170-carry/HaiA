// Resume each account/chat at its last committed cursor, then catch up with new arrivals.
const {importRows}=require('./recovery.cjs');
const {localWriteError}=require('./write-errors.cjs');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function catchUp(session,store,chat,valid) {
  const key='scan:'+chat;
  const state=JSON.parse(store.get(key) || '{}');
  let cursor=state.cursor || null, head=state.head;
  const seen=new Set();
  do {
    if (!valid()) return;
    if (seen.has(cursor)) throw Error('本地历史游标未前进');
    seen.add(cursor);
    const page=await session.call('backupMessages',chat,cursor);
    if (!valid()) return;
    if (!cursor) head=page.rows.reduce((a,b)=>!a || b.time>a.time || (b.time===a.time && b.rowId>a.rowId) ? b : a,null)?.id;
    cursor=state.previous && page.rows.some(r=>r.id===state.previous) ? null : page.next;
    store.transaction(()=>{
      importRows(store,session.account.id,page.rows,'linked');
      store.set(key,JSON.stringify(cursor ? {previous:state.previous,head,cursor} : {previous:head || state.previous,checkedAt:Date.now()}));
    });
    if (cursor) await pause(120);
  } while (cursor);
}
function backfill(session,store,publish,onWriteError) {
  if (session.backfilling || Date.now()<(session.historyRetry || 0)) return;
  const identity=session.identity;
  const valid=()=>!session.disposed && session.status==='online' && session.identity===identity && session.historyStore===store;
  session.backfilling=true;
  (async()=>{
    const chats=await session.call('backupChats');
    let failures=0;
    for (const chat of chats) {
      if (!valid()) return;
      try {await catchUp(session,store,chat.chat,valid);}
      catch(error) {if(localWriteError(error)) throw error;failures++;}
      if (!valid()) return;
      await pause(100);
    }
    if (!valid()) return;
    store.set('backfill',JSON.stringify({at:Date.now(),chats:chats.length,failed:failures}));
    session.historyRetry=Date.now()+(failures?60000:300000);
    publish();
  })().catch(error=>{
    session.historyRetry=Date.now()+60000;
    if (!valid()) return;
    if (localWriteError(error)) onWriteError();
    else {
      try {store.set('backfill',JSON.stringify({at:Date.now(),failed:true}));}
      catch {onWriteError();}
    }
  }).finally(()=>{session.backfilling=false;});
}
module.exports={backfill};
