const {androidBridge}=require('./android.cjs');

function phoneObservation(xml,activity,phone) {
  if(!/com\.whatsapp(?:\.w4b)?\/com\.whatsapp\.userban\.ui\.BanAppealActivity/.test(activity)) return null;
  const text=[...xml.matchAll(/\btext="([^"]*)"/g)].map(m=>m[1].replace(/&amp;/g,'&')).join('\n');
  const numbers=text.match(/\+?\d[\d\s()\-]{6,}\d/g) || [];
  if(!phone || !numbers.some(n=>n.replace(/\D/g,'')===phone)) return null;
  let state=null;
  if(/This account can now use WhatsApp|此账号现在可以使用 WhatsApp|此帐号现在可以使用 WhatsApp/.test(text)) state='unbanned';
  else if(/Account in review|Phone number in review|Review requested|账号正在审核|帐号正在审核|已请求审核|已申請審查|帳號審查中/.test(text)) state='in-review';
  else if(/Requesting a review of this number is not available|无法请求审核|無法要求審查/.test(text)) state='banned';
  else if(/Request review|Request a review|请求审核|申请复审|申請審查/.test(text)) state='can-review';
  return state?{state,checkedAt:Date.now(),source:'official-phone-screen'}:null;
}
function phoneMonitor(desk) {
  const {run,device}=androidBridge();
  const bindings=new Map(desk.accounts.items.filter(a=>typeof a.appealMonitor?.serial==='string').map(a=>[a.id,a.appealMonitor.serial]));
  let busy=false;
  async function inspect(id,serial) {
    const account=desk.accounts.items.find(a=>a.id===id);
    if(!account) {bindings.delete(id);return;}
    const activity=await run(['-s',serial,'shell','dumpsys','activity','activities']);
    if(!/com\.whatsapp(?:\.w4b)?\/com\.whatsapp\.userban\.ui\.BanAppealActivity/.test(activity)) throw Error('请在手机打开官方 WhatsApp 的账号审核页面');
    await run(['-s',serial,'shell','uiautomator','dump','/data/local/tmp/haia-account-status.xml']);
    const xml=await run(['-s',serial,'shell','cat','/data/local/tmp/haia-account-status.xml']);
    const observation=phoneObservation(xml,activity,account.phone);
    if(!observation) throw Error('手机审核页没有显示与此账号一致的完整号码或可识别状态，暂无法核对');
    if(account.appeal?.state!==observation.state || account.appeal?.source!==observation.source ||
       Date.now()-(account.appeal?.checkedAt||0)>60000) {
      desk.accounts.update(id,{appeal:observation});desk.publish();
    }
    bindings.set(id,serial);return observation;
  }
  async function start(id) {
    if(busy) throw Error('正在读取手机状态，请稍候');
    busy=true;
    try {
      const serial=await device();
      const result=await inspect(id,serial);
      desk.accounts.update(id,{appealMonitor:{serial}});
      desk.publish();return result;
    } catch(error) {
      if(error.code==='ENOENT') throw Error('需要安装 Android Platform Tools 后才能读取手机状态');
      throw error;
    } finally {busy=false;}
  }
  const timer=setInterval(async()=>{
    if(busy || !bindings.size)return;
    busy=true;
    try {for(const [id,serial] of bindings) await inspect(id,serial).catch(()=>{});}
    finally {busy=false;}
  },60000);
  timer.unref();
  return {start,stop(id) {
    bindings.delete(id);desk.accounts.update(id,{appealMonitor:undefined});desk.publish();
  }};
}
module.exports={phoneMonitor,phoneObservation};
