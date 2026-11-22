const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { Accounts } = require('../src/main/accounts.cjs');
const { Inbox } = require('../src/main/inbox.cjs');

test('stable account partitions survive renaming labels or duplicate labels', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'relay-accounts-'));
  t.after(() => fs.rmSync(dir,{recursive:true,force:true}));
  const a = new Accounts(dir);
  a.add('销售'); a.add('销售');
  assert.notEqual(a.items[0].id, a.items[1].id);
  assert.deepEqual(new Accounts(dir).items, a.items);
});
test('deduplication, ordering and logout are scoped to the source account', () => {
  const inbox = new Inbox();
  const m = { id:'same', chat:'chat', title:'名字', text:'你好', time:100 };
  inbox.add('one',[m,m]); inbox.add('two',[{...m,time:200}]);
  assert.deepEqual(inbox.page(10).messages.map(x=>x.accountId),['two','one']);
  assert.equal(inbox.page(5,'one').count,1);
  inbox.clear('two'); assert.equal(inbox.page(2).count,1);
});

test('conversation pagination counts chats before slicing and isolates account read state', () => {
  const inbox = new Inbox();
  const base = {title:'同名', text:'预览',chat:'A'};
  const rows = Array.from({length:120},(_,i)=>({...base,id:String(i),time:i+10}));
  inbox.add('sales', rows);
  inbox.add('sales',[{...base,chat:'B',time:1,id:'older'}]);
  inbox.add('support',[{...base,time:2,id:'119'}]);
  inbox.conversations.setUnread('sales',[['A',4],['B',2]]);
  inbox.conversations.setUnread('support',[['A',1]]);
  const page=inbox.conversations.page(2,null);
  assert.equal(page.count,3);
  assert.deepEqual(page.messages.map(m=>[m.accountId,m.id,m.unreadCount]),[['sales','119',4],['support','119',1]]);
  assert.equal(inbox.conversations.page(10,'sales').messages[1].chat,'B');
  assert.equal(inbox.page(200,'sales','A').count,120);
});
test('decrypted content replaces its placeholder in the chat and preview without notifying twice', () => {
  const inbox = new Inbox();
  const row = {id:'key',chat:'contact',time:22,title:'Contact',text:'等待 WhatsApp 解密',pendingText:true};
  inbox.add('one',[row]); inbox.add('two',[row]);
  assert.equal(inbox.page(5,'one','contact').count,0);
  assert.equal(inbox.page(5,'one','contact').missingCount,1);
  assert.equal(inbox.conversations.find('two','contact').text,'');
  const replacement = {...row,text:'Hello',pendingText:false,notify:true};
  assert.equal(inbox.add('one',[replacement])[0].notify,false);
  assert.equal(inbox.page(2,'one','contact').count,1);
  assert.equal(inbox.conversations.find('one','contact').text,'Hello');
  assert.equal(inbox.page(2,'two','contact').missingCount,1);
  assert.equal(inbox.page(2,'one','contact').missingCount,0);
  assert.equal(inbox.add('one',[row]).length,0);
});

test('later events patch known messages and unknown fields are dropped', () => {
  const inbox = new Inbox();
  inbox.add('one',[{id:'m1',chat:'c',title:'t',text:'原文',time:5,outgoing:true,media:{kind:'image',thumb:'javascript:alert(1)',caption:true},quote:{id:'q',sender:'甲',text:'引用'}}]);
  const message = inbox.find('one','m1');
  assert.equal(message.media.thumb,'');
  assert.equal(message.quote.text,'引用');
  assert.equal(inbox.patch('one','missing',{revoked:true}),false);
  inbox.patch('one','m1',{reactions:[{emoji:'👍',count:2,mine:true},{emoji:'',count:1},{emoji:'x',count:'3'}]});
  assert.deepEqual(message.reactions,[{emoji:'👍',count:2,mine:true}]);
  inbox.patch('one','m1',{text:'新文',edited:true});
  assert.equal(inbox.conversations.page(5).messages[0].text,'新文');
  inbox.patch('one','m1',{revoked:true});
  assert.deepEqual([message.text,message.media,message.edited],['消息已撤回',null,false]);
  inbox.patch('one','m1',{text:'撤回后不能再改'});
  assert.equal(message.text,'消息已撤回');
  inbox.patch('one','m1',{removed:true});
  assert.equal(inbox.page(5,'one','c').count,0);
});
