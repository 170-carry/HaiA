const {classification}=require('./state.cjs');
const {phoneMonitor}=require('./phone.cjs');
const HELP='https://faq.whatsapp.com/465883178708358/?locale=zh_CN';
function healthRoutes(desk) {
  const phone=phoneMonitor(desk);
  function current(id) {
    const session=desk.sessions.get(id);
    if(!session) throw Error('账号不存在');
    return session;
  }
  return {
    stopPhoneReview:id=>{current(id);phone.stop(id);},
    readPhoneReview:id=>{current(id);return phone.start(id);},
    accountHelp:async id=>{current(id);await desk.openExternal(HELP);},
    watchAccountReview:id=>{
      const session=current(id);
      if(classification(session.account,session)!=='locked') throw Error('当前没有官方账号锁定信息');
      desk.accounts.update(id,{appeal:{state:'watching',startedAt:Date.now()}});
      desk.publish();
    },
    inspectAccount:id=>{
      const session=current(id);
      // Display the existing WhatsApp page. Do not navigate, clear storage or initiate another link.
      session.reveal();
    }
  };
}
module.exports={healthRoutes};
