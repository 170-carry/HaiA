// Daily-use helpers: unread divider and jump button, drafts, quick replies, mentions, multi-select,
// upload progress, message details, message search and the starred list.
const preferences = (() => {
  let values = {templates:[],mutedAccounts:[],background:true,notify:true,sound:true,badge:true,version:''};
  const ready = api.preferences().then(saved => { values = saved; }).catch(() => {});
  return {ready, get all() { return values; }, async save(patch) { values = {...values, ...await api.savePreferences(patch)}; return values; }};
})();

const threadMarks = (() => {
  const button = get('jump-bottom'), box = get('scroll');
  let unread = 0, divider = null, fresh = 0, target = null;
  const atBottom = () => box.scrollHeight - box.scrollTop - box.clientHeight < 30;
  function draw() {
    button.hidden = atBottom() || get('composer').hidden;
    get('jump-count').hidden = !fresh; get('jump-count').textContent = fresh > 99 ? '99+' : String(fresh);
    button.title = fresh ? fresh + ' 条新消息，点击查看' : '回到最新消息';
  }
  box.addEventListener('scroll',() => { if (atBottom()) fresh = 0; draw(); },{passive:true});
  button.onclick = () => { fresh = 0; box.scrollTop = box.scrollHeight; draw(); };
  return {
    // Called when a conversation is opened, with the unread count it had in the list.
    open(count) { unread = count; divider = null; fresh = 0; draw(); },
    // The oldest unread message gets the divider above it. It stays there until another conversation is opened.
    divider(messages) {
      if (unread > 0 && !divider) {
        const incoming = messages.filter(m => !m.outgoing && !m.system);
        if (incoming.length) { divider = incoming[Math.min(unread,incoming.length) - 1].id; unread = 0; }
      }
      return divider;
    },
    arrived(count, wasAtBottom) { if (!wasAtBottom) fresh += count; draw(); },
    // Scrolls to a message once it is in the list, for search results and starred messages.
    jump(id) { target = id; },
    settle() {
      draw();
      if (!target) return;
      const row = [...get('bubbles').querySelectorAll('[data-id]')].find(node => node.dataset.id === target);
      if (!row) return;
      target = null;
      row.scrollIntoView({block:'center'}); row.classList.add('flash'); setTimeout(() => row.classList.remove('flash'),1800);
    }
  };
})();

// Drafts survive a restart and show in the conversation list.
const draftStore = (() => {
  let version = 0;
  const saved=new Map();
  const ready=composerDisk.load('text','drafts',drafts).then(()=>{for (const [key,value] of drafts) saved.set(key,value);});
  function persist() {
    version++;
    for(const key of new Set([...drafts.keys(),...saved.keys()])) {
      const text=drafts.get(key) || null;
      if (text===(saved.get(key) || null)) continue;
      const previous=saved.get(key);
      if(text) saved.set(key,text);else saved.delete(key);
      composerDisk.put('text',key,text).catch(()=>{
        if ((saved.get(key) || null)===text) {
          if(previous) saved.set(key,previous); else saved.delete(key);
        }
        warning('本机草稿保存失败，请检查磁盘空间。');
      });
    }
  }
  get('reply').addEventListener('input',() => { if (route && !composerExtras.current().editing) { drafts.set(route,get('reply').value); persist(); } });
  return {persist,ready, get version() { return version; }, of(accountId, chat) {
    const key=composerKey(accountId,chat);
    return key === route ? '' : (drafts.get(key) || '').trim();
  }};
})();

