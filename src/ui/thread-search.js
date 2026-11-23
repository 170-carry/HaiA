const threadSearch = (() => {
  const input = document.getElementById('message-query'), status = document.getElementById('match-status');
  let route, timer, ticket = 0, index = 0, history = null, partial = false;
  function mark(scroll = false) {
    const query = input.value.trim().toLocaleLowerCase(), loaded = [];
    for (const row of document.querySelectorAll('#bubbles .message[data-id]')) {
      const found = Boolean(query && row.querySelector('.message-text')?.textContent.toLocaleLowerCase().includes(query));
      row.classList.toggle('found',found);
      if (found) loaded.push(row.dataset.id);
    }
    status.hidden = !query;
    if (!query) return;
    const ids = [...new Set([...(history || []),...loaded])];
    if (index >= ids.length) index = 0;
    const summary = ids.length ? (index+1)+' / '+ids.length+' 条匹配消息 · Enter 查看下一条' : '没有匹配的消息';
    status.textContent = summary + (partial ? ' · 历史索引暂不可用' : '');
    if (!scroll || !ids.length) return;
    const id = ids[index];
    const row = [...document.querySelectorAll('#bubbles .message[data-id]')].find(node=>node.dataset.id===id);
    if (row) row.scrollIntoView({block:'center'});
    else { const [account,chat] = JSON.parse(route); threadMarks.jump(id); run(()=>api.openHistoryHit(account,chat,id)); }
  }
  input.oninput = () => {
    const mine = ++ticket, query = input.value.trim();
    clearTimeout(timer); history = null; partial = false; index = 0; mark(true);
    if (!route || query.length < 2) return;
    const [account,chat] = JSON.parse(route);
    timer = setTimeout(async()=>{
      try {
        const result = await api.searchHistory(account,query,chat);
        if (mine !== ticket) return;
        history = result.rows.map(row=>row.id); partial = !!result.unavailable;
        mark(true);
      } catch { if (mine === ticket) { partial = true; mark(); } }
    },250);
  };
  input.onkeydown = event => {
    if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); index++; mark(true); }
  };
  return {mark, setThread(key) {
    if (route !== key) { route = key; ticket++; clearTimeout(timer); input.value = ''; index = 0; history = null; partial = false; }
    document.getElementById('thread-search').hidden = !key;
  }};
})();
