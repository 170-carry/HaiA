const threadSearch = (() => {
  const input = document.getElementById('message-query');
  const status = document.getElementById('match-status');
  let route, index = 0;
  function mark(scroll = false) {
    const query = input.value.trim().toLocaleLowerCase();
    const results = [];
    for (const row of document.querySelectorAll('#bubbles .message')) {
      const found = Boolean(query && row.querySelector('.message-text').textContent.toLocaleLowerCase().includes(query));
      row.classList.toggle('found', found);
      if (found) results.push(row);
    }
    status.hidden = !query;
    if (!query) return;
    if (index >= results.length) index = 0;
    status.textContent = results.length ? (index + 1) + ' / ' + results.length + ' 条匹配消息 · Enter 查看下一条' : '已加载的消息中没有匹配项';
    if (scroll) results[index]?.scrollIntoView({block:'center'});
  }
  input.oninput = () => { index = 0; mark(true); };
  input.onkeydown = event => {
    if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); index++; mark(true); }
  };
  return {mark, setThread(key) {
    if (route !== key) { route = key; input.value = ''; index = 0; }
    document.getElementById('thread-search').hidden = !key;
  }};
})();
