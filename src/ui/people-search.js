const peopleSearch = (() => {
  const node = id => document.getElementById(id);
  const dialog = node('people-dialog'), input = node('people-query'), results = node('people-results');
  let scope, label, online, timer, request = 0;
  function schedule() {
    const ticket = ++request;
    clearTimeout(timer);
    results.replaceChildren();
    const term = input.value.trim();
    if (!online || !term) {
      node('people-status').textContent = online ? '搜索范围 · ' + label : '请先连接这个范围内的 WhatsApp 账号';
      return;
    }
    node('people-status').textContent = '正在搜索…';
    timer = setTimeout(async () => {
      try {
        const {rows, failed} = await window.desk.searchPeople(term);
        if (ticket !== request || !dialog.open) return;
        node('people-status').textContent = (rows.length ? rows.length + ' 个结果 · ' + label : '没有匹配的私聊账号') +
          (failed ? ' · 有账号暂时无法搜索' : '');
        for (const row of rows) {
          const button = el('button','person-result');
          const info = el('span','');
          info.append(el('strong','',row.title),el('small','',[row.accountName,row.phone ? '+' + row.phone : ''].filter(Boolean).join(' · ')));
          button.append(avatar(row.title,row.chat,row.accountId),info);
          button.onclick = () => { dialog.close(); run(()=>window.desk.openChat(row.accountId,row.chat)); };
          results.append(button);
        }
      } catch {
        if (ticket === request) node('people-status').textContent = '搜索失败，请重新输入后重试。';
      }
    },200);
  }
  function open() { input.value=''; dialog.showModal(); schedule(); input.focus(); }
  node('find-person').onclick = node('dock-search').onclick = open;
  node('people-close').onclick = () => dialog.close();
  dialog.onclose = () => { request++; clearTimeout(timer); results.replaceChildren(); };
  input.oninput = schedule;
  return {setScope(id,name,connected) {
    const changed = scope !== id || online !== connected;
    scope = id; label = name || '全部已连接账号'; online = connected;
    if (changed && dialog.open) schedule();
  }};
})();
