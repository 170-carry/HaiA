const path = require('node:path');
const fs = require('node:fs/promises');
const {assetFile}=require('../backup/records.cjs');
async function keep(store,message,source) {
  if (!message.media || message.media.once || message.type==='revoked') return;
  const file = path.join(store.folder,assetFile(message.chat,message.id));
  const temp = file+'.tmp-'+require('node:crypto').randomUUID();
  try {
    await fs.copyFile(source,temp);
    if (!store.row(message.id)?.media) return;
    await fs.rename(temp,file);
    const row=store.row(message.id);
    if (!row?.media || row.media.once) {await fs.rm(file,{force:true});return;}
    if (!row.localAttachment) store.save({...row,localAttachment:true},true,'local-file','attachment');
  } finally { await fs.rm(temp,{force:true}); }
}
async function importAttachment(store,folder,message) {
  if (message.attachment!==assetFile(message.chat,message.id)) return;
  const target = path.join(store.folder,message.attachment);
  if (await fs.stat(target).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;})) return;
  await keep(store,message,path.join(folder,message.attachment));
}
async function retained(store,message) {
  if (!store || !message.media || message.media.once) return null;
  const file = path.join(store.folder,assetFile(message.chat,message.id));
  const stat = await fs.stat(file).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
  return stat && {path:file,size:stat.size,name:message.media.name,mime:message.media.mime.split(';')[0],token:require('node:crypto').randomUUID(),retained:true};
}
module.exports={keep,retained,importAttachment};
