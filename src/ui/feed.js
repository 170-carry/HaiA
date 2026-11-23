const dayFormat = new Intl.DateTimeFormat('zh-CN',{month:'long',day:'numeric'});
const timeFormat = new Intl.DateTimeFormat('zh-CN',{hour:'2-digit',minute:'2-digit'});
function dayLabel(time) {
  return new Date(time).toDateString() === new Date().toDateString() ? '今天' : dayFormat.format(time);
}
function renderFeed(state, open) {
  const page = state.feed || state;
  const accounts = new Map(state.accounts.map(a => [a.id,a]));
  const tones = accountTones(state.accounts);
  const q = document.getElementById('query').value.trim().toLocaleLowerCase();
  const digits = phoneSearchDigits(q);
  const list = document.getElementById('list'), items = document.createDocumentFragment();
  const focus = document.activeElement?.dataset?.message;
  const unreadOnly = document.getElementById('filter-unread').getAttribute('aria-pressed') === 'true';
  const mixed = !state.feedScope && state.accounts.length > 1;
  let matches = 0;
  for (const m of page.messages) {
    const owner = accounts.get(m.accountId);
    if (unreadOnly && !m.unreadCount) continue;
    if (!owner || (q && !matchesContactQuery(q,digits,m.phone || contactPhoneDigits(m.chat),[m.title,m.text,owner.name]))) continue;
    matches++;
    const row = el('button','row');
    row.dataset.message = JSON.stringify([m.accountId,m.chat]);
    const selected = state.thread?.chat === m.chat && state.active === m.accountId;
    row.classList.toggle('current', selected);
    row.classList.toggle('unread', m.unreadCount > 0);
    row.setAttribute('aria-current', String(selected));
    const words = el('span','words'), top = el('span','row-top');
    const stamp = el('span','row-stamp');
    for (const [flag,symbol,label] of [['pinned','pin','已置顶'],['muted','mute','已静音']]) if (m[flag]) {
      const mark = el('i','row-flag'); mark.title = label; mark.append(icon(symbol)); stamp.append(mark);
    }
    stamp.append(el('time','',m.time ? timeFormat.format(m.time) : ''));
    top.append(el('strong','',m.title),stamp);
    const preview = el('span','row-preview');
    const group = m.chat.endsWith('@g.us');
    if (group) top.firstChild.after(el('span','group-tag','群聊'));
    const prefix = m.system ? '' : m.outgoing ? '我：' : group && m.sender ? m.sender+'：' : '';
    const draft = draftStore.of(m.accountId,m.chat);
    const snippet = el('span','snippet',draft ? draft : m.text ? prefix + m.text : '');
    if (draft) snippet.prepend(el('b','draft-mark','草稿：'));
    preview.append(snippet);
    words.append(top,preview);
    if (m.unreadCount > 0) {
      const badge = el('span','conversation-unread', countLabel(m.unreadCount));
      badge.setAttribute('aria-label',m.unreadCount+' 条未读');
      preview.append(badge);
    }
    const face = el('span','row-face');
    face.append(avatar(m.title,m.chat,m.accountId));
    // The source account only needs marking when the list mixes several accounts.
    if (mixed) {
      const from = el('span','row-source '+tones.get(owner.id));
      from.title = '来源账号：'+owner.name;
      from.setAttribute('role','img'); from.setAttribute('aria-label',from.title);
      from.append(avatarPhotos.face(owner.id,'self'));
      face.append(from);
    }
    const stateLabel = {suspended:'已停用',left:'已退出',announce:'禁言',blocked:'已屏蔽'}[m.state];
    if (stateLabel) top.firstChild.after(el('span','row-state',stateLabel));
    // The same menu as a right-click, for people who do not think to right-click.
    const more = el('span','row-more');
    more.setAttribute('role','button'); more.title = '置顶、静音、归档等'; more.setAttribute('aria-label',more.title); more.append(icon('more'));
    more.onclick = event => { event.stopPropagation(); chatMenu.open(m,row,event); };
    row.append(face,words,more); row.onclick = ()=>open(m);
    row.oncontextmenu = event => { event.preventDefault(); chatMenu.open(m,row,event); };
    items.append(row);
  }
  list.replaceChildren(items);
  if (focus) Array.from(list.querySelectorAll('button')).find(b=>b.dataset.message===focus)?.focus({preventScroll:true});
  const empty = document.getElementById('feed-empty');
  empty.hidden = !!matches;
  const archived = document.getElementById('filter-archived').getAttribute('aria-pressed') === 'true';
  const pressed = id => document.getElementById(id).getAttribute('aria-pressed') === 'true';
  empty.textContent = q ? '没有匹配的会话' : unreadOnly ? '没有未读会话' : pressed('kind-direct') ? '没有单聊' : pressed('kind-group') ? '没有群聊' : archived ? '没有已归档的会话' : '暂无会话';
  document.getElementById('moreFeed').hidden = !(state.feedMore || page.count > page.messages.length);
}
