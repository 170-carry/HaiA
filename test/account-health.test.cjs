const {test}=require('node:test');
const assert=require('node:assert/strict');
const {effectiveRestriction,observe,classification}=require('../src/main/account-health/state.cjs');
test('new-chat restrictions persist through disconnection and only a real online observation clears them',()=>{
  const account={id:'account'},session={account};
  const accounts={update:(id,patch)=>Object.assign(account,patch)};
  observe(accounts,session,{status:'online',restriction:{kind:'new-chats',until:5000}},100);
  assert.equal(classification(account,session,100),'limited');
  observe(accounts,session,{status:'pair',restriction:null},200);
  assert.equal(effectiveRestriction(account,session,200).until,5000);
  observe(accounts,session,{status:'online'},250);
  assert.equal(classification(account,session,250),'limited');
  observe(accounts,session,{status:'online',restriction:null},300);
  assert.equal(effectiveRestriction(account,session,300),null);
});
test('unknown logout is not a ban and recovery monitoring does not claim an appeal decision',()=>{
 const account={id:'account',dropped:{reason:''},appeal:{state:'watching',startedAt:1}}, session={account};
 const accounts={update:(id,patch)=>Object.assign(account,patch)};
 assert.equal(classification(account,session),'disconnected');
 account.dropped.reason='account_locked';assert.equal(classification(account,session),'locked');
 observe(accounts,session,{status:'pair'},2);assert.equal(account.appeal.state,'watching');
 observe(accounts,session,{status:'online'},3);assert.equal(account.appeal.state,'connected');
});
test('phone observation requires the official appeal activity and exact visible phone match',()=>{
 const {phoneObservation}=require('../src/main/account-health/phone.cjs');
 const activity='com.whatsapp.w4b/com.whatsapp.userban.ui.BanAppealActivity';
 const xml='<node text="Phone number in review: +1 650 555 0123"/><node text="Account in review"/>';
 assert.equal(phoneObservation(xml,activity,'16505550123').state,'in-review');
 assert.equal(phoneObservation(xml,activity,'16505550124'),null);
 assert.equal(phoneObservation(xml,'com.whatsapp.w4b/com.whatsapp.HomeActivity','16505550123'),null);
 assert.equal(phoneObservation('<node text="欢迎使用 WhatsApp"/>',activity,'16505550123'),null);
});
test('official companion restriction remains distinct and expiration waits for confirmation',()=>{
 const account={id:'account'},session={account},accounts={update:(id,patch)=>Object.assign(account,patch)};
 observe(accounts,session,{status:'online',restriction:{kind:'new-chats',type:'RESTRICT_ALL_COMPANIONS',until:10}},1);
 assert.equal(effectiveRestriction(account,session,20).type,'RESTRICT_ALL_COMPANIONS');
 assert.equal(effectiveRestriction(account,session,20).pendingVerification,true);
});
test('restricted accounts preserve the web page instead of scheduling an automatic reload',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
 const {createRequire}=require('node:module');
 const file=path.resolve(__dirname,'../src/main/web-account.cjs'),localRequire=createRequire(file);
 let scheduled=0,cancelled=0;
 const context={module:{exports:{}},__dirname:path.dirname(file),require:name=>name==='electron'?{}:localRequire(name),
 setTimeout:()=>{scheduled++;},clearTimeout:()=>{cancelled++;}};
 vm.runInNewContext(fs.readFileSync(file,'utf8'),context);
 const web={account:{restriction:{kind:'new-chats',until:Date.now()+60000}},retry:123};
 context.module.exports.WebAccount.prototype.watch.call(web,'offline');
 assert.equal(scheduled,0);assert.equal(cancelled,1);assert.equal(web.retry,null);
});
