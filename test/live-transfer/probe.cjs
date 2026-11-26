// Read-only checks inside the real WhatsApp page; persist hashes and counts, never message bodies or credentials.
async function inspect(salt, sample = false, expectedText = '') {
  if (typeof WPP !== 'object' || !WPP.isReady) return {ready:false};
  const digest = async text => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(salt+text))),v=>v.toString(16).padStart(2,'0')).join('');
  const read = (fn,fallback=null) => {try{return fn()}catch{return fallback}};
  const identity = read(()=>WPP.conn.getMyUserWid()?.toString(),'') || '';
  const lid=read(()=>WPP.conn.getMyUserLid()?.toString(),'')||'';
  const out = {ready:true,authenticated:WPP.conn.isAuthenticated(),online:read(()=>WPP.conn.isOnline(),false),registered:read(()=>WPP.conn.isRegistered(),false),
    identityHash:identity?await digest(identity):'',ownLidHash:lid?await digest(lid):'',transport:{state:read(()=>WPP.whatsapp.Socket.state),stream:read(()=>WPP.whatsapp.Socket.stream),connected:read(()=>WPP.whatsapp.Conn.connected),canSend:read(()=>Boolean(WPP.whatsapp.Socket.canSend))},stream:read(()=>WPP.conn.getStreamData()),history:read(()=>WPP.conn.getHistorySyncProgress())};
  if (!out.authenticated) return out;
  const chats = await WPP.chat.list({ignoreGroupMetadata:true});
  out.chats = chats.length;
  if (sample) {
    out.messages = [];
    const latest = chats.filter(c=>/@(c\.us|g\.us|lid)$/.test(c.id?.toString())).sort((a,b)=>(b.t||0)-(a.t||0)).slice(0,5);
    for (const chat of latest) {
      const rows = await WPP.chat.getMessages(chat.id,{count:20});
      for (const row of rows) {
        const body=typeof row.body==='string'?row.body:'';
        out.messages.push({idHash:await digest(row.id?._serialized || String(row.id)),bodyHash:body?await digest(body):'',
          time:Number(row.t||0),type:String(row.type||''),outgoing:!!row.id?.fromMe,expected:!!expectedText&&body===expectedText});
      }
    }
    out.textMessages = out.messages.filter(row=>row.bodyHash).length;
  }
  return out;
}
async function storageCounts() {
  const found=(await indexedDB.databases()).some(db=>db.name==='model-storage');
  if (!found) return {chats:0,messages:0,contacts:0};
  const db=await new Promise((resolve,reject)=>{const q=indexedDB.open('model-storage');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
  const out={};
  try {
    for (const [label,store] of [['chats','chat'],['messages','message'],['contacts','contact']]) {
      out[label]=db.objectStoreNames.contains(store)?await new Promise((resolve,reject)=>{
        const q=db.transaction(store).objectStore(store).count();q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);
      }):0;
    }
  } finally {db.close();}
  return out;
}
module.exports={inspect,storageCounts};
