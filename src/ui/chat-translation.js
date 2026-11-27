const chatTranslation = (() => {
  const entries = new Map(), observed = new Map();
  const observer = new IntersectionObserver(changes => {
    for (const item of changes) {
      const slot = observed.get(item.target);
      if (slot) slot.visible = item.isIntersecting;
    }
    pump();
  },{root:document.getElementById('scroll')});
  let settings, active = 0, generation = 0;
  function resetView() { observer.disconnect(); observed.clear(); }
  // Changed settings invalidate every row, so the rows are rebuilt with fresh translate controls.
  function configure(next) { generation++; entries.clear(); resetView(); resetMessageRows(); settings = next; }
  // Rows that left the list no longer need watching.
  function prune() {
    for (const button of observed.keys()) if (!button.isConnected) { observer.unobserve(button); observed.delete(button); }
  }
  function draw(slot) {
    const result = entries.get(slot.key);
    slot.button.disabled = result?.pending === true;
    slot.button.textContent = result?.pending ? '翻译中…' : result?.error ? '重试翻译' : result?.text ? (result?.hidden ? '显示译文' : '收起译文') : '翻译';
    slot.output.hidden = !result || result.pending || result?.hidden;
    slot.output.textContent = result?.error || result?.text || '';
    slot.output.title = result?.provider || '';
    // In compact mode a shown translation stands in for the original text.
    slot.bubble?.classList.toggle('translated', !slot.output.hidden && Boolean(result?.text));
  }
  async function start(slot) {
    if (entries.get(slot.key)?.pending) return;
    const version = generation;
    active++;
    entries.set(slot.key,{pending:true});
    draw(slot);
    try {
      const result = await window.desk.translate(slot.source,'incoming',slot.ref);
      if (version === generation) entries.set(slot.key,result);
    } catch (e) {
      if (version === generation) entries.set(slot.key,{error:translationError(e)});
    } finally {
      active--;
      for (const current of observed.values()) if (current.key === slot.key) draw(current);
      if (entries.size > 1500) {
        const visibleKeys = new Set([...observed.values()].map(item=>item.key));
        for (const [key,value] of entries) {
          if (!value.pending && !visibleKeys.has(key)) entries.delete(key);
          if (entries.size <= 1200) break;
        }
      }
      pump();
    }
  }
  function pump() {
    if (!settings?.auto) return;
    for (const slot of observed.values()) {
      if (active >= 2) break;
      if (slot.auto && slot.visible && slot.button.isConnected && !entries.has(slot.key)) void start(slot);
    }
  }
  function attach(message,footer,bubble) {
    if (!message.translatable) return;
    const button = el('button','message-translate','翻译'), output = el('div','translation-output');
    button.type = 'button'; output.dir = 'auto';
    const key = JSON.stringify([message.accountId,message.chat,message.id,message.text]);
    const slot = {bubble,button,output,key,source:message.text,ref:{accountId:message.accountId,chat:message.chat,id:message.id},auto:!message.outgoing,visible:false,hidden:false};
    output.onclick = () => { if (document.body.classList.contains('translate-compact')) bubble.classList.toggle('show-original'); };
    observed.set(button,slot);
    draw(slot);
    button.onclick = () => {
      if (settings?.engine==='keyed' && !settings.providers.some(p=>p.configured)) { openTranslationSettings(); return; }
      const result = entries.get(key);
      if (result?.text) { result.hidden = !result.hidden; draw(slot); }
      else void start(slot);
    };
    footer.prepend(button);
    bubble.insertBefore(output,footer);
    if (settings?.auto && slot.auto) observer.observe(button);
  }
  return {attach,configure,resetView,prune,get settings(){return settings;}};
})();
function translationError(error) {
  return readable(error);
}

