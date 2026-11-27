// Keep the polled batch until its local write succeeds. Connection failures
// still belong to the WhatsApp adapter and use its reconnect path.
function localWriteError(error) {
  return ['ERR_SQLITE_ERROR','ENOSPC','EDQUOT','EACCES','EPERM','EROFS','EIO'].includes(error?.code);
}
function report(desk,session,failed) {
  if (!!session.storageError===failed) return;
  session.storageError=failed;
  if (failed && !desk.win.isDestroyed()) desk.win.webContents.send('desk:warning',session.account.name+' 的聊天记录写入失败，请检查磁盘空间和目录权限。');
  desk.publish();
}
function receive(desk,session,batch) {
  if (session.unwritten || !batch) return false;
  try {
    desk.receive(session,batch);
    report(desk,session,false);
    return true;
  } catch (error) {
    if (!localWriteError(error)) throw error;
    session.unwritten=batch;
    report(desk,session,true);
    return false;
  }
}
function replay(session,onBatch) {
  if (!session.unwritten) return true;
  const batch=session.unwritten;
  session.unwritten=null;
  onBatch(session,batch);
  return !session.unwritten;
}
module.exports={receive,replay,localWriteError,report};
