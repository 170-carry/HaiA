// Cookies must cross operating systems through Electron, not as an OS-encrypted Chromium database file.
const domains=new Set(['whatsapp.com','web.whatsapp.com']);
function validateCookies(items) {
  if(!Array.isArray(items)||items.length>100)throw Error('登录 Cookie 文件无效');
  return items.map(c=>{
    if(!c || typeof c.name!=='string' || !c.name || c.name.length>256 || typeof c.value!=='string' || c.value.length>65536 ||
       typeof c.domain!=='string' || !domains.has(c.domain.replace(/^\./,'')) ||
       typeof c.path!=='string' || !c.path.startsWith('/') || c.path.length>1024 ||
       typeof c.secure!=='boolean' || typeof c.httpOnly!=='boolean' ||
       !['unspecified','no_restriction','lax','strict'].includes(c.sameSite) ||
       (c.expirationDate!==undefined && (!Number.isFinite(c.expirationDate)||c.expirationDate<=0))) throw Error('登录 Cookie 文件无效');
    return {name:c.name,value:c.value,domain:c.domain,path:c.path,secure:c.secure,httpOnly:c.httpOnly,sameSite:c.sameSite,
      ...(c.expirationDate===undefined?{}:{expirationDate:c.expirationDate})};
  });
}
async function captureCookies(session) {
  const all=await session.cookies.get({});
  return validateCookies(all.filter(c=>domains.has(c.domain.replace(/^\./,''))));
}
async function restoreCookies(session,items) {
  for(const cookie of validateCookies(items)) {
    if(cookie.expirationDate!==undefined&&cookie.expirationDate<=Date.now()/1000)continue;
    const url=(cookie.secure?'https://':'http://')+cookie.domain.replace(/^\./,'')+cookie.path;
    await session.cookies.set({url,...cookie});
  }
  await session.cookies.flushStore();
}
module.exports={validateCookies,captureCookies,restoreCookies};
