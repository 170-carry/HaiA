const profilePanel = (() => {
  const node = id => document.getElementById(id);
  const wide = matchMedia('(min-width: 1080px)');
  const toggle = node('profile-toggle');
  let thread, compactOpen = false;
  let wideOpen = localStorage.getItem('profile-open') === 'true';
  function sync() {
    const open = Boolean(thread && (wide.matches ? wideOpen : compactOpen));
    node('profile').hidden = !open;
    toggle.disabled = !thread;
    toggle.setAttribute('aria-expanded', String(open));
  }
  toggle.onclick = () => {
    if (wide.matches) {
      wideOpen = !wideOpen;
      localStorage.setItem('profile-open', String(wideOpen));
    } else compactOpen = !compactOpen;
    sync();
  };
  wide.addEventListener('change', () => { compactOpen = false; sync(); });
  node('profile-reply').onclick = () => {
    compactOpen = false; sync(); node('reply').focus();
  };
  return { render(next, owner, statuses, messages) {
    const key = next && JSON.stringify([owner?.id, next.chat]);
    if (key !== thread) compactOpen = false;
    thread = key;
    sync();
    if (!next || !owner) { contactDetails.hide(); return; }
    node('profile-name').textContent = next.title;
    if (unchanged('profile',[owner.id,owner.photoIdentity,next.chat]) === false) {
      node('profile-avatar').className = 'avatar ' + tone(next.chat);
      node('profile-avatar').replaceChildren(avatarPhotos.face(owner.id,next.chat));
    }
    node('profile-owner').textContent = [owner.name,owner.linkedPhone].filter(Boolean).join(' · ');
    node('profile-status').textContent = statuses[owner.status] || owner.status;
    node('profile-date').textContent = messages.length ? new Date(messages[0].time).toLocaleString('zh-CN', {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '暂无消息';
    node('profile-reply').disabled = owner.status !== 'online';
    contactDetails.show(owner, next, messages.find(m=>m.system)?.id);
  }};
})();
