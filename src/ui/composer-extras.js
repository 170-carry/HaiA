// Attachments, quoted replies, message editing and the typing signal for the composer.
const composerExtras = (() => {
  const bar = get('reply-context'), tray = get('attachments'), picker = get('attach-input');
  let quoted = null, editing = null, files = [], typedAt = 0;
  // Reply target and attachments wait here while another conversation is open.
  const parked = new Map();
  let change=0;
  function save(key=route,items=files,reply=quoted) {
    change++;
    if (!key) return;
    const value=reply || items.length ? {quoted:reply,files:items.map(({file,name,size})=>({file,name,size}))} : null;
    return composerDisk.write('extras',key,value);
  }
  const release = list => { for (const item of list) if (item.url) URL.revokeObjectURL(item.url); };
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
      if (file.url) { const img = new Image(); img.src = file.url; img.alt = ''; chip.append(img); }
      else chip.append(icon('file'));
      const words = el('span','attachment-words');
      words.append(el('strong','',file.name),el('small','',messageMedia.size(file.size)));
      const remove = el('button','icon-button');
      remove.type = 'button'; remove.title = '移除附件'; remove.setAttribute('aria-label','移除附件 '+file.name);
      remove.append(icon('close')); remove.onclick = () => { release([file]); files = files.filter(f=>f !== file); save(); draw(); refresh(); };
      chip.append(words,remove);
      return chip;
    }));
    get('attach').disabled = !!editing;
  }
  function refresh() { get('reply').dispatchEvent(new Event('input')); }
  function clear() { release(files); quoted = editing = null; files = []; typedAt = 0; save(); draw(); }
  // Leaving a conversation ends an edit without keeping its text as a draft, and parks the reply target and attachments.
  function leave(key) {
    if (editing) get('reply').value = '';
    if (quoted || files.length) parked.set(key,{quoted,files}); else parked.delete(key);
    if (parked.size > 8) { const [oldest,kept] = parked.entries().next().value; release(kept.files); parked.delete(oldest); }
    quoted = editing = null; files = []; typedAt = 0; draw();
  }
  function enter(key) {
    const kept = parked.get(key);
    parked.delete(key);
    const ticket=++change;
    if(!kept) composerDisk.get('extras',key).then(value=>{
      if (!value || route!==key || ticket!==change) return;
      quoted=value.quoted;
      files=value.files.map(item=>({...item,type:item.file.type,url:item.file.type.startsWith('image/')?URL.createObjectURL(item.file):null}));
      draw();get('send').disabled=!canSend(state?.accounts.find(a=>a.id===state.active));
    }).catch(()=>warning('读取待发送附件失败'));
    quoted = kept?.quoted || null; files = kept?.files || []; editing = null; draw();
  }
  async function sendOne(account, chat, item, meta) {
    if (await api.sendUpload(account,chat,item.file,meta)) return;
    // Pasted pictures have no file on disk, so their bytes are sent directly.
    if (item.size > 20*1048576) throw new Error(item.name+' 超过 20 MB，请先保存为文件再发送');
    const data = await new Promise((resolve,reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('无法读取 '+item.name)); reader.readAsDataURL(item.file);
    });
    await api.sendFile(account,chat,{name:item.name,data,caption:meta.caption,quote:meta.quote,mentions:meta.mentions});
  }
  // Sends the staged files one by one. Files that went out are removed from the list, so a retry after a failure
  // sends only the rest. Returns how many were sent and the error that stopped the batch, if any.
  async function sendAll(account, chat, key, text, reply, mentions) {
    const batch = files;
    let done = 0, error = null;
    try {
      for (const [at,item] of batch.entries()) {
        await sendOne(account,chat,item,{caption:at ? '' : text,mentions:at ? [] : mentions,quote:at ? null : reply?.id || null});
        done++;
        await save(key,batch.slice(done),null);
      }
    } catch (reason) { error = reason; }
    release(batch.slice(0,done));
    const rest = batch.slice(done), keepReply = done ? null : reply;
    if (route === key) { files = rest; if (done) quoted = null; draw(); }
    else if (rest.length || keepReply) parked.set(key,{quoted:keepReply,files:rest});
    else parked.delete(key);
    save(key,rest,keepReply);
    if (error && done) error = new Error('已发送 '+done+' 个，剩余 '+rest.length+' 个未发送：'+translationError(error));
    return {done,error};
  }
  function reply(message) { editing = null; quoted = message; save(); draw(); get('reply').focus(); }
  function edit(message) {
    quoted = null; release(files); files = []; editing = message; save(); draw();
    get('reply').value = message.text; refresh(); get('reply').focus();
  }
  function add(list) {
    if (!state?.thread || editing) return;
    for (const file of list) {
      if (files.length >= 10) { warning('一次最多发送 10 个附件'); break; }
      if (file.size > 200*1048576) { warning(file.name+' 超过 200 MB，无法发送'); continue; }
      if (!file.size) continue;
      files.push({file, name:file.name || '粘贴的图片.png', size:file.size, type:file.type, url:file.type.startsWith('image/') ? URL.createObjectURL(file) : ''});
    }
    save(); draw(); refresh(); get('reply').focus();
  }
  picker.onchange = () => { add([...picker.files]); picker.value = ''; };
  get('context-close').onclick = () => { const wasEditing = editing; quoted = editing = null; save(); draw(); if (wasEditing) { get('reply').value = ''; refresh(); } };
  get('reply').addEventListener('paste',event => {
    const pasted = [...event.clipboardData?.files || []];
    if (pasted.length) { event.preventDefault(); add(pasted); }
  });
  get('reply').addEventListener('keydown',event => { if (event.key === 'Escape' && (editing || quoted)) get('context-close').click(); });
  // Escape also cancels a running voice recording or dictation.
  window.addEventListener('keydown',event => {
    if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return;
    for (const [bar,cancel] of [['recording','recording-cancel'],['dictation','dictation-cancel']]) if (!get(bar).hidden) { event.preventDefault(); get(cancel).click(); }
  });
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
  return {leave,enter,sendAll,pick:()=>picker.click(),reply,edit,clear,current:()=>({quoted,editing,files}),ready:()=>files.length > 0};
})();
