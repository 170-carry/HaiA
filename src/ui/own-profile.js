// The account's own profile: picture, WhatsApp name, about text, privacy and blocked contacts.
const ownProfile = (() => {
  const dialog = get('account-dialog'), note = get('own-note');
  let account = null, ticket = 0;
  const owner = () => state?.accounts.find(item => item.id === account);
  const say = text => { note.textContent = text; };
  const choices = {all:'所有人', contacts:'我的联系人', none:'没有人', contact_blacklist:'我的联系人，部分除外', match_last_seen:'与最后上线时间相同'};
  const privacyRows = [['lastSeen','最后上线时间',['all','contacts','none']],['online','在线状态',['all','match_last_seen']],['profilePicture','头像',['all','contacts','none']],
    ['about','个性签名',['all','contacts','none']],['groupAdd','谁可以把我加入群组',['all','contacts']],['readReceipts','已读回执',['all','none']]];
  function head() {
    const me = owner();
    if (!me) return;
    get('account-photo').className = 'avatar ' + accountTones(state.accounts).get(me.id);
    get('account-photo').replaceChildren(avatarPhotos.face(me.id,'self'));
    get('account-name').textContent = me.name;
    get('account-phone').textContent = me.linkedPhone || '尚无已关联手机号';
    get('account-connection').textContent = statusText[me.status] || me.status;
  }
  // After a change to the picture the avatars around the window are drawn again.
  function refreshFaces() { avatarPhotos.forget(account,'self'); stamps.clear(); render(state); head(); }
  async function load() {
    const mine = ++ticket, me = owner();
    get('own-label').value = me.name;
    get('own-online').hidden = true;
    for (const id of ['own-photo-pick','own-photo-remove']) get(id).disabled = me.status !== 'online';
    if (me.status !== 'online') { say('账号连接后才能修改 WhatsApp 资料。'); return; }
    say('正在读取资料…');
    try {
      const info = await api.profileInfo(account);
      if (mine !== ticket) return;
      say('');
      get('own-online').hidden = false;
      get('own-name').value = info.name; get('own-about').value = info.about;
      get('own-privacy').hidden = !info.privacy;
      if (info.privacy) get('own-privacy-rows').replaceChildren(...privacyRows.map(([key,label,options]) => {
        const row = el('label','own-privacy-row',label), select = el('select');
        const current = info.privacy[key];
        select.replaceChildren(...[...new Set([...options,current])].filter(Boolean).map(value => { const option = new Option(key === 'readReceipts' ? {all:'开启',none:'关闭'}[value] || value : choices[value] || value,value); option.disabled = !options.includes(value); return option; }));
        select.value = current;
        select.onchange = () => run(async () => {
          try { await api.saveProfile(account,'privacy:' + key,select.value); info.privacy[key] = select.value; say(label + '已更新'); }
          catch (error) { select.value = info.privacy[key]; throw error; }
        });
        row.append(select); return row;
      }));
      get('own-blocked').hidden = !info.blocked.length;
      get('own-blocked-title').textContent = '已屏蔽的联系人 · ' + info.blocked.length;
      get('own-blocked-rows').replaceChildren(...info.blocked.map(person => {
        const row = el('div','own-blocked-row'), button = el('button','','解除屏蔽');
        button.type = 'button';
        button.onclick = () => run(async () => { button.disabled = true; await api.saveProfile(account,'unblock',person.id); row.remove(); say('已解除对 ' + person.name + ' 的屏蔽'); });
        row.append(el('span','',person.name),button); return row;
      }));
    } catch (error) { if (mine === ticket) say(translationError(error)); }
  }
  for (const form of dialog.querySelectorAll('.own-field')) form.onsubmit = event => {
    event.preventDefault();
    const field = form.dataset.field, input = form.querySelector('input'), button = form.querySelector('button');
    button.disabled = true;
    run(async () => {
      try { await api.saveProfile(account,field,input.value); say(form.querySelector('label').textContent.split('（')[0] + '已保存'); if (field === 'label') head(); }
      finally { button.disabled = false; }
    });
  };
  // WhatsApp shows the picture as a square, so the middle of the image is cut out and scaled to 640 px.
  async function square(file) {
    const image = await createImageBitmap(file), side = Math.min(image.width,image.height), canvas = document.createElement('canvas');
    canvas.width = canvas.height = Math.min(640,side);
    canvas.getContext('2d').drawImage(image,(image.width - side) / 2,(image.height - side) / 2,side,side,0,0,canvas.width,canvas.height);
    return canvas.toDataURL('image/jpeg',0.9);
  }
  get('account-photo').onclick = get('own-photo-pick').onclick = () => { if (owner()?.status === 'online') get('own-photo-input').click(); };
  get('own-photo-input').onchange = () => {
    const file = get('own-photo-input').files[0]; get('own-photo-input').value = '';
    if (!file) return;
    run(async () => { say('正在更新头像…'); await api.saveProfile(account,'photo',await square(file)); say('头像已更新'); refreshFaces(); });
  };
  get('own-photo-remove').onclick = () => run(async () => { await api.saveProfile(account,'removePhoto'); say('头像已移除'); refreshFaces(); });
  get('account-close').onclick = () => dialog.close();
  dialog.addEventListener('close',() => { ticket++; });
  get('dock-profile').onclick = () => { if (state?.feedScope) open(state.feedScope); else get('health').click(); };
  function open(id) { account = id; head(); say(''); if (!dialog.open) dialog.showModal(); load(); }
  return {open};
})();
