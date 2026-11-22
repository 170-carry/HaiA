// Attachments, quoted replies, message editing and the typing signal for the composer.
const composerExtras = (() => {
  const bar = get('reply-context'), tray = get('attachments'), picker = get('attach-input');
  let quoted = null, editing = null, files = [], typedAt = 0;
  function draw() {
    const subject = editing || quoted;
    bar.hidden = !subject;
    if (subject) {
      get('context-label').textContent = editing ? '编辑消息' : '回复 ' + (subject.outgoing ? '自己' : subject.sender || subject.title);
      get('context-text').textContent = subject.text;
    }
    tray.hidden = !files.length;
    tray.replaceChildren(...files.map(file => {
      const chip = el('span','attachment');
      if (file.type.startsWith('image/')) { const img = new Image(); img.src = file.data; img.alt = ''; chip.append(img); }
      else chip.append(icon('file'));
      const words = el('span','attachment-words');
      words.append(el('strong','',file.name),el('small','',messageMedia.size(file.size)));
      const remove = el('button','icon-button');
      remove.type = 'button'; remove.title = '移除附件'; remove.setAttribute('aria-label','移除附件 '+file.name);
      remove.append(icon('close')); remove.onclick = () => { files = files.filter(f=>f !== file); draw(); refresh(); };
      chip.append(words,remove);
      return chip;
    }));
    get('attach').disabled = !!editing;
  }
  function refresh() { get('reply').dispatchEvent(new Event('input')); }
  function clear() { quoted = editing = null; files = []; typedAt = 0; draw(); }
  function reply(message) { editing = null; quoted = message; draw(); get('reply').focus(); }
  function edit(message) {
    quoted = null; files = []; editing = message; draw();
    get('reply').value = message.text; refresh(); get('reply').focus();
  }
  async function add(list) {
    if (!state?.thread || editing) return;
    for (const file of list) {
      if (files.length >= 10) { warning('一次最多发送 10 个附件'); break; }
      if (file.size > 50*1048576) { warning(file.name+' 超过 50 MB，无法发送'); continue; }
      if (!file.size) continue;
      const data = await new Promise((resolve,reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file);
      }).catch(()=>null);
      if (!data) { warning('无法读取 '+file.name); continue; }
      files.push({name:file.name || '粘贴的图片.png', size:file.size, type:file.type, data});
    }
    draw(); refresh(); get('reply').focus();
  }
  get('attach').onclick = () => picker.click();
  picker.onchange = () => { add([...picker.files]); picker.value = ''; };
  get('context-close').onclick = () => { const wasEditing = editing; quoted = editing = null; draw(); if (wasEditing) { get('reply').value = ''; refresh(); } };
  get('reply').addEventListener('paste',event => {
    const pasted = [...event.clipboardData?.files || []];
    if (pasted.length) { event.preventDefault(); add(pasted); }
  });
  get('reply').addEventListener('keydown',event => { if (event.key === 'Escape' && (editing || quoted)) get('context-close').click(); });
  get('reply').addEventListener('input',() => {
    if (!state?.thread || !get('reply').value || Date.now()-typedAt < 4000) return;
    typedAt = Date.now();
    api.typing(state.active,state.thread.chat,true).catch(()=>{});
  });
  const zone = document.querySelector('.reader');
  zone.addEventListener('dragover',event => {
    if (![...event.dataTransfer?.types || []].includes('Files') || get('composer').hidden) return;
    event.preventDefault(); zone.classList.add('dropping');
  });
  zone.addEventListener('dragleave',event => { if (!zone.contains(event.relatedTarget)) zone.classList.remove('dropping'); });
  zone.addEventListener('drop',event => {
    zone.classList.remove('dropping');
    if (!event.dataTransfer?.files.length || get('composer').hidden) return;
    event.preventDefault(); add([...event.dataTransfer.files]);
  });
  return {reply,edit,clear,current:()=>({quoted,editing,files}),ready:()=>files.length > 0};
})();
