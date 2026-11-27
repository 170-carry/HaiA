// Stop polling, finish any in-flight poll, and commit already-received events while the page still exists.
const {receive,replay}=require('./write-errors.cjs');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function drain(desk,session) {
  if (!session.ses || session.disposed) return;
  clearInterval(session.poll);
  while (session.busy && !session.disposed) await wait(20);
  const wc=session.view.webContents;
  if (!session.disposed && !wc.isDestroyed() && session.ready && replay(session,(s,b)=>receive(desk,s,b))) {
    while (!session.disposed) {
      const batch=await wc.executeJavaScript('window.relayReader.take(true)');
      if (session.disposed || !receive(desk,session,batch)) break;
      if ((batch.messages?.length || 0)<250 && (batch.changes?.length || 0)<500) break;
    }
  }
  await session.ses.flushStorageData();
}
function onQuit(app,desk,onStart) {
  let pending=false,done=false;
  app.on('before-quit',event=>{
    onStart();
    if (done) return;
    event.preventDefault();
    if (pending) return;
    pending=true;
    const tasks=[...desk.sessions.values()].map(session=>drain(desk,session));
    if (!desk.win.isDestroyed()) tasks.push(desk.win.webContents.executeJavaScript('composerDisk.flush()'));
    // A crashed page must not hold the desktop process open.
    Promise.race([Promise.allSettled(tasks),wait(5000)]).finally(()=>{done=true;app.quit();});
  });
}
module.exports={onQuit};
