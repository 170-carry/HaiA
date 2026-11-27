// Rail button and dialog that separate healthy accounts from ones that were logged out or cannot connect.
const accountHealth = (() => {
  const dialog = get('health-dialog'), list = get('health-list'), button = get('health');
  const reasons = {account_locked:'账号已被 WhatsApp 锁定或封禁，请在手机 WhatsApp 上按提示验证号码或请求审核', user_initiated:'已在手机上移除此关联设备',
    client_version_outdated:'WhatsApp 网页版本过旧', unknown_companion:'WhatsApp 不再识别此关联设备', md_opt_out:'手机端关闭了多设备登录',
    primary_identity_key_change:'手机端重新注册了 WhatsApp'};
  const when = time => new Date(time).toLocaleString('zh-CN',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
  // Time left on a restriction, to the minute.
  function left(until) {
    const minutes = Math.max(1,Math.ceil((until - Date.now()) / 60000)), days = Math.floor(minutes / 1440), hours = Math.floor(minutes % 1440 / 60);
    return (days ? days + ' 天 ' : '') + (days || hours ? hours + ' 小时 ' : '') + (minutes % 60) + ' 分钟';
  }
  const limitNote = account => !account?.restriction ? '' : (account.restriction.type==='RESTRICT_ALL_COMPANIONS'?'所有关联设备受限':'被限制向新联系人发消息') + (account.restriction.pendingVerification ? ' · 已到预计时间，等待官方状态确认' : account.restriction.until ? ' · ' + left(account.restriction.until) + '后预计到期' : '');
  function kind(account) {
    if (account.restriction) return 'limit';
    if (account.status === 'online') return 'ok';
    if (account.dropped || ['offline','adapter-error'].includes(account.status)) return 'bad';
    return 'wait';
  }
  function detail(account) {
    if (account.restriction) return limitNote(account) + (account.restriction.until ? '（' + when(account.restriction.until) + '）' : '') +
      (account.status==='online'?'。当前网页仍连接，可继续处理允许的已有会话。':'。网页关联已断开，请在官方手机端查看限制；已保留此账号的本地记录。');
    if(account.appeal?.source==='official-phone-screen') {
      const labels={'in-review':'手机官方页面显示正在审核','unbanned':'手机官方页面显示可以重新使用 WhatsApp，请在手机完成验证后重新关联','banned':'手机官方页面显示无法请求审核','can-review':'手机官方页面显示可以请求审核'};
      return labels[account.appeal.state]+' · 最后核对 '+when(account.appeal.checkedAt);
    }
    if(account.appeal?.state==='watching') return '已开启恢复监控 · '+when(account.appeal.startedAt)+'。请在手机官方 WhatsApp 中查看审核结果；检测到网页恢复连接时会更新。';
    if (account.status === 'online') return account.historySync ? '运行正常 · 历史消息还在从手机同步' + (account.historySync.progress != null ? '（' + account.historySync.progress + '%）' : '') + '，请保持手机上的 WhatsApp 打开并联网' : '运行正常';
    if (account.dropped) return when(account.dropped.at) + ' 异常退出 · ' + (reasons[account.dropped.reason] || '网页关联已断开，尚未收到明确原因，请在手机 WhatsApp 中确认');
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
    if(account.accountHealth==='locked') {
      const help=el('button','health-action','官方申诉说明');
      help.onclick=()=>run(()=>api.accountHelp(account.id));
      item.append(help);
      if(account.appeal?.state!=='watching') {
        const watch=el('button','health-action','已在手机提交，监控恢复');
        watch.onclick=()=>run(()=>api.watchAccountReview(account.id));
        item.append(watch);
      }
    }
    if(!account.historyOnly && (account.restriction || account.dropped)) {
      const phone=el('button','health-action','读取手机审核状态');
      phone.onclick=()=>run(async()=>{phone.disabled=true;try{await api.readPhoneReview(account.id);}finally{phone.disabled=false;}});
      item.append(phone);
      if(account.appealMonitor) {
        const stop=el('button','health-action','停止手机监控');
        stop.onclick=()=>run(()=>api.stopPhoneReview(account.id));item.append(stop);
      }

      const inspect=el('button','health-action','查看网页状态');
      inspect.onclick=()=>run(()=>api.inspectAccount(account.id));
      item.append(inspect);
    }
    if (account.status !== 'online' && !account.historyOnly) {
      const relink = account.status === 'pair';
      const action = el('button','health-action',relink ? (account.dropped ? '重新关联' : '去关联') : '重新连接');
      action.type = 'button';
      action.onclick = () => run(async () => {
        if (relink) { dialog.close(); await showPairing(account); }
        else { action.disabled = true; await api.reload(account.id); }
      });
      item.append(action);
    }
    return item;
  }
  function draw(s) {
    const groups = {bad:[],limit:[],wait:[],ok:[]}, tones = accountTones(s.accounts);
    for (const account of s.accounts) groups[kind(account)].push(account);
    button.hidden = !s.accounts.length;
    const flagged = groups.bad.length + groups.limit.length;
    button.classList.toggle('alert',flagged > 0);
    get('health-count').hidden = !flagged;
    get('health-count').textContent = String(flagged);
    button.title = [groups.bad.length ? groups.bad.length + ' 个账号异常' : '',groups.limit.length ? groups.limit.length + ' 个账号受限' : ''].filter(Boolean).join(' · ') || '账号状态：全部正常';
    button.setAttribute('aria-label',button.title);
    if (!dialog.open) return;
    get('health-summary').textContent = groups.ok.length + ' 个正常 · ' + groups.bad.length + ' 个异常' + (groups.limit.length ? ' · ' + groups.limit.length + ' 个受限' : '') + (groups.wait.length ? ' · ' + groups.wait.length + ' 个待关联或连接中' : '');
    const parts = [];
    for (const [name,title] of [['bad','异常账号'],['limit','受限账号'],['wait','待关联 / 连接中'],['ok','正常账号']]) {
      if (!groups[name].length) continue;
      parts.push(el('h3','health-title '+name,title + ' · ' + groups[name].length),...groups[name].map(account=>row(account,tones)));
    }
    list.replaceChildren(...parts);
  }
  button.onclick = () => { dialog.showModal(); draw(state); };
  get('health-close').onclick = () => dialog.close();
  // Keeps the countdown moving while nothing else changes.
  setInterval(() => { if (state?.accounts.some(account => account.restriction)) { stamps.clear(); render(state); } },30000);
  return {draw,limitNote};
})();
