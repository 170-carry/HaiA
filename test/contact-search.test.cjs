const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const phones=require('../src/shared/phone-number.js');
function search(WPP) {
 const window={};vm.runInNewContext(fs.readFileSync(require.resolve('../src/whatsapp/contact-search.js'),'utf8'),{window,WPP,...phones});
 return window.relaySearchPeople;
}
test('number lookup survives a broken local chat index and accepts spaced or fullwidth digits',async()=>{
 const lookup=search({chat:{list:async()=>{throw Error('not ready')}},contact:{list:async()=>[],queryWidExists:async id=>({wid:{_serialized:id}})}});
 for(const term of ['+90 545 548 6898','905455486898','＋９０　５４５５４８６８９８']){
  const result=await lookup(term);
  assert.equal(result.rows[0].chat,'905455486898@c.us');assert.equal(result.lookup,'found');
 }
});
test('unsaved contacts are searchable and lookup failure stays distinct from no matching number',async()=>{
 const contact={list:async options=>{assert.equal(options,undefined);return [{id:'1234567@c.us',pushname:'Visitor'}];},queryWidExists:async()=>{throw Error('offline')}};
 const lookup=search({chat:{list:async()=>[]},contact});
 assert.equal((await lookup('visitor')).rows.length,1);
 const failed=await lookup('+90 545 548 6898');
 assert.equal(failed.lookup,'failed');assert.equal(failed.incomplete,true);
});
test('public usernames resolve to their stable LID without requiring a saved contact',async()=>{
 const lookup=search({chat:{list:async()=>[]},contact:{list:async()=>[],queryUsernameExists:async name=>{
  assert.equal(name,'@visitor');return {wid:{_serialized:'123456789@lid'},username:'visitor'};
 }}});
 const result=await lookup('@visitor');
 assert.equal(result.rows[0].chat,'123456789@lid');
 assert.equal(result.lookup,'found');
});
test('phone and LID aliases produce one contact and prefer an existing conversation',async()=>{
 const lookup=search({chat:{list:async()=>[{id:'447576287137@c.us',formattedTitle:'Teka'}]},contact:{list:async()=>[
  {id:'447576287137@c.us',name:'Teka'},
  {id:'240750868590631@lid',phoneNumber:'447576287137@c.us',name:'Teka'}
 ]}});
 for(const term of ['+447576287137','+44 7576 287137','447576287137']){
  const result=await lookup(term);
  assert.equal(result.rows.length,1);assert.equal(result.rows[0].chat,'447576287137@c.us');
 }
});