const quickReplies = (() => {
  const menu = get('attach-menu');
  function show(filter, anchor) {
    const query = filter.toLocaleLowerCase();
    const items = preferences.all.templates.filter(t => !query || t.title.toLocaleLowerCase().includes(query) || t.text.toLocaleLowerCase().includes(query)).slice(0,12);
    if (!items.length) { if (menu.matches(':popover-open') && menu.dataset.kind === 'templates') menu.hidePopover(); return false; }
    menu.dataset.kind = 'templates';
    menu.replaceChildren(el('strong','chat-menu-title','快捷回复 · 回车选第一条'),...items.map(item => {
      const button = el('button','template-option'); button.type = 'button';
      button.append(el('strong','',item.title),el('small','',item.text));
      button.onclick = () => use(item);
      return button;
    }));
    if (!menu.matches(':popover-open')) menu.showPopover();
    const box = anchor.getBoundingClientRect(), own = menu.getBoundingClientRect();
    menu.style.left = Math.max(8,Math.min(box.left,innerWidth - own.width - 8)) + 'px'; menu.style.top = Math.max(8,box.top - own.height - 6) + 'px';
    return true;
  }
  function use(item) {
    const field = get('reply');
    menu.hidePopover(); delete menu.dataset.kind;
    field.value = /^\/\S*$/.test(field.value) ? item.text : field.value + item.text;
    field.dispatchEvent(new Event('input')); field.focus();
  }
  // Typing "/" at the start of an empty draft lists the quick replies.
  get('reply').addEventListener('input',() => {
    const match = /^\/(\S*)$/.exec(get('reply').value);
    if (match) show(match[1],get('reply')); else if (menu.dataset.kind === 'templates') { menu.hidePopover(); delete menu.dataset.kind; }
  });
  get('reply').addEventListener('keydown',event => {
    if (menu.dataset.kind !== 'templates' || !menu.matches(':popover-open')) return;
    if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); event.stopImmediatePropagation(); menu.querySelector('.template-option')?.click(); }
    else if (event.key === 'Escape') { menu.hidePopover(); delete menu.dataset.kind; }
    else if (event.key === 'ArrowDown') { event.preventDefault(); menu.querySelector('.template-option')?.focus(); }
  },true);
  return {open() {
    if (!show('',get('attach'))) warning('还没有快捷回复，请在「设置 → 快捷回复」中添加');
  }};
})();

// Choose a group member by name and keep their WhatsApp id with the draft.
const mentionPicker = (() => {
  const menu = get('attach-menu'), field = get('reply'), members = new Map();
  async function load(account, chat) {
    const key = account + '\n' + chat;
    if (!members.has(key)) members.set(key,api.groupInfo(account,chat).then(info => info.members.filter(m => !m.self),() => { members.delete(key); return []; }));
    return members.get(key);
  }
  function close() { if (menu.dataset.kind === 'mentions') { menu.hidePopover(); delete menu.dataset.kind; } }
  field.addEventListener('input',async () => {
    mentionDrafts.sync(route,field.value);
    const chat = state?.thread?.chat, before = field.value.slice(0,field.selectionStart);
    const match = chat?.endsWith('@g.us') && /(^|\s)@([^\s@]{0,20})$/.exec(before);
    if (!match) { close(); return; }
    const query = match[2].toLocaleLowerCase(), key = route;
    const list = (await load(state.active,chat)).filter(m => m.name.toLocaleLowerCase().includes(query) || m.id.includes(query)).slice(0,10);
    if (route !== key || field.value.slice(0,field.selectionStart) !== before || !list.length) { close(); return; }
    menu.dataset.kind = 'mentions';
    menu.replaceChildren(el('strong','chat-menu-title','提及群成员'),...list.map(member => {
      const button = el('button','reply-option'); button.type = 'button';
      button.append(avatar(member.name,member.id,state.active,member.id),el('span','',member.name));
      button.onclick = () => {
        if (route !== key || field.value.slice(0,field.selectionStart) !== before) { close(); return; }
        const start = before.length - match[2].length - 1, label = '@'+member.name;
        field.setRangeText(label+' ',start,field.selectionStart,'end');
        mentionDrafts.add(key,field.value,start,label,member.id);
        close(); field.dispatchEvent(new Event('input')); field.focus();
      };
      return button;
    }));
    if (!menu.matches(':popover-open')) menu.showPopover();
    const box = field.getBoundingClientRect(), own = menu.getBoundingClientRect();
    menu.style.left = Math.max(8,box.left) + 'px'; menu.style.top = Math.max(8,box.top - own.height - 6) + 'px';
  });
  field.addEventListener('keydown',event => {
    if (menu.dataset.kind !== 'mentions' || !menu.matches(':popover-open')) return;
    if ((event.key === 'Enter' || event.key === 'Tab') && !event.isComposing) { event.preventDefault(); event.stopImmediatePropagation(); menu.querySelector('.reply-option')?.click(); }
    else if (event.key === 'Escape') close();
  },true);
  return {close};
})();

