// Keep the selected participant's identity separate from the text visible in the composer.
const mentionDrafts = (() => {
  let entries;
  try { entries = new Map(JSON.parse(localStorage.getItem('mention-drafts') || '[]')); }
  catch { entries = new Map(); }
  function save() {
    try { localStorage.setItem('mention-drafts',JSON.stringify([...entries].slice(-200))); } catch { /* The current draft is still in memory. */ }
  }
  function sync(key,text) {
    const draft = entries.get(key);
    if (!draft || draft.text === text) return draft;
    const old = draft.text;
    let left = 0, right = 0;
    while (left < Math.min(text.length,old.length) && text[left] === old[left]) left++;
    while (right < Math.min(text.length,old.length)-left && text[text.length-1-right] === old[old.length-1-right]) right++;
    const spans = draft.spans.filter(span => {
      if (span.start+span.label.length <= left) return true;
      if (span.start < old.length-right) return false;
      span.start += text.length-old.length; return true;
    });
    if (spans.length) entries.set(key,{text,spans}); else entries.delete(key);
    save(); return entries.get(key);
  }
  return {sync, add(key,text,start,label,id) {
    const spans = sync(key,text)?.spans || [];
    spans.push({start,label,id}); spans.sort((a,b)=>a.start-b.start);
    entries.set(key,{text,spans}); save();
  }, encode(key,text) {
    const spans = sync(key,text)?.spans || [];
    let wire = text;
    for (const span of [...spans].reverse()) wire = wire.slice(0,span.start)+'@'+span.id.split('@')[0]+wire.slice(span.start+span.label.length);
    return {text:wire,ids:[...new Set(spans.map(span=>span.id))]};
  }, clear(key) { if (entries.delete(key)) save(); }};
})();
