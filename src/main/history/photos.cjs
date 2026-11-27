const {readPhoto}=require('../profile-photo.cjs');
async function snapshotPhoto(session,who) {
  if (!session || typeof who!=='string' || !who || who.length>180) return null;
  const store=session.historyStore, key='photo:'+who;
  if (session.status!=='online') return store.get(key) || null;
  const identity=session.identity;
  const image=await readPhoto(session,who);
  if (session.disposed || session.identity!==identity || session.historyStore!==store) return null;
  if (image && store.get(key)!==image) store.set(key,image);
  return image;
}
module.exports={snapshotPhoto};