// Several messages can be picked and then forwarded, copied or deleted together.
const messageSelect = (() => {
  const bar = get('select-bar'), picked = new Set();
  let active = false;
  const chosen = () => (state?.messages || []).filter(m => picked.has(m.id)).sort((a,b) => a.time - b.time);
  function paint() {
    document.body.classList.toggle('selecting',active);
    bar.hidden = !active;
    for (const node of get('bubbles').querySelectorAll('[data-id]')) node.classList.toggle('picked',active && picked.has(node.dataset.id));
    get('select-count').textContent = '已选 ' + picked.size + ' 条';
    for (const id of ['select-forward','select-copy','select-delete']) get(id).disabled = !picked.size;
  }
  function stop() { active = false; picked.clear(); paint(); }
  get('select-cancel').onclick = stop;
  get('select-copy').onclick = () => run(async () => {
    await navigator.clipboard.writeText(chosen().map(m => m.text).filter(Boolean).join('\n'));
    warning('已复制 ' + picked.size + ' 条消息'); stop();
  });
  get('select-forward').onclick = () => { const list = chosen(); stop(); forwardPicker.open(list); };
  get('select-delete').onclick = () => {
    const list = chosen();
    get('action-title').textContent = '删除 ' + list.length + ' 条消息'; get('action-detail').textContent = '只从你的 WhatsApp 中删除，对方仍然可以看到。';
    get('action-confirm').textContent = '删除';
    get('action-confirm').onclick = () => { get('confirm-action').close(); stop(); run(async () => { for (const m of list) await api.removeMessage(m.accountId,m.chat,m.id,false); }); };
    get('confirm-action').showModal();
  };
  // While picking, a click anywhere on a message toggles it instead of acting on it.
  get('bubbles').addEventListener('click',event => {
    if (!active) return;
    const row = event.target.closest('[data-id]');
    event.preventDefault(); event.stopImmediatePropagation();
    if (!row) return;
    if (picked.has(row.dataset.id)) picked.delete(row.dataset.id); else if (picked.size < 50) picked.add(row.dataset.id);
    paint();
  },true);
  window.addEventListener('keydown',event => { if (active && event.key === 'Escape' && !document.querySelector('dialog[open]')) stop(); });
  return {paint, stop, start(message) { active = true; picked.clear(); picked.add(message.id); paint(); }, get active() { return active; }};
})();

const uploadProgress = (() => {
  const bar = get('upload-progress');
  api.onProgress(progress => {
    const mine = state && progress.accountId === state.active && progress.chat === state.thread?.chat;
    if (!progress.total || !mine) { bar.hidden = true; return; }
    const percent = Math.round(progress.sent / progress.total * 100);
    bar.hidden = false;
    get('upload-name').textContent = '正在发送 ' + progress.name + ' · ' + percent + '%';
    get('upload-fill').style.width = percent + '%';
  });
})();

