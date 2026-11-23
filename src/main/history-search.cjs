function preview(row, query) {
  const start = Math.max(0,row.text.toLocaleLowerCase().indexOf(query) - 24);
  return {...row,text:(start ? '…' : '') + row.text.slice(start,start+140)};
}

async function searchHistory(desk, scope, term, chat = null) {
  const query = String(term ?? '').trim().slice(0,240);
  if (query.length < 2) return {rows:[],unavailable:0};
  const hits = new Map(), key = m => JSON.stringify([m.accountId,m.id]);
  const sessions = [...desk.sessions.values()].filter(s => !scope || s.account.id === scope);
  const outcomes = await Promise.allSettled(sessions.map(async session => {
    const identity = session.identity;
    if (session.status !== 'online') throw new Error('账号离线');
    let timeout, rows;
    try {
      rows = await Promise.race([session.call('searchHistory',query,chat), new Promise((_,reject) => {
        timeout = setTimeout(() => reject(new Error('WhatsApp 历史搜索超时')),12000);
      })]);
    } finally { clearTimeout(timeout); }
    if (session.disposed || session.identity !== identity || session.status !== 'online') throw new Error('账号已变更');
    for (const row of rows) {
      const hit = preview({...row,accountId:session.account.id,sender:row.outgoing ? '我' : row.sender},query.toLocaleLowerCase());
      hits.set(key(hit),hit);
    }
  }));
  for (const row of desk.searchMessages(scope,query,false,chat)) hits.set(key(row),row);
  return {rows:[...hits.values()].sort((a,b)=>b.time-a.time).slice(0,80),unavailable:outcomes.filter(r=>r.status==='rejected').length};
}

async function openHit(desk, account, chat, id) {
  const epoch = desk.epoch;
  let hit = desk.inbox.find(account,id);
  if (!hit) {
    const session = desk.online(account), identity = session.identity;
    hit = await session.call('historyHit',chat,id);
    if (session.disposed || session.identity !== identity || hit?.id !== id || hit.chat !== chat || hit.pendingText || hit.type === 'revoked') throw new Error('这条历史消息已不可用');
    desk.inbox.add(account,[hit]);
  }
  if (hit.chat !== chat) throw new Error('这条消息不属于该会话');
  if (epoch !== desk.epoch) return;
  if (desk.active !== account || desk.thread?.chat !== chat) await desk.openChat(account,chat);
  if (desk.active !== account || desk.thread?.chat !== chat) return;
  const messages = desk.inbox.page(Infinity,account,chat).messages;
  const index = messages.findIndex(m=>m.id===id);
  if (index === -1) desk.searchAnchor = {...hit,accountId:account,epoch:desk.epoch};
  else desk.limit = Math.max(desk.limit,index+1);
  desk.publish();
}
module.exports={searchHistory,openHit};
