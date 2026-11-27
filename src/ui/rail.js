const root = document.documentElement;
root.classList.add('platform-' + window.desk.platform);
function renderRail(state, statuses, select) {
  const all = document.getElementById('all');
  all.classList.toggle('selected', !state.feedScope);
  all.setAttribute('aria-pressed',String(!state.feedScope));
  const tones = accountTones(state.accounts);
  const items = state.accounts.map(account => {
    const button = document.createElement('button');
    button.className = 'rail-button account' + (account.id === state.feedScope ? ' selected' : '');
    const status = snapshotOf(account) ? 'WhatsApp 已异常退出' : statuses[account.status] || account.status;
    button.title = [account.name, account.linkedPhone, status].filter(Boolean).join(' · ') + (account.unread ? ' · ' + account.unread + ' 条未读' : '');
    button.setAttribute('aria-label',button.title);
    button.setAttribute('aria-pressed', String(account.id === state.feedScope));
    button.dataset.account=account.id;
    button.setAttribute('aria-haspopup','menu');
    if (accountMenu.target===account.id) button.dataset.menuOwner='true';
    button.oncontextmenu=event=>{event.preventDefault();accountMenu.open(account.id,button);};
    button.onkeydown=event=>{
      if(event.key==='ContextMenu' || (event.shiftKey && event.key==='F10')){
        event.preventDefault();accountMenu.open(account.id,button);
      }
    };
    button.onclick = () => select(account.id);
    // Accounts can be dragged into another order.
    button.draggable = true;
    button.ondragstart = event => { event.dataTransfer.setData('text/account',account.id); event.dataTransfer.effectAllowed = 'move'; };
    button.ondragover = event => { if ([...event.dataTransfer.types].includes('text/account')) { event.preventDefault(); button.classList.add('drop-target'); } };
    button.ondragleave = () => button.classList.remove('drop-target');
    button.ondrop = event => {
      event.preventDefault(); button.classList.remove('drop-target');
      const moved = event.dataTransfer.getData('text/account'), order = state.accounts.map(item=>item.id).filter(id=>id !== moved);
      if (!moved || moved === account.id) return;
      order.splice(order.indexOf(account.id),0,moved);
      window.desk.reorder(order).catch(()=>{});
    };
    const tile = document.createElement('span');
    tile.className = 'tile ' + tones.get(account.id);
    tile.append(avatarPhotos.face(account.id,'self'));
    const dot = document.createElement('i');
    dot.className = 'status-dot ' + (snapshotOf(account)?'dropped':account.status);
    tile.append(dot);
    button.append(tile);
    if (account.unread > 0) {
      const badge = document.createElement('span');
      badge.className = 'badge'; badge.textContent = countLabel(account.unread);
      button.append(badge);
    }
    return button;
  });
  // Preserve keyboard focus across background message updates.
  const list = document.getElementById('accounts');
  const focusIndex = Array.from(list.children).indexOf(document.activeElement);
  list.replaceChildren(...items);
  if (focusIndex >= 0) list.children[focusIndex]?.focus({preventScroll:true});
}
