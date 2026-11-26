const {test}=require('node:test'),assert=require('node:assert/strict');
const {validateCookies,captureCookies,restoreCookies}=require('../src/main/backup/login-cookies.cjs');
const cookie={name:'wa_web_access_token',value:'fixture',domain:'.web.whatsapp.com',path:'/',secure:true,httpOnly:true,sameSite:'no_restriction',expirationDate:Date.now()/1000+3600};
test('account cookies are captured as portable values and restored before first connection',async()=>{
 const captured=await captureCookies({cookies:{get:async()=>[{...cookie}, {...cookie,domain:'.example.com'}]}});
 assert.deepEqual(captured,[cookie]);const calls=[];
 await restoreCookies({cookies:{set:async value=>calls.push(value),flushStore:async()=>calls.push('flush')}},captured);
 assert.deepEqual(calls,[{url:'https://web.whatsapp.com/',...cookie},'flush']);
});
test('cookie import rejects foreign origins and malformed fields, and omits expired cookies',async()=>{
 for(const patch of [{domain:'.evil.test'},{path:'https://evil.test'},{value:{}},{sameSite:'none'},{expirationDate:Infinity}])
  assert.throws(()=>validateCookies([{...cookie,...patch}]));
 const calls=[];await restoreCookies({cookies:{set:async value=>calls.push(value),flushStore:async()=>{}}},[{...cookie,expirationDate:1}]);assert.equal(calls.length,0);
});