const messageDetails = (() => {
  const dialog = get('info-dialog'), body = get('info-body');
  const when = time => new Date(time).toLocaleString('zh-CN',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
  function section(title, rows) {
    const box = el('section','info-section');
    box.append(el('h3','',title),...rows.map(([left,right]) => { const row = el('div','info-row'); row.append(el('span','',left),el('small','',right || '')); return row; }));
    return box;
  }
  get('info-close').onclick = () => dialog.close();
  return {async open(message) {
    body.replaceChildren(el('p','detail-note','正在读取…'));
    dialog.showModal();
    try {
      const info = await api.messageInfo(message.accountId,message.chat,message.id), parts = [];
      parts.push(section('消息',[[message.outgoing ? '由你发送' : '来自 ' + (message.sender || message.title),when(message.time)],
        ...(message.edited ? [['已编辑','']] : []),...(message.forwarded ? [['转发的消息','']] : []),...(message.starred ? [['已加星标','']] : [])]));
      for (const reaction of info.reactions) parts.push(section(reaction.emoji + ' · ' + reaction.names.length + ' 人',reaction.names.map(name => [name,''])));
      if (info.readers.length) parts.push(section('已读 · ' + info.readers.length,info.readers.map(p => [p.name,when(p.read)])));
      if (info.delivered.length) parts.push(section('已送达 · ' + info.delivered.length,info.delivered.map(p => [p.name,when(p.delivered)])));
      if (info.waiting) parts.push(section('未送达',[[info.waiting + ' 位成员尚未收到','']]));
      if (message.outgoing && !message.chat.endsWith('@g.us')) parts.push(section('回执',[[{'-1':'发送失败',0:'等待发送',1:'已发送',2:'已送达',3:'已读',4:'已播放'}[message.ack] || '未知','']]));
      body.replaceChildren(...parts);
    } catch (error) { body.replaceChildren(el('p','detail-note',translationError(error))); }
  }};
})();

// Search over the messages synced so far, and the list of starred messages.
const messageSearch = (() => {
  const dialog = get('search-dialog'), input = get('search-query'), results = get('search-results'), note = get('search-note');
  const when = time => new Date(time).toLocaleString('zh-CN',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
  let starred = false, ticket = 0, timer = null;
  function row(item, done) {
    const button = el('button','search-row'); button.type = 'button';
    const top = el('span','search-top');
    top.append(el('strong','',item.title),el('time','',when(item.time)));
    button.append(top,el('span','search-text',(item.sender ? item.sender + '：' : '') + (item.starred ? '★ ' : '') + (item.text || {image:'图片',video:'视频',ptt:'语音',audio:'音频',document:'文件'}[item.media] || '消息')));
    button.onclick = () => { done?.(); threadMarks.jump(item.id); run(() => api.openHistoryHit(item.accountId,item.chat,item.id)); };
    return button;
  }
  async function find() {
    const mine = ++ticket, term = input.value.trim();
    if (!starred && term.length < 2) { results.replaceChildren(); note.textContent = '输入至少两个字。搜索关联设备可读取的 WhatsApp 历史记录。'; return; }
    note.textContent = '正在搜索…';
    try {
      const scope = state?.feedScope || null;
      const {rows,unavailable} = starred ? {rows:await api.searchMessages(scope,term,true)} : await api.searchHistory(scope,term);
      if (mine !== ticket) return;
      note.textContent = rows.length ? (starred ? '星标消息 · ' : '找到 ') + rows.length + ' 条' + (rows.length >= 80 ? '（仅显示最近 80 条）' : '') : starred ? '还没有星标消息' : '没有匹配的消息';
      if (unavailable) note.textContent += ' · '+unavailable+' 个账号仅显示 HaiA 已同步的结果';
      results.replaceChildren(...rows.map(item => row(item,() => dialog.close())));
    } catch (error) { if (mine === ticket) note.textContent = translationError(error); }
  }
  input.oninput = () => { ticket++; clearTimeout(timer); timer = setTimeout(find,220); };
  dialog.addEventListener('close',()=>{ ticket++; clearTimeout(timer); });
  get('search-close').onclick = () => dialog.close();
  function open(onlyStarred) {
    starred = onlyStarred; input.value = '';
    get('search-title').textContent = starred ? '星标消息' : '搜索消息';
    input.placeholder = starred ? '在星标消息中筛选' : '搜索聊天记录';
    dialog.showModal(); find(); input.focus();
  }
  get('filter-starred').onclick = () => open(true);
  get('open-search').onclick = () => open(false);
  return {open, row};
})();

// Notification, background and quick-reply preferences inside the settings page.
const settingsExtras = (() => {
  const dialog = get('settings-dialog');
  function draw() {
    const values = preferences.all;
    for (const input of dialog.querySelectorAll('[data-pref]')) input.checked = values[input.dataset.pref] === true;
    get('local-data-path').textContent=values.dataDirectory || '';
    get('settings-version').textContent = 'HaiA ' + (values.version || '');
    get('settings-muted').replaceChildren(...(state?.accounts.length > 1 ? [el('p','settings-note','不提醒以下账号的新消息：'),...state.accounts.map(account => {
      const row = el('label','settings-choice'), box = el('input');
      box.type = 'checkbox'; box.checked = values.mutedAccounts.includes(account.id);
      box.onchange = () => run(async () => {
        const muted = new Set(preferences.all.mutedAccounts);
        if (box.checked) muted.add(account.id); else muted.delete(account.id);
        await preferences.save({mutedAccounts:[...muted]});
      });
      row.append(box,el('span','',account.name)); return row;
    })] : []));
    get('template-list').replaceChildren(...values.templates.map((item,index) => {
      const row = el('div','template-row'), words = el('span','');
      words.append(el('strong','',item.title),el('small','',item.text));
      const remove = el('button','','删除'); remove.type = 'button';
      remove.onclick = () => run(async () => { await preferences.save({templates:preferences.all.templates.filter((_,at) => at !== index)}); draw(); });
      row.append(words,remove); return row;
    }));
  }
  get('open-data-folder').onclick=()=>run(()=>api.openDataDirectory());
  dialog.addEventListener('change',event => {
    const key = event.target.dataset?.pref;
    if (key) run(() => preferences.save({[key]:event.target.checked}));
  });
  get('template-form').onsubmit = event => {
    event.preventDefault();
    const text = get('template-text').value;
    if (!text.trim()) { get('template-note').textContent = '请填写回复内容'; get('template-text').focus(); return; }
    run(async () => {
      await preferences.save({templates:[...preferences.all.templates,{title:get('template-title').value,text}]});
      get('template-title').value = get('template-text').value = ''; get('template-note').textContent = '已添加'; draw();
    });
  };
  new MutationObserver(() => { if (dialog.open) preferences.ready.then(draw); }).observe(dialog,{attributes:true,attributeFilter:['open']});
})();

// The settings page shows one group at a time, picked from a list on the left.
const settingsNav = (() => {
  const dialog = get('settings-dialog'), groups = [...dialog.querySelectorAll('.settings-group')];
  const nav = el('nav','settings-nav'), pages = el('div','settings-pages');
  nav.setAttribute('aria-label','设置分类');
  groups[0].before(nav,pages);
  const tabs = groups.map((group,index) => {
    pages.append(group);
    const tab = el('button','',group.querySelector('h3').textContent); tab.type = 'button';
    tab.onclick = () => show(index);
    nav.append(tab);
    return tab;
  });
  const body = el('div','settings-body');
  nav.before(body); body.append(nav,pages);
  function show(target) {
    const index = typeof target === 'number' ? target : Math.max(0,groups.findIndex(group => group.id === target));
    groups.forEach((group,at) => { group.hidden = at !== index; });
    tabs.forEach((tab,at) => tab.setAttribute('aria-pressed',String(at === index)));
    pages.scrollTop = 0;
  }
  show(0);
  return {show};
})();
const compactTranslation = (() => {
  const box = get('translate-compact');
  const on = () => { try { return localStorage.getItem('translation-compact') === '1'; } catch { return false; } };
  function apply() { document.body.classList.toggle('translate-compact',on()); box.checked = on(); }
  box.onchange = () => { try { localStorage.setItem('translation-compact',box.checked ? '1' : '0'); } catch { /* Stays off. */ } apply(); };
  apply();
})();
