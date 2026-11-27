const get = id => document.getElementById(id);
const api = window.desk;
const statusText = {loading:'连接中',syncing:'同步中',online:'已连接',pair:'待关联',offline:'连接失败','adapter-error':'消息接口异常'};
const drafts = new Map(), sending = new Set();
let state, route, timer, pairingAccount = null;
const composerKey=(id,chat)=>JSON.stringify([state?.accounts.find(a=>a.id===id)?.draftId || id,chat]);
const snapshotOf = account => !!account?.dropped && account.status!=='online';
function showPairing(account) {
  pairingAccount=account.id;
  return run(async()=>{await api.select(account.id);if(state?.active===account.id) render(state);});
}
get('snapshot-relink').onclick = ()=>{const owner=state?.accounts.find(a=>a.id===state.active);if(owner)showPairing(owner);};
function warning(message) {
  get('warning').textContent = message; get('warning').hidden = false;
  clearTimeout(timer); timer = setTimeout(()=>get('warning').hidden=true,6500);
}
// Errors reach the user in Chinese. Text from the system or a library is kept as a detail after a plain explanation.
function readable(error) {
  const text = String(error?.message || '').replace(/^.*?Error invoking remote method .*?: (?:\w*Error: )?/,'').trim();
  if (!text) return '操作失败，请重试。';
  return /[\u4e00-\u9fff]/.test(text) ? text : '操作没有完成，请重试。（' + text.slice(0,120) + '）';
}
async function run(action) {
  try { await action(); } catch (error) { warning(readable(error)); }
}
const stamps = new Map(), previews = new Map();
// Remembers the last value drawn for a part of the window. Returns false when it has to be drawn again.
function unchanged(part, value) {
  const stamp = JSON.stringify(value);
  if (stamps.get(part) === stamp) return true;
  stamps.set(part, stamp); return false;
}
function openMessage(m) { return run(()=>api.openChat(m.accountId,m.chat)); }
function render(s) {
  const previous = state;
  for(const account of previous?.accounts || []) if(!s.accounts.some(a=>a.id===account.id)) {
    const draftId=account.draftId || account.id;
    if (route && JSON.parse(route)[0]===draftId) get('reply').value='';
    for(const key of drafts.keys()) if(key.startsWith('['+JSON.stringify(draftId)+',')) drafts.delete(key);
    mentionDrafts.forget(draftId);
    void composerDisk.removeAccount(draftId).catch(()=>warning('清理本机草稿失败'));
  }
  state = s;
  const owner = s.accounts.find(a => a.id === s.active);
  const readOnly = snapshotOf(owner);
  if (pairingAccount && (s.accounts.find(a=>a.id===pairingAccount)?.status==='online' || s.thread)) pairingAccount=null;
  const banner=get('snapshot-banner');
  banner.hidden=!readOnly && !owner?.recoveryError && !owner?.storageError;
  get('snapshot-note').textContent=(readOnly ? 'WhatsApp 已异常退出 · 聊天记录只读，无法收发新消息。' : '') +
    (owner?.recoveryError ? ' 本地历史回溯未完成，下次启动会重试。' : '') +
    (owner?.storageError ? ' 本地写入失败，正在重试。请检查磁盘空间和目录权限。' : '');
  get('snapshot-relink').hidden=!readOnly || owner?.status!=='pair' || pairingAccount===owner?.id;
  document.body.classList.toggle('snapshot-mode',readOnly);
  const scope = s.accounts.find(a => a.id === s.feedScope);
  const page = s.feed || s;
  const current=composerKey(s.active,s.thread?.chat);
  const changed = route !== current;
  groupPanel.route(s.active,s.thread?.chat);
  const box = get('scroll'), atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 30;
  const oldHeight = box.scrollHeight, oldFirst = get('bubbles').firstElementChild;
  if (changed) {
    if (route) { composerTools.reset(); composerExtras.leave(route); voiceRecorder.cancel(); voiceInput.cancel(); }
    if (route) drafts.set(route,get('reply').value);
    route = current; get('reply').value = drafts.get(current) || ''; composerExtras.enter(current);
    draftStore.persist(); messageSelect.stop(); mentionPicker.close();
    const listed = row => row.accountId === s.active && row.chat === s.thread?.chat;
    threadMarks.open(Math.max((previous?.feed || previous)?.messages.find(listed)?.unreadCount || 0, (s.feed || s).messages.find(listed)?.unreadCount || 0));
    previews.clear();
  }
  // Preview images arrive once per message; later updates refer to the copy kept here.
  if (s.thread) for (const message of s.messages) for (const part of [message.media,message.link]) {
    if (part?.thumb) previews.set(message.id+(part === message.link ? '#link' : ''),part.thumb);
    else if (part?.kept) part.thumb = previews.get(message.id+(part === message.link ? '#link' : '')) || '';
  }
  if (previous?.feedScope !== s.feedScope) { get('query').value = ''; get('feed-scroll').scrollTop = 0; }
  avatarPhotos.setAccounts(s.accounts);
  // The rail, dock and header avatars are redrawn only when what they show has changed.
  if (unchanged('rail',[s.accounts,s.feedScope]) === false) renderRail(s,statusText,id=>run(()=>api.select(id)));
  get('welcome').hidden = s.accounts.length > 0;
  get('scroll').hidden = !s.accounts.length;
  const connected = s.accounts.filter(account => account.status === 'online').length;
  get('connections').hidden = false;
  peopleSearch.setScope(s.feedScope,scope?.name,s.accounts.some(a => a.status === 'online' && (!scope || a.id === scope.id)));
  const unread = scope ? scope.unread : s.accounts.reduce((sum, a) => sum + a.unread,0);
  get('scope-unread').hidden = !unread;
  get('scope-unread').textContent = countLabel(unread);
  get('scope-unread').title = unread + ' 条未读';
  get('archived-count').hidden = !s.archivedCount;
  get('archived-count').textContent = s.archivedCount ? countLabel(s.archivedCount) : '';
  const dock = get('dock-avatar');
  if (unchanged('dock',[scope?.id,scope?.photoIdentity,s.accounts.map(a=>a.id)]) === false) {
    dock.className = 'dock-icon ' + (scope ? accountTones(s.accounts).get(scope.id) : '');
    dock.replaceChildren(scope ? avatarPhotos.face(scope.id,'self') : icon('inbox'));
  }
  dock.classList.toggle('online', scope ? scope.status === 'online' : connected > 0);
  get('connections').classList.toggle('online', connected > 0);
  // Right after linking, WhatsApp keeps copying history from the phone for a while.
  const syncNote = account => account?.historySync ? '同步历史消息' + (account.historySync.progress != null ? ' ' + account.historySync.progress + '%' : '中') : '';
  const syncing = s.accounts.filter(account => account.historySync).length;
  get('connections').textContent = scope ? [scope.linkedPhone,snapshotOf(scope) ? '异常退出' : statusText[scope.status],syncNote(scope),accountHealth.limitNote(scope)].filter(Boolean).join(' · ') :
    connected + ' / ' + s.accounts.length + ' 个账号已连接' + (syncing ? ' · ' + syncing + ' 个正在同步历史' : '');
  get('location').textContent = scope?.name || '全部账号';
  get('title').textContent = scope ? scope.name + ' · 私信' : '私信';
  get('feed-count').textContent = String(page.count);
  showFilters(s.feedFilter === 'archived' ? 'archived' : 'all', s.feedKind || 'all');

  // An account that still has to be linked has no conversations, so its list column is folded away.
  document.body.classList.toggle('unlinked', scope?.status === 'pair' && !scope?.linked);
  if (unchanged('feed',[draftStore.version,page.messages,page.count,s.accounts,s.thread?.chat,s.active,s.feedScope,s.feedMore,s.feedFilter,s.feedKind]) === false) renderFeed(s,openMessage);
  accountHealth.draw(s);
  callBar.render(s);
  const preview = !s.thread && page.messages[0];
  const pair = owner?.status === 'pair' && (!readOnly || pairingAccount===owner.id) && !s.thread;
  const needsSetup = owner && owner.status !== 'online' && !s.thread && (!readOnly || pair);
  const title = s.thread?.title || (needsSetup ? owner.name : preview?.title) || '私信';
  get('reader-title').textContent = title;
  get('group-label').hidden = !(s.thread?.chat || preview?.chat || '').endsWith('@g.us') || !!needsSetup;


  if (unchanged('reader',[owner?.id,owner?.photoIdentity,preview?.accountId,!!needsSetup,s.thread?.chat || preview?.chat || title,s.accounts.map(a=>a.id)]) === false) {
    get('reader-avatar').className = 'avatar ' + (needsSetup ? accountTones(s.accounts).get(owner.id) : tone(s.thread?.chat || preview?.chat || title));
    get('reader-avatar').replaceChildren(avatarPhotos.face(owner?.id || preview?.accountId,
      needsSetup ? 'self' : s.thread?.chat || preview?.chat));
  }
  profilePanel.render(s.thread, owner, statusText, s.messages);
  threadSearch.setThread(s.thread ? JSON.stringify([s.active,s.thread.chat]) : null);
  get('empty').classList.toggle('setup', !!needsSetup);
  get('empty').hidden = !!s.thread;
  get('empty').classList.toggle('message-preview',!!preview && !needsSetup);

  // With nothing open, the reader lists the conversations that are waiting for an answer.
  const waiting = s.thread || needsSetup ? [] : page.messages.filter(m=>m.unreadCount > 0).slice(0,6);
  if (unchanged('overview',[waiting,s.accounts.map(a=>[a.id,a.name])]) === false) {
    const names = new Map(s.accounts.map(a=>[a.id,a.name]));
    get('overview').replaceChildren(...waiting.map(m => {
      const row = el('button','overview-row'); row.type = 'button';
      const words = el('span','overview-words');
      words.append(el('strong','',m.title),el('small','',(s.feedScope ? '' : (names.get(m.accountId) || '')+' · ')+(m.text || '新消息')));
      row.append(avatar(m.title,m.chat,m.accountId),words,el('span','conversation-unread',countLabel(m.unreadCount)));
      row.onclick = () => openMessage(m);
      return row;
    }));
  }
  get('overview').hidden = !waiting.length;
  get('preview-open').hidden = !preview || !!needsSetup || waiting.length > 0;
  get('preview-open').onclick = preview ? ()=>openMessage(preview) : null;
  get('emptyTitle').textContent = pair ? '关联 WhatsApp 账号' : needsSetup ? statusText[owner.status] :
    waiting.length ? (readOnly?'未读会话':'待回复的会话') : preview ? '最新消息' : '选择一条消息';
  get('help').textContent = pair ? '打开手机 WhatsApp，选择「已关联设备」→「关联设备」。' :
    needsSetup ? (['offline','adapter-error'].includes(owner.status) ? '右键点击左侧账号头像，选择「重新连接」。' : '正在准备此账号的会话。') :
    readOnly && !pair ? (preview?.text || '本机没有可预览的聊天记录。') : waiting.length ? '共 '+countLabel(unread)+' 条未读，先处理最近的这些：' : preview ? preview.text : '从左侧列表打开对话，在这里阅读和回复。';
  pairingPanel.render(pair ? owner.id : null, s.link, s.qr);
  const firstId = s.thread && s.messages.at(-1)?.id;
  if (changed || snapshotOf(previous?.accounts.find(a=>a.id===previous.active))!==readOnly) { chatTranslation.resetView(); resetMessageRows(); messageMedia.reset(); get('bubbles').replaceChildren(); }
  const known = changed ? null : new Set((previous?.messages || []).map(m=>m.id));
  syncMessages(get('bubbles'), s.thread ? s.messages : [], owner, known, s.thread ? threadMarks.divider(s.messages) : null);
  chatTranslation.prune(); messageSelect.paint();
  if (known && s.thread) threadMarks.arrived(s.messages.filter(m=>!known.has(m.id) && !m.outgoing && !m.system).length, atBottom);
  if (get('bubbles').firstElementChild) get('bubbles').firstElementChild.dataset.first = firstId;
  threadSearch.mark();
  get('more').hidden = !s.thread || !(s.more || s.count > s.messages.length);
  get('more').disabled = !!s.thread?.loading;
  get('more').textContent = s.thread?.waiting ? '正在向手机请求更早的消息…' : s.thread?.phoneSilent ? '更早的消息还在手机上，手机没有响应。请在手机上打开 WhatsApp 并保持联网，然后点这里重试' : '加载更早的消息';
  get('more').classList.toggle('phone-silent', !!s.thread?.phoneSilent && !s.thread?.waiting);
  get('chat-empty').hidden = !s.thread || Boolean(s.messages.length || s.missingCount);
  get('chat-empty').textContent = s.thread?.waiting ? '这段对话的消息还在手机上，正在请求同步，请保持手机联网…' : s.thread?.phoneSilent ? '这段对话的消息还在手机上，但手机没有响应。' : s.thread?.loading ? '正在加载聊天记录…' : '暂无已同步的消息';
  get('composer').hidden = !s.thread || readOnly;
  get('reply').placeholder = '发送消息给 @' + title;
  get('replyLabel').textContent = '使用 ' + (owner?.name || '') + ' 回复';
  replyAccount.render(s,owner);
  get('send').disabled = !canSend(owner);
  get('reply').disabled = readOnly || sending.has(route);
  const presence = s.thread?.presence;
  get('presence').hidden = !presence?.state;
  get('presence').textContent = presence?.state === 'composing' ? (presence.who ? presence.who+' ' : '')+'正在输入…' :
    presence?.state === 'recording' ? (presence.who ? presence.who+' ' : '')+'正在录音…' : '在线';
  if (s.thread && (atBottom || changed)) box.scrollTop = box.scrollHeight;
  else if (changed) box.scrollTop = 0;
  else if (s.thread && oldFirst?.dataset.first !== firstId) box.scrollTop += box.scrollHeight-oldHeight;
  threadMarks.settle();
}
function canSend(owner) {
  return !sending.has(route) && owner?.status === 'online' && !get('composer').classList.contains('locked') && Boolean(get('reply').value.trim() || composerExtras.ready());
}
function addDialog() { get('name-error').textContent='';get('name').value='';get('dialog').showModal();get('name').focus(); }
get('add').onclick = get('first').onclick = addDialog;
get('all').onclick = ()=>run(()=>api.select(null));
get('query').oninput = ()=>{
  renderFeed(state,openMessage);
  run(()=>api.searchFeed(state.feedScope,get('query').value));
};
get('moreFeed').onclick = ()=>run(()=>api.moreFeed());
get('more').onclick = ()=>run(()=>api.more());
get('cancel').onclick = ()=>get('dialog').close();
get('newAccount').onsubmit = e=>{
  e.preventDefault(); const name=get('name').value.trim(); if (!name) {get('name-error').textContent='请输入账号名称';get('name').focus();return;}
  get('dialog').close(); run(()=>api.add(name));
};
// The tabs narrow the list to private chats, groups or unread. The archive button switches to archived conversations and back.
const feedKinds = {all:'kind-all',direct:'kind-direct',group:'kind-group',unread:'filter-unread'};
function showFilters(view, kind) {
  get('filter-archived').setAttribute('aria-pressed', String(view === 'archived'));
  get('archive-note').hidden = view !== 'archived';
  for (const [name,id] of Object.entries(feedKinds)) get(id).setAttribute('aria-pressed', String(name === kind));
}
function showArchive(open) {
  showFilters(open ? 'archived' : 'all', state?.feedKind || 'all');
  if (state) renderFeed(state,openMessage);
  run(()=>api.filterUnread(open ? 'archived' : 'inbox'));
}
get('filter-archived').onclick = () => showArchive(get('filter-archived').getAttribute('aria-pressed') !== 'true');
get('archive-back').onclick = () => showArchive(false);
for (const [kind,id] of Object.entries(feedKinds)) get(id).onclick = () => {
  showFilters(state?.feedFilter === 'archived' ? 'archived' : 'all', kind);
  if (state) renderFeed(state,openMessage);
  run(()=>api.filterUnread('kind:' + kind));
};
get('reply').oninput = ()=>{
  get('send').disabled = !canSend(state?.accounts.find(a=>a.id===state.active));
};
get('reply').onkeydown = e=>{
  if (e.isComposing || e.key !== 'Enter') return;
  // Default: Enter sends and Shift + Enter breaks the line. The other mode keeps Enter for line breaks.
  const send = sendKey.mode() === 'enter' ? !e.shiftKey && !e.altKey : e.metaKey || e.ctrlKey;
  if (send) { e.preventDefault();get('composer').requestSubmit(); }
};
get('composer').onsubmit = e=>{
  e.preventDefault();const key=route, text=get('reply').value, {quoted,editing,files}=composerExtras.current();
  if ((!text.trim() && !files.length) || !state.thread || sending.has(key) || get('send').disabled) return;
  sending.add(key);get('send').disabled=get('reply').disabled=true;
  run(async()=>{
    try {
      const account=state.active, chat=state.thread.chat;
      const wire = mentionDrafts.encode(key,text);
      if (editing) await api.edit(account,chat,editing.id,wire.text,wire.ids);
      else if (files.length) {
        // The typed text travels as the caption of the first attachment.
        const outcome = await composerExtras.sendAll(account,chat,key,wire.text,quoted,wire.ids);
        if (outcome.error) {
          if (outcome.done) { drafts.delete(key);draftStore.persist(); if (route === key) { get('reply').value = ''; composerTools.reset(); } }
          throw outcome.error;
        }
      } else await api.send(account,chat,wire.text,quoted?.id || null,wire.ids);
      mentionDrafts.clear(key);
      drafts.delete(key);draftStore.persist();if(route===key){get('reply').value='';composerTools.reset();composerExtras.clear();}
    } finally {sending.delete(key);render(state);if(route===key)get('reply').focus();}
  });
};
window.addEventListener('DOMContentLoaded',async()=>{
  try {await Promise.all([draftStore.ready,mentionDrafts.ready]);}
  catch {warning('读取本机草稿失败，请检查数据目录。');}
  api.onUpdate(render); api.onWarning(warning);
  run(async()=>{chatTranslation.configure(await api.translationSettings());if(state)render(state);});
  run(async()=>render(await api.state()));
});
