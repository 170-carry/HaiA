// Keep the selected participant's identity separate from the text visible in the composer.
const mentionDrafts = (() => {
  const entries=new Map();
  const ready=composerDisk.load('mentions','mention-drafts',entries);
  const save=key=>composerDisk.write('mentions',key,entries.get(key));
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
    save(key); return entries.get(key);
  }
  function forget(id) { for(const key of entries.keys()) if(key.startsWith('['+JSON.stringify(id)+',')) entries.delete(key); }
  return {ready,forget,sync, add(key,text,start,label,id) {
    const spans = sync(key,text)?.spans || [];
    spans.push({start,label,id}); spans.sort((a,b)=>a.start-b.start);
    entries.set(key,{text,spans}); save(key);
  }, encode(key,text) {
    const spans = sync(key,text)?.spans || [];
    let wire = text;
    for (const span of [...spans].reverse()) wire = wire.slice(0,span.start)+'@'+span.id.split('@')[0]+wire.slice(span.start+span.label.length);
    return {text:wire,ids:[...new Set(spans.map(span=>span.id))]};
  }, clear(key) { if (entries.delete(key)) save(key); }};
})();
