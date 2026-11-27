// Results from successful, user-visible WhatsApp reads can be reopened after logout.
async function detail(session,method,...args) {
  const store=session.historyStore,identity=session.identity,key='detail:'+JSON.stringify([method,...args]);
  if(session.status!=='online') {
    const saved=store.get(key);
    if (saved!==undefined) return JSON.parse(saved);
    throw Error('本机尚未保存这项资料');
  }
  const result=await session.call(method,...args);
  if(session.disposed || session.identity!==identity) throw Error('账号已切换');
  const encoded=JSON.stringify(result);
  if (encoded!==undefined && store.get(key)!==encoded) store.set(key,encoded);
  return result;
}
module.exports={detail};
