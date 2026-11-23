// Contact info as WhatsApp shows it, with the remark and chat switches editable in place.
const contactDetails = (() => {
  const box = get('profile-details'), dialog = get('remark-dialog');
  let key = null, target = null, info = null, failed = false, labels = null;
  const current = () => target && state?.active === target.account && state.thread?.chat === target.chat;
  async function load() {
    const request = key;
    try {
      const result = await api.contactInfo(target.account,target.chat);
      const tags = await api.chatLabels(target.account,target.chat).catch(()=>null);
      if (request === key) { info = result; labels = tags; failed = false; }
    } catch { if (request === key) failed = true; }
    if (request === key) draw();
  }
  function field(label,value,action) {
    const row = el('div','detail');
    const body = el('span','detail-value',value); body.dir = 'auto';
    row.append(el('span','detail-label',label),body);
    if (action) row.append(action);
    return row;
  }
  function toggle(symbol,label,name,danger) {
    const button = el('button','switch-row'+(danger ? ' danger-item' : ''));
    button.type = 'button'; button.setAttribute('role','switch'); button.setAttribute('aria-checked',String(!!info[name]));
    button.append(icon(symbol),el('span','',label),el('i','switch'));
    button.onclick = () => {
      const work = async () => {
        // The answer may arrive after another conversation was opened; it then belongs to the details read earlier.
        const details = info, chat = target, next = !details[name];
        button.disabled = true;
        try { await api.chatSetting(chat.account,chat.chat,name,next); details[name] = next; }
        finally { if (info === details) draw(); }
      };
      if (name === 'blocked' && !info.blocked) {
        get('action-title').textContent = '屏蔽联系人'; get('action-detail').textContent = '屏蔽后，对方将无法给这个账号发送消息或拨打电话。';
        get('action-confirm').textContent = '屏蔽';
        get('action-confirm').onclick = () => { get('confirm-action').close(); run(work); };
        get('confirm-action').showModal();
      } else run(work);
    };
    return button;
  }
  // Labels exist on WhatsApp Business accounts only; other accounts return none and the section stays hidden.
  function labelBox() {
    const wrap = el('div','detail');
    wrap.append(el('span','detail-label','标签'));
    const chips = el('div','label-chips');
    const change = (id,on,name) => run(async()=>{ await api.setLabel(target.account,target.chat,id,on,name); labels = await api.chatLabels(target.account,target.chat).catch(()=>labels); draw(); });
    for (const label of labels) {
      const chip = el('button','label-chip',label.name);
      chip.type = 'button'; chip.setAttribute('aria-pressed',String(label.on)); chip.style.setProperty('--label',label.color);
      chip.onclick = () => change(label.id,!label.on);
      chips.append(chip);
    }
    const input = el('input','label-new'); input.placeholder = '+ 新标签'; input.maxLength = 100; input.setAttribute('aria-label','新标签名称，按回车创建');
    input.onkeydown = event => { if (event.key === 'Enter' && input.value.trim()) { event.preventDefault(); change('',true,input.value.trim()); } };
    chips.append(input); wrap.append(chips);
    return wrap;
  }
  // Shows why the composer is locked: the group is suspended, admin-only, or this number has left or blocked the chat.
  function limit() {
    const limits = info?.limits, muted = limits?.announce && !limits.admin;
    const reason = !info ? '' : limits?.terminated ? '此群已被 WhatsApp 永久关闭，无法发送消息。' : limits?.suspended ? '此群已被 WhatsApp 停用，无法发送消息。' :
      limits?.left ? '你已不在此群中，无法发送消息。' : muted ? '此群已开启全员禁言，仅管理员可以发送消息。' :
      info.blocked ? '你已屏蔽此联系人，取消屏蔽后才能发送消息。' : limits?.blocked ? 'WhatsApp 不允许在此会话中发送消息。' : '';
    const tag = limits?.terminated ? '已关闭' : limits?.suspended ? '已停用' : limits?.left ? '已退出' : limits?.announce ? '全员禁言' : '';
    get('chat-limit').hidden = !tag; get('chat-limit').textContent = tag;
    get('chat-notice').hidden = !reason && !(limits?.announce && limits.admin);
    get('chat-notice').textContent = reason || '此群已开启全员禁言，你是管理员，仍可发言。';
    const locked = Boolean(reason);
    if (get('composer').classList.toggle('locked',locked) !== lockedBefore) { lockedBefore = locked; get('reply').dispatchEvent(new Event('input')); }
  }
  let lockedBefore = false;
  function draw() {
    const group = target?.chat.endsWith('@g.us');
    const named = Boolean(info?.remark);
    get('remark-edit').hidden = !target || group || !info;
    get('reader-phone').hidden = !named || !info.phone;
    get('reader-phone').textContent = named ? info.phone : '';
    get('profile-kind').textContent = group ? 'WhatsApp 群聊' + (info?.members ? ' · ' + info.members + ' 位成员' : '') :
      [info?.phone,info?.business ? '商业账号' : ''].filter(Boolean).join(' · ') || 'WhatsApp 会话';
    if (!info) limit();
    if (!info) { box.replaceChildren(el('p','detail-note',failed ? '暂时无法读取资料，请稍后重试。' : '正在读取资料…')); return; }
    const rows = [];
    limit();
    if (group) {
      const states = info.limits ? [[info.limits.suspended,'已被 WhatsApp 停用'],[info.limits.terminated,'已被 WhatsApp 永久关闭'],[info.limits.left,'你已不在此群中'],
        [info.limits.announce,'全员禁言 · 仅管理员可发言'],[info.limits.restrict,'仅管理员可修改群资料'],[info.limits.approval,'新成员需管理员批准'],
        [info.limits.admin,'你是管理员']].filter(([on])=>on).map(([,label])=>label) : [];
      if (states.length) {
        const row = el('div','detail');
        row.append(el('span','detail-label','群状态'));
        const list = el('ul','limit-list');
        for (const label of states) list.append(el('li',/停用|关闭|不在|禁言/.test(label) ? 'warn' : '',label));
        row.append(list); rows.push(row);
      }
      if (info.description) rows.push(field('群描述',info.description));
      if (info.created) rows.push(field('创建时间',new Date(info.created).toLocaleDateString('zh-CN',{year:'numeric',month:'long',day:'numeric'})));
    } else {
      const edit = el('button','detail-action',named ? '修改' : '添加');
      edit.type = 'button'; edit.onclick = open;
      rows.push(field('备注',info.remark || '未设置',edit));
      if (info.nickname && info.nickname !== info.remark) rows.push(field('WhatsApp 昵称','~' + info.nickname));
      if (info.verified) rows.push(field('认证名称',info.verified));
      if (info.about) rows.push(field('个性签名',info.about));
      if (info.business) {
        for (const [label,value] of [['商家简介',info.business.description],['行业',info.business.category],['地址',info.business.address],
          ['邮箱',info.business.email],['网站',info.business.websites.join('\n')]]) if (value) rows.push(field(label,value));
      }
      if (info.groups.length) {
        const list = el('div','detail');
        list.append(el('span','detail-label','共同群组 · ' + info.groups.length));
        for (const item of info.groups) {
          const link = el('button','detail-group',item.title);
          link.type = 'button'; link.onclick = () => run(()=>api.openChat(target.account,item.chat));
          list.append(link);
        }
        rows.push(list);
      }
    }
    {
      const options = [[0,'关闭'],[86400,'24 小时'],[604800,'7 天'],[7776000,'90 天']];
      const row = el('div','detail');
      row.append(el('span','detail-label','消息定时消失'));
      if (!group || info.limits?.admin || !info.limits?.restrict) {
        const select = el('select','detail-select');
        select.replaceChildren(...options.map(([value,label]) => new Option(label,String(value))));
        if (!options.some(([value]) => value === info.ephemeral)) select.append(new Option(Math.round(info.ephemeral/86400)+' 天',String(info.ephemeral)));
        select.value = String(info.ephemeral);
        select.setAttribute('aria-label','消息定时消失');
        select.onchange = () => { const details = info, chat = target, seconds = Number(select.value); select.disabled = true; run(async()=>{
          try { await api.setEphemeral(chat.account,chat.chat,seconds); details.ephemeral = seconds; }
          finally { if (info === details) draw(); }
        }); };
        row.append(select);
      } else row.append(el('span','detail-value',(options.find(([value]) => value === info.ephemeral)?.[1] || Math.round(info.ephemeral/86400)+' 天')));
      rows.push(row);
    }
    const switches = el('div','switches');
    switches.append(toggle('bell','静音通知','muted'),toggle('pin','置顶聊天','pinned'),toggle('archive','归档聊天','archived'));
    if (!group) switches.append(toggle('block','屏蔽联系人','blocked',true));
    box.replaceChildren(...rows,...(labels ? [labelBox()] : []),switches);
  }
  function open() {
    if (!info || !current()) return;
    get('remark-name').value = info.remark; get('remark-error').textContent = '';
    get('remark-hint').textContent = (info.phone || state.thread.title) + ' 的备注会保存为这个 WhatsApp 账号里的联系人名称，手机通讯录不受影响。留空可清除备注。';
    dialog.showModal(); get('remark-name').select();
  }
  get('remark-edit').onclick = open;
  get('remark-cancel').onclick = () => dialog.close();
  get('remark-form').onsubmit = async event => {
    event.preventDefault();
    const name = get('remark-name').value.trim(), owner = key;
    if (name === info.remark) { dialog.close(); return; }
    get('remark-form').querySelector('.primary').disabled = true;
    try {
      await api.saveRemark(target.account,target.chat,name);
      dialog.close();
    } catch (error) { get('remark-error').textContent = '保存失败：' + translationError(error); }
    finally { get('remark-form').querySelector('.primary').disabled = false; }
  };
  return {show(owner, thread, notice) {
    // A changed title or a new group notice means the details may have changed, so they are read again.
    const next = JSON.stringify([owner.id,thread.chat,owner.status === 'online',thread.title,notice]);
    if (next === key) return;
    const same = target?.account === owner.id && target.chat === thread.chat;
    key = next; target = {account:owner.id,chat:thread.chat}; failed = owner.status !== 'online';
    if (!same) info = labels = null;
    draw();
    if (!failed) void load();
  }, hide() { if (dialog.open) dialog.close(); key = target = info = null; limit(); get('remark-edit').hidden = get('reader-phone').hidden = true; }};
})();
