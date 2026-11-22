function messageReceipt(ack) {
  if (!Number.isInteger(ack) || ack > 4) return null;
  const [symbol,label] = ack < 0 ? ['failed','发送失败'] :
    [['clock','等待发送'],['singleCheck','已发送'],['doubleCheck','已送达'],['doubleCheck','已读'],['doubleCheck','已播放']][ack];
  const badge = el('span','receipt'+(ack >= 3 ? ' read' : ack < 0 ? ' failed' : ''));
  badge.title = label; badge.setAttribute('aria-label',label); badge.setAttribute('role','img');
  badge.append(icon(symbol)); return badge;
}
// Web addresses in message text open in the system browser.
function richText(node, text) {
  let last = 0;
  for (const match of text.matchAll(/https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/gi)) {
    node.append(text.slice(last,match.index));
    const link = el('button','text-link',match[0]);
    link.type = 'button'; link.dataset.url = match[0];
    node.append(link); last = match.index + match[0].length;
  }
  node.append(text.slice(last));
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
function renderMessages(messages,owner,previousIds) {
  const fragment = document.createDocumentFragment();
  const newestExisting = previousIds?.size ? messages.find(message=>previousIds.has(message.id))?.time : null;
  let previousDate;
  messageMedia.begin();
  for (const message of [...messages].reverse()) {
    const date = new Date(message.time), currentDate = date.toDateString();
    if (currentDate !== previousDate) fragment.append(el('div','date-pill',dayLabel(message.time)));
    previousDate = currentDate;
    if (message.system) {
      const secure = message.type === 'e2e_notification';
      const note = el('article','message system'+(secure ? ' encryption-notice' : ''));
      note.title = [message.type,message.subtype].filter(Boolean).join(' / ');
      if (secure) note.append(icon('lock'));
      const time = el('time','',timeFormat.format(date)); time.dateTime = date.toISOString();
      note.append(el('p','message-text',message.text),time); fragment.append(note); continue;
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
    richText(original,message.text);
    original.dir = 'auto';
    original.hidden = (!!message.media && !message.media.caption) || !!message.poll;
    row.classList.toggle('revoked',message.type === 'revoked');
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
    if (previousIds?.size && !previousIds.has(message.id) && message.time >= (newestExisting ?? 0)) row.classList.add('arriving');
    row.append(avatar(author,message.outgoing ? owner?.id || author : message.sender || message.chat,owner?.id,
      message.outgoing ? 'self' : message.senderId || (group ? null : message.chat)),bubble);
    fragment.append(row);
  }
  return fragment;
}

