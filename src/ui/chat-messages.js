function messageReceipt(ack) {
  if (!Number.isInteger(ack) || ack > 4) return null;
  const [symbol,label] = ack < 0 ? ['failed','发送失败'] :
    [['clock','等待发送'],['singleCheck','已发送'],['doubleCheck','已送达'],['doubleCheck','已读'],['doubleCheck','已播放']][ack];
  const badge = el('span','receipt'+(ack >= 3 ? ' read' : ack < 0 ? ' failed' : ''));
  badge.title = label; badge.setAttribute('aria-label',label); badge.setAttribute('role','img');
  badge.append(icon(symbol)); return badge;
}
// Web addresses in message text open in the system browser.
function richText(node, text, mentions = []) {
  let last = 0;
  // Names of mentioned people are shown as tags.
  const plain = part => {
    if (!mentions.length) { node.append(part); return; }
    const pattern = new RegExp('(@(?:'+mentions.map(name=>name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')+'))','g');
    for (const piece of part.split(pattern)) node.append(piece.startsWith('@') && mentions.includes(piece.slice(1)) ? el('span','mention',piece) : piece);
  };
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'，。！？；：、]+[^\s<>"'，。！？；：、.,;:!?)\]]/gi)) {
    plain(text.slice(last,match.index));
    const link = el('button','text-link',match[0]);
    link.type = 'button'; link.dataset.url = match[0];
    node.append(link); last = match.index + match[0].length;
  }
  plain(text.slice(last));
}
function pollBlock(poll) {
  const box = el('div','poll'), total = poll.votes.reduce((sum,n)=>sum+n,0);
  box.append(el('strong','',poll.name));
  poll.options.forEach((option,i) => {
    const count = poll.votes[i] || 0, row = el('div','poll-option');
    const fill = el('i','poll-fill'); fill.style.width = (total ? Math.round(count/total*100) : 0)+'%';
    row.append(fill,el('span','',option),el('b','',String(count)));
    box.append(row);
  });
  box.append(el('small','',total ? '共 '+total+' 票' : '暂无投票 · 请在手机上参与'));
  return box;
}
// Pictures and videos sent together arrive as separate messages. Runs from one sender within a minute are shown as one album.
const inAlbum = message => ['image','video'].includes(message.media?.kind) && !message.media.once && !message.media.caption && !message.quote && !message.system;
function albumRun(ordered, start) {
  const run = [ordered[start]];
  if (!inAlbum(run[0])) return run;
  for (let i = start + 1; i < ordered.length; i++) {
    const item = ordered[i], last = run.at(-1);
    if (!inAlbum(item) || item.outgoing !== last.outgoing || item.senderId !== last.senderId || item.time - last.time > 60000 ||
        new Date(item.time).toDateString() !== new Date(last.time).toDateString()) break;
    run.push(item);
  }
  return run;
}
function albumRow(run, owner) {
  const first = run[0], last = run.at(-1), group = first.chat.endsWith('@g.us'), date = new Date(last.time);
  const author = first.outgoing ? owner?.name || '我' : first.sender || first.title;
  const row = el('article','message album '+(first.outgoing ? 'outgoing' : 'incoming')), bubble = el('div','message-body');
  if (group && !first.outgoing) bubble.append(el('strong','message-author member-'+tone(first.senderId || author),author));
  const grid = el('div','album-grid'+(run.length % 2 ? ' odd' : ''));
  for (const message of run) {
    const tile = el('div','album-item');
    tile.dataset.id = message.id; tile.dataset.stanza = message.id.split('_')[2] || '';
    tile.append(messageMedia.view(message));
    const more = el('button','album-more');
    more.type = 'button'; more.dataset.act = 'more'; more.title = '回复、转发等操作'; more.setAttribute('aria-label',more.title);
    more.append(icon('more')); tile.append(more);
    if (message.starred) tile.append(el('span','starred','★'));
    if (message.reactions?.length) tile.append(messageActions.reactions(message));
    grid.append(tile);
  }
  const text = el('p','message-text'); text.hidden = true;
  const foot = el('footer','message-foot'), time = el('time','',timeFormat.format(date));
  time.dateTime = date.toISOString();
  foot.append(el('span','album-count',run.length+' 个图片或视频'),time);
  const receipt = last.outgoing && messageReceipt(last.ack);
  if (receipt) foot.append(receipt);
  bubble.append(grid,text,foot);
  row.append(avatar(author,first.outgoing ? owner?.id || author : first.sender || first.chat,owner?.id,
    first.outgoing ? 'self' : first.senderId || (group ? null : first.chat)),bubble);
  return row;
}
// One row for a message: a centred notice for system messages, a bubble otherwise.
function messageRow(message, owner, arriving) {
  const date = new Date(message.time);
  if (message.system) {
    const secure = message.type === 'e2e_notification';
    const note = el('article','message system'+(secure ? ' encryption-notice' : ''));
    note.title = [message.type,message.subtype].filter(Boolean).join(' / ');
    if (secure) note.append(icon('lock'));
    const time = el('time','',timeFormat.format(date)); time.dateTime = date.toISOString();
    note.append(el('p','message-text',message.text),time); return note;
  }
  const author = message.outgoing ? owner?.name || '我' : message.sender || message.title;
  const row = el('article','message '+(message.outgoing ? 'outgoing' : 'incoming'));
  const bubble = el('div','message-body'), group = message.chat.endsWith('@g.us');
  if (group && !message.outgoing) bubble.append(el('strong','message-author member-'+tone(message.senderId || author),author));
  row.dataset.id = message.id; row.dataset.stanza = message.id.split('_')[2] || '';
  if (message.forwarded) bubble.append(el('span','message-flag','已转发'));
  if (message.quote) {
    const quote = el('button','quote');
    quote.type = 'button'; quote.title = '查看被引用的消息';
    quote.append(el('strong','',message.quote.sender),el('span','',message.quote.text));
    bubble.append(quote);
  }
  if (message.media) bubble.append(messageMedia.view(message));
  if (message.link) {
    const card = el('button','link-card text-link');
    card.type = 'button'; card.dataset.url = message.link.url;
    if (message.link.thumb) { const img = new Image(); img.src = message.link.thumb; img.alt = ''; card.append(img); }
    const words = el('span','');
    let host = ''; try { host = new URL(message.link.url).hostname; } catch { /* Shown without a host. */ }
    words.append(el('strong','',message.link.title),el('span','',message.link.description),el('small','',host));
    card.append(words); bubble.append(card);
  }
  if (message.poll) bubble.append(pollBlock(message.poll));
  const original = el('p','message-text');
  richText(original,message.text,message.mentions);
  original.dir = 'auto';
  original.hidden = (!!message.media && !message.media.caption) || !!message.poll;
  row.classList.toggle('revoked',message.type === 'revoked');
  row.classList.toggle('mentions-me',message.mentionsMe === true);
  const foot = el('footer','message-foot'), time = el('time','',timeFormat.format(date));
  time.dateTime = date.toISOString();
  if (message.starred) foot.append(el('span','starred','★'));
  if (message.edited) foot.append(el('span','edited','已编辑'));
  foot.append(time);
  const receipt = message.outgoing && messageReceipt(message.ack);
  if (receipt) foot.append(receipt);
  bubble.append(original,foot); chatTranslation.attach(message,foot,bubble);
  if (message.reactions?.length) bubble.append(messageActions.reactions(message));
  if (message.type !== 'revoked') bubble.append(messageActions.tools(message));
  if (arriving) row.classList.add('arriving');
  row.append(avatar(author,message.outgoing ? owner?.id || author : message.sender || message.chat,owner?.id,
    message.outgoing ? 'self' : message.senderId || (group ? null : message.chat)),bubble);
  return row;
}
// Rows are kept between updates and only rebuilt when their message changed. A typing indicator or a new tick
// therefore leaves the text selection, keyboard focus, fullscreen video and scroll anchors of other rows alone.
const messageRows = new Map();
function resetMessageRows() { messageRows.clear(); }
const rowStamp = value => JSON.stringify(value,(key,item) => key === 'thumb' ? Boolean(item) : item);
function syncMessages(container, messages, owner, previousIds, divider = null) {
  const newestExisting = previousIds?.size ? messages.find(message=>previousIds.has(message.id))?.time : null;
  const who = owner ? owner.id+'|'+owner.name+'|'+owner.photoIdentity : '', wanted = [], live = new Set();
  const place = (key, stamp, build) => {
    let entry = messageRows.get(key);
    if (!entry || entry.stamp !== stamp) messageRows.set(key, entry = {stamp, node:build()});
    live.add(key); wanted.push(entry.node);
  };
  let previousDate;
  const ordered = [...messages].reverse();
  for (let index = 0; index < ordered.length; index++) {
    const message = ordered[index];
    const currentDate = new Date(message.time).toDateString();
    if (currentDate !== previousDate) { const label = dayLabel(message.time); place('day:'+currentDate, label, () => el('div','date-pill',label)); }
    previousDate = currentDate;
    const run = albumRun(ordered,index);
    if (divider && run.some(item=>item.id === divider)) place('unread','unread',() => el('div','unread-divider','以下是未读消息'));
    if (run.length > 1) { place('album:'+run[0].id, rowStamp(run)+who, () => albumRow(run,owner)); index += run.length - 1; continue; }
    place(message.id, rowStamp(message)+who, () => messageRow(message, owner,
      Boolean(previousIds?.size && !previousIds.has(message.id) && message.time >= (newestExisting ?? 0))));
  }
  wanted.forEach((node, at) => { if (container.children[at] !== node) container.insertBefore(node, container.children[at] || null); });
  while (container.children.length > wanted.length) container.lastElementChild.remove();
  for (const key of messageRows.keys()) if (!live.has(key)) messageRows.delete(key);
}


