const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {HistoryInbox}=require('../src/main/history/inbox.cjs');
const {Inbox}=require('../src/main/inbox.cjs');
test('complete account histories survive memory eviction, mutations, restart and account removal',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'haia-history-'));
  const a=randomUUID(),b=randomUUID(),chat='friend@c.us';
  let inbox=new HistoryInbox(root);
  const cap=Inbox.chatLimit;
  t.after(()=>{Inbox.chatLimit=cap;inbox.close();fs.rmSync(root,{force:true,recursive:true});});
  Inbox.chatLimit=8;
  const store=inbox.open(a);inbox.open(b);
  const rows=Array.from({length:85},(_,i)=>({id:'m'+i,chat,title:'朋友',text:'原文 '+i,time:1700000000000+i,type:'chat',outgoing:true,ack:1}));
  inbox.add(a,rows);inbox.add(b,[{...rows[0],text:'另一账号'}]);
  assert.equal(inbox.find(a,'m0'),undefined);
  inbox.patch(a,'m0',{text:'更正的原文',starred:true});
  inbox.receipt(a,'m0',3);inbox.receipt(a,'m0',1);
  inbox.patch(a,'m1',{revoked:true});inbox.patch(a,'m84',{removed:true});
  inbox.add(a,[rows[84]]); // An old page arriving later must not resurrect a deletion.
  inbox.captureDirectory(a,{directory:[{chat,title:'朋友',pinned:true,archived:false,muted:true}],chatUnread:[[chat,6]]});
  for(const [query,index,params] of [
    ['SELECT body FROM messages WHERE chat=? ORDER BY time DESC,position DESC,id DESC LIMIT 100','history_page',[chat]],
    ['SELECT body FROM messages WHERE chat=? AND preview>0 ORDER BY preview DESC,time DESC,position DESC,id DESC LIMIT 1','history_preview',[chat]],
    ['SELECT id FROM terms WHERE chat=? AND instr(words,?)>0 ORDER BY time DESC LIMIT 80','terms_chat',[chat,'原文']]
  ]) assert.match(store.sql('EXPLAIN QUERY PLAN '+query).all(...params).map(r=>r.detail).join(' '),new RegExp(index));
  inbox.close();inbox=new HistoryInbox(root);
  const restored=inbox.open(a),other=inbox.open(b);
  assert.equal(restored.page(chat,999).count,84);
  assert.equal(restored.row('m0').ack,3);
  assert.equal(restored.row('m0').text,'更正的原文');
  assert.equal(restored.search('更正',true,chat).length,1);
  assert.equal(restored.search('消息已撤回',false,chat).length,0);
  assert.equal(restored.row('m1').type,'revoked');
  const preview=inbox.conversations.page(1,a).messages[0];
  assert.equal(preview.id,'m83');assert.equal(preview.unreadCount,6);assert(preview.pinned);
  inbox.discard(a);
  assert(!fs.existsSync(restored.folder));assert.equal(other.row('m0').text,'另一账号');
});
