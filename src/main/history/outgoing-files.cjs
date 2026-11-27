const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {keep}=require('./attachments.cjs');

// Upload the same bytes that the recipient and the local snapshot will receive.
async function send(desk,session,source,work) {
  const store=session.historyStore;
  if (typeof source==='string') {
    const stat=await fs.stat(source);
    if (!stat.isFile() || !stat.size || stat.size>200*1048576) throw Error('请选择不超过 200 MB 的有效文件');
  }
  const staged=path.join(store.folder,'.upload-'+randomUUID());
  try {
    if (Buffer.isBuffer(source)) await fs.writeFile(staged,source,{mode:0o600});
    else await fs.copyFile(source,staged);
    if (session.disposed || session.historyStore!==store || session.status!=='online') throw Error('账号连接已变更');
    const message=await desk.deliver(session,session.account.id,()=>work(staged));
    if (message && !session.disposed && session.historyStore===store) {
      try {await keep(store,message,staged);}
      catch {if (!desk.win.isDestroyed()) desk.win.webContents.send('desk:warning','消息已发出，本机未能保存附件原件。请检查磁盘空间和数据目录权限。');}
    }
  } finally {await fs.rm(staged,{force:true});}
}
module.exports={send};
