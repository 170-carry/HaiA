// Main-process benchmark for the state that is rebuilt on every update. Run: node test/perf-inbox.cjs
const { Inbox } = require('../src/main/inbox.cjs');
const inbox = new Inbox(), accounts = ['a','b','c'], chatsPer = 300, perChat = 70;
const thumb = 'data:image/jpeg;base64,' + 'A'.repeat(30000);
let n = 0;
for (const account of accounts) {
  const rows = [];
  for (let c = 0; c < chatsPer; c++) for (let i = 0; i < perChat; i++) {
    const target = account === 'a' && c === 0;
    rows.push({id:account+'-'+c+'-'+i, chat:c+'@c.us', title:'客户 '+c, text:'消息 '+i, time:1e12+(n++), outgoing:i%3===0,
      media:target && i%2===0 ? {kind:'image',thumb,caption:true} : null});
  }
  inbox.add(account,rows);
  inbox.conversations.index(account,Array.from({length:chatsPer},(_,c)=>({chat:c+'@c.us',title:'客户 '+c,time:1,pinned:c%50===0,archived:c%10===0,muted:false})));
}
function time(label, rounds, work) {
  work();
  const start = process.hrtime.bigint();
  for (let i = 0; i < rounds; i++) work();
  return [label, Number(process.hrtime.bigint()-start)/1e6/rounds];
}
const results = Object.fromEntries([
  time('threadPageMs',200,()=>inbox.page(140,'a','0@c.us')),
  time('feedPageMs',200,()=>inbox.conversations.page(100,null)),
  time('archivedCountMs',200,()=>inbox.conversations.archivedCount ? inbox.conversations.archivedCount(null) : 0)
].map(([k,v])=>[k,+v.toFixed(3)]));
const page = inbox.page(140,'a','0@c.us');
// After the fix a thread page is sent through the delivery filter, which ships each preview image once.
const first = inbox.deliver ? inbox.deliver(page.messages,new Set()) : page.messages;
const seen = new Set(); if (inbox.deliver) inbox.deliver(page.messages,seen);
const repeat = inbox.deliver ? inbox.deliver(page.messages,seen) : page.messages;
results.firstUpdateKB = Math.round(JSON.stringify(first).length/1024);
results.repeatUpdateKB = Math.round(JSON.stringify(repeat).length/1024);
results.messagesHeld = [...inbox.byAccount.values()].reduce((sum,map)=>sum+map.size,0);
// Growth: one very busy chat keeps receiving messages for a whole session.
const busy = new Inbox();
for (let batch = 0; batch < 50; batch++) busy.add('a',Array.from({length:1000},(_,i)=>({id:'g'+batch+'-'+i,chat:'busy@c.us',title:'繁忙',text:'x',time:2e12+batch*1000+i})));
results.heldAfter50kInOneChat = busy.byAccount.get('a').size;
results.busyThreadPageMs = time('busy',100,()=>busy.page(140,'a','busy@c.us'))[1].toFixed(3)*1;
console.log('BENCH '+JSON.stringify(results));
