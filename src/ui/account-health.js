// Rail button and dialog that separate healthy accounts from ones that were logged out or cannot connect.
const accountHealth = (() => {
  const dialog = get('health-dialog'), list = get('health-list'), button = get('health');
  const reasons = {account_locked:'账号已被 WhatsApp 锁定或封禁', user_initiated:'已在手机上移除此关联设备',
    client_version_outdated:'WhatsApp 网页版本过旧', unknown_companion:'WhatsApp 不再识别此关联设备', md_opt_out:'手机端关闭了多设备登录',
    primary_identity_key_change:'手机端重新注册了 WhatsApp'};
  const when = time => new Date(time).toLocaleString('zh-CN',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
  function kind(account) {
    if (account.status === 'online') return 'ok';
    if (account.dropped || ['offline','adapter-error'].includes(account.status)) return 'bad';
    return 'wait';
  }
  function detail(account) {
    if (account.status === 'online') return account.historySync ? '运行正常 · 历史消息还在从手机同步' + (account.historySync.progress != null ? '（' + account.historySync.progress + '%）' : '') + '，请保持手机上的 WhatsApp 打开并联网' : '运行正常';
    if (account.dropped) return when(account.dropped.at) + ' 异常退出 · ' + (reasons[account.dropped.reason] || '被 WhatsApp 强制退出，可能触发了风控或临时封号');
    if (account.status === 'offline') return '无法连接 WhatsApp，请检查网络后重新连接';
    if (account.status === 'adapter-error') return '消息接口异常，请重新连接';
    return account.status === 'pair' ? '尚未关联 WhatsApp' : statusText[account.status] || account.status;
  }
  function row(account, tones) {
    const item = el('div','health-row '+kind(account));
    const tile = el('span','avatar '+tones.get(account.id));
    tile.append(avatarPhotos.face(account.id,'self'));
    const words = el('span','health-words');
    const phone = account.linkedPhone || (account.phone ? '+' + account.phone : '');
    words.append(el('strong','',[account.name,phone].filter(Boolean).join(' · ')),el('small','',detail(account)));
    item.append(tile,words);
    if (account.status !== 'online') {
      const relink = account.status === 'pair';
      const action = el('button','health-action',relink ? (account.dropped ? '重新关联' : '去关联') : '重新连接');
      action.type = 'button';
      action.onclick = () => run(async () => {
        if (relink) { dialog.close(); await api.select(account.id); }
        else { action.disabled = true; await api.reload(account.id); }
      });
      item.append(action);
    }
    return item;
  }
  function draw(s) {
    const groups = {bad:[],wait:[],ok:[]}, tones = accountTones(s.accounts);
    for (const account of s.accounts) groups[kind(account)].push(account);
    button.hidden = !s.accounts.length;
    button.classList.toggle('alert',groups.bad.length > 0);
    get('health-count').hidden = !groups.bad.length;
    get('health-count').textContent = String(groups.bad.length);
    button.title = groups.bad.length ? groups.bad.length + ' 个账号异常' : '账号状态：全部正常';
    button.setAttribute('aria-label',button.title);
    if (!dialog.open) return;
    get('health-summary').textContent = groups.ok.length + ' 个正常 · ' + groups.bad.length + ' 个异常' + (groups.wait.length ? ' · ' + groups.wait.length + ' 个待关联或连接中' : '');
    const parts = [];
    for (const [name,title] of [['bad','异常账号'],['wait','待关联 / 连接中'],['ok','正常账号']]) {
      if (!groups[name].length) continue;
      parts.push(el('h3','health-title '+name,title + ' · ' + groups[name].length),...groups[name].map(account=>row(account,tones)));
    }
    list.replaceChildren(...parts);
  }
  button.onclick = () => { dialog.showModal(); draw(state); };
  get('health-close').onclick = () => dialog.close();
  return {draw};
})();
