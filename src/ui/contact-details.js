// Contact info as WhatsApp shows it, with the remark and chat switches editable in place.
const contactDetails = (() => {
  const box = get('profile-details'), dialog = get('remark-dialog');
  let key = null, target = null, info = null, failed = false;
  const current = () => target && state?.active === target.account && state.thread?.chat === target.chat;
  async function load() {
    const request = key;
    try {
      const result = await api.contactInfo(target.account,target.chat);
      if (request === key) { info = result; failed = false; }
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
        const next = !info[name];
        button.disabled = true;
        try { await api.chatSetting(target.account,target.chat,name,next); info[name] = next; }
        finally { draw(); }
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
  function draw() {
    const group = target?.chat.endsWith('@g.us');
    const named = Boolean(info?.remark);
    get('remark-edit').hidden = !target || group || !info;
    get('reader-phone').hidden = !named || !info.phone;
    get('reader-phone').textContent = named ? info.phone : '';
    get('profile-kind').textContent = group ? 'WhatsApp 群聊' + (info?.members ? ' · ' + info.members + ' 位成员' : '') :
      [info?.phone,info?.business ? '商业账号' : ''].filter(Boolean).join(' · ') || 'WhatsApp 会话';
    if (!info) { box.replaceChildren(el('p','detail-note',failed ? '暂时无法读取资料，请稍后重试。' : '正在读取资料…')); return; }
    const rows = [];
    if (group) {
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
    const switches = el('div','switches');
    switches.append(toggle('bell','静音通知','muted'),toggle('pin','置顶聊天','pinned'),toggle('archive','归档聊天','archived'));
    if (!group) switches.append(toggle('block','屏蔽联系人','blocked',true));
    box.replaceChildren(...rows,switches);
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
  return {show(owner, thread) {
    // A changed title means the contact was renamed, so the details are read again.
    const next = JSON.stringify([owner.id,thread.chat,owner.status === 'online',thread.title]);
    if (next === key) return;
    const same = target?.account === owner.id && target.chat === thread.chat;
    key = next; target = {account:owner.id,chat:thread.chat}; failed = owner.status !== 'online';
    if (!same) info = null;
    draw();
    if (!failed) void load();
  }, hide() { if (dialog.open) dialog.close(); key = target = info = null; get('remark-edit').hidden = get('reader-phone').hidden = true; }};
})();
