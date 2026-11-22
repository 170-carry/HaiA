// Attachment menu with location, contact card and poll, plus status updates and calls.
const attachMenu = (() => {
  const menu = get('attach-menu'), dialog = get('special-dialog'), form = get('special-form'), fields = get('special-fields');
  const kinds = {
    location:{title:'发送位置', hint:'在地图应用中复制坐标后填入，对方会看到可点击的位置卡片。', fields:[['lat','纬度','例如 1.290270'],['lng','经度','例如 103.851959'],['name','地点名称（可选）','例如 滨海湾仓库'],['address','地址（可选）','']]},
    contact:{title:'发送联系人名片', hint:'对方可以直接保存或给这个号码发消息。', fields:[['name','联系人姓名','例如 王经理'],['phone','手机号（含国家区号）','例如 +65 8123 4567']]},
    poll:{title:'发起投票', hint:'每行一个选项，需要 2 到 12 个。', fields:[['name','投票问题','例如 周几方便收货？'],['options','选项','周三\n周四\n周五','textarea'],['multiple','允许选择多个选项','','checkbox']]}
  };
  let kind = null;
  function open(next) {
    kind = next; menu.hidePopover();
    const spec = kinds[kind];
    get('special-title').textContent = spec.title; get('special-hint').textContent = spec.hint; get('special-error').textContent = '';
    fields.replaceChildren(...spec.fields.map(([name,label,placeholder,type]) => {
      const row = el('label',type === 'checkbox' ? 'auto-setting' : '',type === 'checkbox' ? '' : label);
      const input = el(type === 'textarea' ? 'textarea' : 'input');
      input.name = name; input.placeholder = placeholder; input.autocomplete = 'off';
      if (type === 'checkbox') { input.type = 'checkbox'; row.append(input,label); } else row.append(input);
      return row;
    }));
    dialog.showModal(); fields.querySelector('input,textarea').focus();
  }
  form.onsubmit = async event => {
    event.preventDefault();
    const data = {};
    for (const input of fields.querySelectorAll('input,textarea')) data[input.name] = input.type === 'checkbox' ? input.checked : input.value;
    if (kind === 'poll') data.options = data.options.split('\n');
    const submit = form.querySelector('.primary');
    submit.disabled = true;
    try { await api.sendSpecial(state.active,state.thread.chat,kind,data); dialog.close(); }
    catch (error) { get('special-error').textContent = translationError(error); }
    finally { submit.disabled = false; }
  };
  get('special-cancel').onclick = () => dialog.close();
  get('attach').onclick = () => {
    const items = [['clip','图片或文件',()=>{ menu.hidePopover(); composerExtras.pick(); }],['pin','位置',()=>open('location')],
      ['person','联系人名片',()=>open('contact')],['poll','投票',()=>open('poll')]].map(([symbol,label,work]) => {
      const button = el('button'); button.type = 'button'; button.setAttribute('role','menuitem');
      button.append(icon(symbol),label); button.onclick = work; return button;
    });
    menu.replaceChildren(...items); menu.showPopover();
    const box = get('attach').getBoundingClientRect(), own = menu.getBoundingClientRect();
    menu.style.left = Math.max(8,box.left)+'px'; menu.style.top = Math.max(8,box.top-own.height-6)+'px';
    items[0].focus({preventScroll:true});
  };
})();
const statusUpdates = (() => {
  const dialog = get('status-dialog'), owner = get('status-owner'), list = get('status-list'), note = get('status-note');
  let image = null, ticket = 0;
  const when = time => new Date(time).toLocaleString('zh-CN',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
  async function load() {
    const mine = ++ticket, account = owner.value;
    list.replaceChildren(); note.textContent = '正在读取动态…';
    try {
      const rows = await api.statusList(account);
      if (mine !== ticket) return;
      note.textContent = rows.length ? '' : '最近 24 小时没有动态';
      list.replaceChildren(...rows.map(row => {
        const button = el('button','person-result status-row'+(row.unread ? ' unseen' : ''));
        button.type = 'button';
        const words = el('span','');
        words.append(el('strong','',row.mine ? '我的动态' : row.title),el('small','',row.total+' 条 · '+when(row.time)));
        button.append(avatar(row.title,row.chat,account),words);
        button.onclick = () => show(account,row);
        return button;
      }));
    } catch (error) { if (mine === ticket) note.textContent = translationError(error); }
  }
  async function show(account,row) {
    const mine = ++ticket;
    note.textContent = '正在读取…';
    try {
      const items = await api.statusItems(account,row.chat);
      if (mine !== ticket) return;
      note.textContent = '';
      const back = el('button','detail-action','‹ 返回动态列表'); back.type = 'button'; back.onclick = load;
      list.replaceChildren(back,el('h3','status-heading',row.mine ? '我的动态' : row.title),...items.map(item => {
        const card = el('article','status-item');
        if (item.media && ['image','video','ptt','audio'].includes(item.media.kind)) {
          const view = el('button','status-media',item.media.kind === 'image' ? '点击查看图片' : '点击播放');
          view.type = 'button';
          view.onclick = async () => {
            view.disabled = true; view.textContent = '正在加载…';
            try {
              const src = await api.statusMedia(account,item.id,{kind:item.media.kind});
              const node = item.media.kind === 'image' ? new Image() : document.createElement(item.media.kind === 'video' ? 'video' : 'audio');
              node.src = src; if (item.media.kind !== 'image') node.controls = node.autoplay = true;
              view.replaceWith(node);
            } catch (error) { view.disabled = false; view.textContent = '加载失败，点击重试'; }
          };
          card.append(view);
        }
        if (item.text) { const body = el('p','status-text',item.text); body.dir = 'auto'; if (!item.media && item.color) body.style.setProperty('--status-color',item.color); body.classList.toggle('plain',!item.media); card.append(body); }
        card.append(el('time','',when(item.time)));
        return card;
      }));
      if (!items.length) note.textContent = '这位联系人的动态已过期';
    } catch (error) { if (mine === ticket) note.textContent = translationError(error); }
  }
  get('open-status').onclick = () => {
    const online = state.accounts.filter(a=>a.status === 'online');
    if (!online.length) { warning('请先连接一个 WhatsApp 账号'); return; }
    owner.replaceChildren(...online.map(account => new Option([account.name,account.linkedPhone].filter(Boolean).join(' · '),account.id)));
    owner.value = online.some(a=>a.id === (state.feedScope || state.active)) ? state.feedScope || state.active : online[0].id;
    get('status-text').value = ''; image = null; get('status-image-name').textContent = '';
    dialog.showModal(); load();
  };
  owner.onchange = load;
  get('status-close').onclick = () => dialog.close();
  dialog.onclose = () => { ticket++; list.replaceChildren(); };
  get('status-image').onclick = () => get('status-image-input').click();
  get('status-image-input').onchange = () => {
    const file = get('status-image-input').files[0]; get('status-image-input').value = '';
    if (!file) return;
    if (file.size > 16*1048576) { warning('图片不能超过 16 MB'); return; }
    const reader = new FileReader();
    reader.onload = () => { image = reader.result; get('status-image-name').textContent = file.name; };
    reader.readAsDataURL(file);
  };
  get('status-form').onsubmit = async event => {
    event.preventDefault();
    const submit = get('status-form').querySelector('.primary');
    submit.disabled = true;
    try {
      await api.statusPost(owner.value,{text:get('status-text').value,image});
      get('status-text').value = ''; image = null; get('status-image-name').textContent = '';
      warning('动态已发布'); load();
    } catch (error) { note.textContent = translationError(error); }
    finally { submit.disabled = false; }
  };
})();
const callBar = (() => {
  const bar = get('call-bar');
  let calls = [], ticker = null;
  const labels = call => call.state === 'ringing' ? (call.video ? '视频来电' : '语音来电') : call.state === 'calling' ? '正在呼叫…' : '通话中 ' + clock(call);
  function clock(call) {
    const seconds = Math.max(0,Math.floor((Date.now()-call.since)/1000));
    return Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');
  }
  function action(call,label,name,value,kind) {
    const button = el('button',kind || '',label);
    button.type = 'button'; button.onclick = () => run(()=>api.callAction(call.accountId,name,value));
    return button;
  }
  function draw() {
    bar.hidden = !calls.length;
    bar.replaceChildren(...calls.map(call => {
      const row = el('div','call-row '+call.state);
      const words = el('span','call-words');
      words.append(el('strong','',call.title),el('small','',call.accountName+' · '+labels(call)));
      const buttons = el('span','call-buttons');
      if (call.state === 'ringing' && call.incoming) buttons.append(action(call,'接听','accept',null,'accept'),action(call,'拒绝','end',null,'hangup'));
      else {
        if (call.state === 'active') buttons.append(action(call,call.muted ? '取消静音' : '静音','mute',!call.muted));
        if (call.video) buttons.append(action(call,'视频窗口','window'));
        buttons.append(action(call,'挂断','end',null,'hangup'));
      }
      const mark = el('i','call-icon'); mark.append(icon(call.video ? 'video' : 'phone'));
      row.append(mark,words,buttons);
      return row;
    }));
  }
  for (const [id,video] of [['call-voice',false],['call-video',true]]) get(id).onclick = () => run(()=>api.callStart(state.active,state.thread.chat,video));
  return {render(s) {
    calls = s.calls || [];
    const direct = Boolean(s.thread && !s.thread.chat.endsWith('@g.us'));
    get('call-voice').hidden = get('call-video').hidden = !direct;
    get('call-voice').disabled = get('call-video').disabled = calls.some(c=>c.accountId === s.active);
    clearInterval(ticker); ticker = calls.some(c=>c.state === 'active') ? setInterval(draw,1000) : null;
    draw();
  }};
})();
// Right-click menu on a conversation row.
const chatMenu = (() => {
  const menu = get('chat-menu');
  function open(chat, row, event) {
    const set = (key,value,done) => () => { menu.hidePopover(); run(async()=>{ await api.chatSetting(chat.accountId,chat.chat,key,value); if (done) warning(done); }); };
    const items = [
      ['pin',chat.pinned ? '取消置顶' : '置顶',set('pinned',!chat.pinned)],
      ['mute',chat.muted ? '取消静音' : '静音通知',set('muted',!chat.muted)],
      ['archive',chat.archived ? '取消归档' : '归档',set('archived',!chat.archived,chat.archived ? '已移回会话列表' : '已归档，可在「已归档」中查看')],
      ['chat',chat.unreadCount ? '标为已读' : '标为未读',set('unread',!chat.unreadCount)]
    ].map(([symbol,label,work]) => {
      const button = el('button'); button.type = 'button'; button.setAttribute('role','menuitem');
      button.append(icon(symbol),label); button.onclick = work; return button;
    });
    menu.replaceChildren(el('strong','chat-menu-title',chat.title),...items);
    menu.showPopover();
    const box = row.getBoundingClientRect(), own = menu.getBoundingClientRect();
    const x = event.clientX || box.left + 40, y = event.clientY || box.bottom;
    menu.style.left = Math.max(8,Math.min(x,innerWidth-own.width-8))+'px';
    menu.style.top = Math.max(8,Math.min(y,innerHeight-own.height-8))+'px';
    items[0].focus({preventScroll:true});
  }
  for (const id of ['chat-menu','attach-menu']) get(id).addEventListener('keydown',event => {
    const buttons = [...get(id).querySelectorAll('button')], i = buttons.indexOf(document.activeElement);
    const step = {ArrowDown:1,ArrowUp:-1}[event.key];
    if (step) { event.preventDefault(); buttons[(i+step+buttons.length)%buttons.length].focus(); }
  });
  return {open};
})();
