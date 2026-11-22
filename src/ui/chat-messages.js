function messageReceipt(ack) {
  if (!Number.isInteger(ack) || ack > 4) return null;
  const [symbol,label] = ack < 0 ? ['failed','发送失败'] :
    [['clock','等待发送'],['singleCheck','已发送'],['doubleCheck','已送达'],['doubleCheck','已读'],['doubleCheck','已播放']][ack];
  const badge = el('span','receipt'+(ack >= 3 ? ' read' : ack < 0 ? ' failed' : ''));
  badge.title = label; badge.setAttribute('aria-label',label); badge.setAttribute('role','img');
  badge.append(icon(symbol)); return badge;
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
    const original = el('p','message-text',message.text);
    original.dir = 'auto';
    original.hidden = !!message.media && !message.media.caption;
    row.classList.toggle('revoked',message.type === 'revoked');
    const foot = el('footer','message-foot'), time = el('time','',timeFormat.format(date));
    time.dateTime = date.toISOString();
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

