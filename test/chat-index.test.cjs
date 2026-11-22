const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('delayed chats, unavailable previews and one failed chat do not stop indexing',async () => {
  let chats = [{id:'101@c.us',t:1},{id:'102@c.us',t:2}];
  let clock = 0;
  const window = {};
  const context = {window, Date:{now:()=>clock}, WPP:{chat:{list:async()=>chats}}};
  for (const file of ['../src/shared/phone-number.js','../src/whatsapp/chat-index.js']) {
    vm.runInNewContext(fs.readFileSync(require.resolve(file),'utf8'),context);
  }
  const loaded = [];
  const index = window.createRelayIndex(async c=>{
    if (c.id === '101@c.us') throw Error('preview unavailable');
    if (c.id === '102@c.us') return [];
    return [c.id];
  },row=>row,rows=>loaded.push(...rows));
  index.take(true);
  await new Promise(setImmediate);
  assert.equal(index.take(true).directory.length,2);
  chats = chats.concat(Array.from({length:18},(_,i)=>({id:(200+i)+'@c.us',t:i+10,unreadCount:4})));
  clock = 16000;
  index.take(true);
  await new Promise(setImmediate);
  const snapshot = index.take(true);
  assert.equal(snapshot.directory.length,18);
  assert.equal(snapshot.unread,72);
  await new Promise(setImmediate);
  assert.equal(loaded.length,18);
});

test('conversation preview can cross several pages of missing bodies without changing unread state',async () => {
  const {Inbox} = require('../src/main/inbox.cjs');
  const inbox = new Inbox(), window = {}, cursors = [];
  const chat = '101@c.us', other = '102@c.us';
  const make = (id,time,text) => ({chat,id,time,title:'Contact',text,pendingText:!text,previewable:!!text});
  const context = {window,WPP:{chat:{list:async()=>[
    {id:chat,t:10,unreadCount:7}, {id:other,t:7,unreadCount:2}
  ]}}};
  for (const name of ['../shared/phone-number','preview-history','chat-index']) {
    vm.runInNewContext(fs.readFileSync(require.resolve('../src/whatsapp/'+name+'.js'),'utf8'),context);
  }
  const pages = new Map([
    [undefined,[make('head',10000,''),make('second',9000,'')]],
    ['second',[make('third',8000,'')]],
    ['third',[make('real',5000,'较早的正文')]]
  ]);
  const index = window.createRelayIndex(async (c,before)=>{
    if(c.id === other) return before ? [] : [{...make('notice',7000,'系统通知'),chat:other,previewable:false}];
    cursors.push(before);
    return pages.get(before);
  }, row=>row, rows=>inbox.add('account',rows));
  for(let i=0;i<5;i++){
    const batch=index.take(true);
    if(batch.directory) inbox.conversations.index('account',batch.directory);
    if(batch.chatUnread) inbox.conversations.setUnread('account',batch.chatUnread);
    await new Promise(setImmediate);
  }
  assert.deepEqual(cursors,[undefined,'second','third']);
  const list=()=>inbox.conversations.page(10,'account',true).messages.map(m=>[m.chat,m.text,m.unreadCount,m.time]);
  assert.deepEqual(list(),[[chat,'较早的正文',7,10000],[other,'',2,7000]]);
  inbox.add('account',[make('head',10000,'刚同步的正文')]);
  assert.deepEqual(list()[0],[chat,'刚同步的正文',7,10000]);
});
