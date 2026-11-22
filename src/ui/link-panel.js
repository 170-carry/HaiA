const pairingPanel = (() => {
  const node = id => document.getElementById(id);
  let active = null, mode = 'qr', lastLink = null, qr = '', error = '';
  const busy = new Set();
  function draw() {
    const isCode = active && mode === 'code';
    const code = isCode ? lastLink?.code : '';
    node('pair-mode').hidden = !active;
    node('qr-mode').setAttribute('aria-pressed',String(mode==='qr'));
    node('code-mode').setAttribute('aria-pressed',String(mode==='code'));
    node('qr').hidden = !(active && !isCode && qr);
    if (!node('qr').hidden) {
      if (node('qr').src !== qr) node('qr').src = qr;
    } else node('qr').removeAttribute('src');
    node('phone-form').hidden = !isCode || !!code;
    node('request-code').disabled = busy.has(active) || lastLink?.state==='pending';
    node('qr-mode').disabled = busy.has(active);
    node('link-code').hidden = !code;
    node('link-code').textContent = code ? code.slice(0,4)+' – '+code.slice(4) : '';
    const hints = {expired:'关联码已过期，请重新获取。',failed:'获取失败，请确认区号和手机号后重试。',pending:'正在向 WhatsApp 获取关联码…'};
    const status = isCode ? error || hints[lastLink?.state] || '' : '';
    node('link-status').hidden = !status; node('link-status').textContent = status;
    if (active) node('help').textContent = isCode ? (code ?
      '在手机 WhatsApp 打开「已关联设备」→「关联设备」→「改用电话号码关联」，输入下方 8 位码。' :
      '输入这个账号注册的手机号，在对应手机上确认关联。') :
      '在手机 WhatsApp 打开「已关联设备」→「关联设备」，扫描二维码。';
  }
  node('code-mode').onclick = () => { mode = 'code';draw();if (!lastLink?.code) node('phone').focus(); };
  node('qr-mode').onclick = async () => {
    if (!active || busy.has(active) || mode === 'qr') return;
    const id = active;
    if (lastLink && lastLink.state !== 'idle') {
      try { await window.desk.pair(id,null); }
      catch { if (active === id) {error='请在账号菜单中重新连接。';draw();} return; }
    }
    if (active === id) { mode='qr';error='';lastLink=null;node('phone').value='';draw(); }
  };
  node('phone-form').onsubmit = async event => {
    event.preventDefault();
    const phone = normalizePairingPhone(node('phone').value);
    if (!phone) { error='请填写国家区号和完整手机号。';draw();return; }
    const id=active;
    if (!id || mode!=='code' || busy.has(id)) return;
    busy.add(id);error='';draw();
    try { await window.desk.pair(id,phone); }
    catch { if (active===id) error='无法获取关联码，请检查号码后重试。'; }
    finally {busy.delete(id);draw();}
  };
  return {render(id,link,image) {
    if (id!==active) {
      active=id;mode=link && link.state!=='idle' ? 'code':'qr';
      node('phone').value='';error='';
    }
    lastLink=link;qr=image;draw();
  }};
})();
