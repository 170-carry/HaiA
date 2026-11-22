const get = id => document.getElementById(id);
const api = window.desk;
const statusText = {loading:'连接中',syncing:'同步中',online:'已连接',pair:'待关联',offline:'连接失败','adapter-error':'消息接口异常'};
const drafts = new Map(), sending = new Set();
let state, route, timer;
function warning(message) {
  get('warning').textContent = message; get('warning').hidden = false;
  clearTimeout(timer); timer = setTimeout(()=>get('warning').hidden=true,6500);
}
async function run(action) {
  try { await action(); } catch (error) { warning(error.message || '操作失败，请重试。'); }
}
function openMessage(m) { return run(()=>api.openChat(m.accountId,m.chat)); }
function render(s) {
  const previous = state;
  state = s;
  const owner = s.accounts.find(a => a.id === s.active);
  const scope = s.accounts.find(a => a.id === s.feedScope);
  const page = s.feed || s;
  const current = JSON.stringify([s.active,s.thread?.chat]);
  const changed = route !== current;
  groupPanel.route(s.active,s.thread?.chat);
  const box = get('scroll'), atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 30;
  const oldHeight = box.scrollHeight, oldFirst = get('bubbles').firstElementChild;
  if (changed) {
    if (route) { composerTools.reset(); composerExtras.clear(); voiceRecorder.cancel(); voiceInput.cancel(); }
    if (route) drafts.set(route,get('reply').value);
    route = current; get('reply').value = drafts.get(current) || '';
  }
  if (previous?.feedScope !== s.feedScope) { get('query').value = ''; get('feed-scroll').scrollTop = 0; }
  avatarPhotos.setAccounts(s.accounts);
  renderRail(s,statusText,id=>run(()=>api.select(id)));
  get('welcome').hidden = s.accounts.length > 0;
  get('scroll').hidden = !s.accounts.length;
  const connected = s.accounts.filter(account => account.status === 'online').length;
  get('connections').hidden = false;
  peopleSearch.setScope(s.feedScope,scope?.name,s.accounts.some(a => a.status === 'online' && (!scope || a.id === scope.id)));
  const unread = scope ? scope.unread : s.accounts.reduce((sum, a) => sum + a.unread,0);
  get('scope-unread').hidden = !unread;
  get('scope-unread').textContent = String(unread);
  const dock = get('dock-avatar');
  dock.className = 'dock-icon ' + (scope ? accountTones(s.accounts).get(scope.id) : '');
  dock.replaceChildren(scope ? avatarPhotos.face(scope.id,'self') : icon('inbox'));
  dock.classList.toggle('online', scope ? scope.status === 'online' : connected > 0);
  get('connections').classList.toggle('online', connected > 0);
  get('connections').textContent = scope ? [scope.linkedPhone,statusText[scope.status]].filter(Boolean).join(' · ') : connected + ' / ' + s.accounts.length + ' 个账号已连接';
  get('location').textContent = scope?.name || '全部账号';
  get('title').textContent = scope ? scope.name + ' · 私信' : '私信';
  get('feed-count').textContent = String(page.count);

  // An account that still has to be linked has no conversations, so its list column is folded away.
  document.body.classList.toggle('unlinked', scope?.status === 'pair');
  renderFeed(s,openMessage);
  accountHealth.draw(s);
  const preview = !s.thread && page.messages[0];
  const pair = owner?.status === 'pair', needsSetup = owner && owner.status !== 'online' && !s.thread;
  const title = s.thread?.title || (needsSetup ? owner.name : preview?.title) || '私信';
  get('reader-title').textContent = title;
  get('group-label').hidden = !(s.thread?.chat || preview?.chat || '').endsWith('@g.us') || !!needsSetup;


  get('reader-avatar').className = 'avatar ' + (needsSetup ? accountTones(s.accounts).get(owner.id) : tone(s.thread?.chat || preview?.chat || title));
  get('reader-avatar').replaceChildren(avatarPhotos.face(owner?.id || preview?.accountId,
    needsSetup ? 'self' : s.thread?.chat || preview?.chat));
  profilePanel.render(s.thread, owner, statusText, s.messages);
  threadSearch.setThread(s.thread ? current : null);
  get('empty').classList.toggle('setup', !!needsSetup);
  get('empty').hidden = !!s.thread;
  get('empty').classList.toggle('message-preview',!!preview && !needsSetup);

  get('preview-open').hidden = !preview || !!needsSetup;
  get('preview-open').onclick = preview ? ()=>openMessage(preview) : null;
  get('emptyTitle').textContent = pair ? '关联 WhatsApp 账号' : needsSetup ? statusText[owner.status] :
    preview ? '最新消息' : '选择一条消息';
  get('help').textContent = pair ? '打开手机 WhatsApp，选择「已关联设备」→「关联设备」。' :
    needsSetup ? (['offline','adapter-error'].includes(owner.status) ? '右键点击左侧账号头像，选择「重新连接」。' : '正在准备此账号的会话。') :
    preview ? preview.text : '从左侧列表打开对话，在这里阅读和回复。';
  pairingPanel.render(pair ? owner.id : null, s.link, s.qr);
  const firstId = s.thread && s.messages.at(-1)?.id;
  chatTranslation.resetView();
  get('bubbles').replaceChildren(s.thread ? renderMessages(s.messages, owner, changed ? null : new Set((previous?.messages || []).map(m=>m.id))) : document.createDocumentFragment());
  if (get('bubbles').firstElementChild) get('bubbles').firstElementChild.dataset.first = firstId;
  threadSearch.mark();
  get('more').hidden = !s.thread || !(s.more || s.count > s.messages.length);
  get('more').disabled = !!s.thread?.loading;
  get('chat-empty').hidden = !s.thread || Boolean(s.messages.length || s.missingCount);
  get('chat-empty').textContent = s.thread?.loading ? '正在加载聊天记录…' : '暂无已同步的消息';
  get('composer').hidden = !s.thread;
  get('reply').placeholder = '发送消息给 @' + title;
  get('replyLabel').textContent = '使用 ' + (owner?.name || '') + ' 回复';
  get('send').disabled = !canSend(owner);
  get('reply').disabled = sending.has(route);
  const presence = s.thread?.presence;
  get('presence').hidden = !presence?.state;
  get('presence').textContent = presence?.state === 'composing' ? (presence.who ? presence.who+' ' : '')+'正在输入…' :
    presence?.state === 'recording' ? (presence.who ? presence.who+' ' : '')+'正在录音…' : '在线';
  if (s.thread && (atBottom || changed)) box.scrollTop = box.scrollHeight;
  else if (changed) box.scrollTop = 0;
  else if (s.thread && oldFirst?.dataset.first !== firstId) box.scrollTop += box.scrollHeight-oldHeight;
}
function canSend(owner) {
  return !sending.has(route) && owner?.status === 'online' && Boolean(get('reply').value.trim() || composerExtras.ready());
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
get('send').title = api.platform === 'darwin' ? '发送消息（⌘ + Enter）' : '发送消息（Ctrl + Enter）';
for (const mode of ['all','unread']) get('filter-' + mode).onclick = () => {
  get('filter-all').setAttribute('aria-pressed', String(mode === 'all'));
  get('filter-unread').setAttribute('aria-pressed', String(mode === 'unread'));
  if (state) renderFeed(state,openMessage);
  run(()=>api.filterUnread(mode === 'unread'));
};
get('reply').oninput = ()=>{
  get('send').disabled = !canSend(state?.accounts.find(a=>a.id===state.active));
};
get('reply').onkeydown = e=>{
  if (!e.isComposing && (e.metaKey || e.ctrlKey) && e.key==='Enter') { e.preventDefault();get('composer').requestSubmit(); }
};
get('composer').onsubmit = e=>{
  e.preventDefault();const key=route, text=get('reply').value, {quoted,editing,files}=composerExtras.current();
  if ((!text.trim() && !files.length) || !state.thread || sending.has(key) || get('send').disabled) return;
  sending.add(key);get('send').disabled=get('reply').disabled=true;
  run(async()=>{
    try {
      const account=state.active, chat=state.thread.chat;
      if (editing) await api.edit(account,chat,editing.id,text);
      else if (files.length) {
        // The typed text travels as the caption of the first attachment.
        for (const [i,file] of files.entries()) await api.sendFile(account,chat,{name:file.name,data:file.data,caption:i ? '' : text,quote:i ? null : quoted?.id});
      } else await api.send(account,chat,text,quoted?.id || null);
      drafts.delete(key);if(route===key){get('reply').value='';composerTools.reset();composerExtras.clear();}
    } finally {sending.delete(key);render(state);if(route===key)get('reply').focus();}
  });
};
window.addEventListener('DOMContentLoaded',()=>{
  api.onUpdate(render); api.onWarning(warning);
  run(async()=>{chatTranslation.configure(await api.translationSettings());if(state)render(state);});
  run(async()=>render(await api.state()));
});
