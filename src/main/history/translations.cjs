const {createHash}=require('node:crypto');
function translationCache(routes,desk) {
  return async function translate(text,mode,ref) {
    if (mode!=='incoming' || !ref) return routes.translate(text,mode);
    const session=desk.sessions.get(ref.accountId),store=session?.historyStore;
    const row=store?.row(ref.id);
    if (!row || row.chat!==ref.chat || row.text!==text || row.type==='revoked') throw Error('消息内容已变更');
    const settings=await routes.translationSettings();
    const digest=createHash('sha256').update(text).digest('hex');
    const key=JSON.stringify([settings.incoming,settings.engine,digest]);
    const old=store.sql('SELECT result FROM translations WHERE id=? AND lang_key=?').get(ref.id,key);
    if (old) return JSON.parse(old.result);
    const value=await routes.translate(text,mode);
    if (!session.disposed && session.historyStore===store && store.row(ref.id)?.text===text)
      store.sql('INSERT OR REPLACE INTO translations VALUES (?,?,?)').run(ref.id,key,JSON.stringify(value));
    return value;
  };
}
module.exports={translationCache};
