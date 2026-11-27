// Runs in a blank, same-origin document before WhatsApp opens its local database.
// Project only conversation fields. Binary/opaque bodies are never turned into chat text.
async function readLegacyPage(name, after) {
  if (!['chat','message','contact'].includes(name)) throw new Error('无效的历史记录类型');
  if (!(await indexedDB.databases()).some(item=>item.name==='model-storage')) return {rows:[],next:null};
  const db = await new Promise((resolve,reject)=>{
    const req = indexedDB.open('model-storage');
    req.onsuccess = ()=>resolve(req.result);
    req.onerror = ()=>reject(req.error);
  });
  try {
    if (!db.objectStoreNames.contains(name)) return {rows:[],next:null};
    const text = value=>typeof value==='string' ? value : '';
    const wid = value=>text(value?._serialized || value);
    const label = {image:'图片',video:'视频',sticker:'贴纸',ptt:'语音消息',audio:'音频',document:'文件'};
    const chatId = value=>/^[\w.:-]+@(g\.us|c\.us|lid|s\.whatsapp\.net)$/.test(value);
    function project(r) {
      if (name==='contact') {
        const title = text(r.name || r.pushname || r.verifiedName);
        return title && chatId(r.id) ? {chat:r.id,title} : null;
      }
      if (name==='chat') return chatId(r.id) ? {chat:r.id,title:text(r.name),time:(Number(r.t)||0)*1000,
        pinned:!!r.pin,archived:!!r.archive,muted:r.muteExpiration===-1 || r.muteExpiration>Date.now()/1000,unread:Math.max(0,Number(r.unreadCount)||0)} : null;
      const id = wid(r.id), match = /^(true|false)_([^_]+)_/.exec(id);
      if (!match || !chatId(match[2]) || !r.t || r.type==='ciphertext' || r.invis || (r.expiredTimestamp>0 && r.expiredTimestamp<=Date.now()/1000)) return null;
      const chat = match[2], media = label[r.type], system = ['gp2','notification','notification_template','e2e_notification','protocol'].includes(r.type);
      const body = media ? text(r.caption) || text(r.filename) || media : text(r.body) || (r.type==='revoked'?'消息已撤回':'');
      if (!body.trim()) return null;
      return {id,chat,type:text(r.type),subtype:text(r.subtype),time:Number(r.t)*1000,rowId:r.rowId,outgoing:match[1]==='true',
        text:body,system,previewable:!system,translatable:!system && (!media || !!r.caption),senderId:wid(r.author),sender:text(r.notifyName),
        ack:r.ack,starred:!!r.isStarred,ephemeral:Number(r.ephemeralDuration)||0,
        media:media ? {kind:r.type,mime:text(r.mimetype),name:text(r.filename),size:r.size,once:!!r.isViewOnce,duration:r.duration,caption:!!r.caption}:null};
    }
    return await new Promise((resolve,reject)=>{
      const rows = [], tx = db.transaction(name,'readonly');
      const q = tx.objectStore(name).openCursor(after==null?null:IDBKeyRange.lowerBound(after,true));
      let count = 0, next = null;
      q.onsuccess = ()=>{
        const c = q.result;
        if (!c) return;
        const row = project(c.value);
        if (row) rows.push(row);
        if (++count===128) next = c.key;
        else c.continue();
      };
      tx.oncomplete = ()=>resolve({rows,next});
      tx.onabort = ()=>reject(tx.error);
      q.onerror = ()=>reject(q.error);
    });
  } finally { db.close(); }
}
module.exports = { readLegacyPage };
