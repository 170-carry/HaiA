// Forwarding, voice notes and new groups.
const forwardPicker = (() => {
  const dialog = get('forward-dialog'), input = get('forward-query'), results = get('forward-results'), owner = get('forward-owner');
  let batch = [], chats = [];
  async function deliver(chat) {
    const account = owner.value, source = batch.slice();
    dialog.close();
    let done = 0;
    for (const message of source) {
      try { await api.forward(message.accountId,message.chat,message.id,chat.chat,account); done++; }
      catch (error) { throw new Error('已转发 '+done+' / '+source.length+' 条，剩余消息未发送。'+readable(error)); }
    }
    warning('已转发 '+done+' 条给 '+chat.title);
  }
  function draw() {
    const query = input.value.trim().toLocaleLowerCase();
    const rows = chats.filter(c=>c.title.toLocaleLowerCase().includes(query) || c.chat.includes(query)).slice(0,80);
    get('forward-status').textContent = (batch.length > 1 ? '转发 '+batch.length+' 条消息 · ' : '') + (rows.length ? '选择要转发到的会话' : '没有匹配的会话') +
      (owner.value !== batch[0]?.accountId ? ' · 跨账号重新发送原文或附件' : '');
    results.replaceChildren(...rows.map(chat => {
      const button = el('button','person-result');
      button.type = 'button';
      const words = el('span','');
      words.append(el('strong','',chat.title),el('small','',chat.chat.endsWith('@g.us') ? '群聊' : '私聊'));
      button.append(avatar(chat.title,chat.chat,owner.value),words);
      button.onclick = () => run(()=>deliver(chat));
      return button;
    }));
  }
  let ticket = 0;
  async function load() {
    const current = ++ticket; chats = []; draw();
    const rows = await api.conversations(owner.value);
    if (current === ticket) { chats = rows; draw(); }
  }
  input.oninput = draw;
  owner.onchange = () => run(load);
  get('forward-close').onclick = () => dialog.close();
  return {open(target) {
    return run(async()=>{
      batch = [].concat(target);
      if (!batch.length) return;
      const online = state.accounts.filter(a=>a.status === 'online');
      owner.replaceChildren(...online.map(account => new Option([account.name,account.linkedPhone].filter(Boolean).join(' · '),account.id)));
      owner.value = batch[0].accountId;
      owner.parentElement.hidden = online.length < 2;
      input.value = '';
      await load();
      dialog.showModal(); input.focus();
    });
  }};
})();
const voiceRecorder = (() => {
  const bar = get('recording'), button = get('record');
  let recorder = null, stream = null, started = 0, ticker = null, target = null, keep = false;
  function stop(send) {
    keep = send;
    if (recorder?.state === 'recording') recorder.stop(); else finish();
  }
  function finish() {
    clearInterval(ticker);
    for (const track of stream?.getTracks() || []) track.stop();
    recorder = stream = null;
    bar.hidden = true; button.disabled = false;
  }
  async function start() {
    if (recorder || !state?.thread) return;
    button.disabled = true;
    try {
      // The main process shows the system prompt, or offers to open system settings when access was refused.
      if (await api.micAccess() === false) { finish(); return; }
      stream = await navigator.mediaDevices.getUserMedia({audio:true});
    } catch {
      finish(); warning('麦克风暂时无法使用，请确认已连接麦克风且没有被其他应用占用。'); return;
    }
    const type = ['audio/ogg;codecs=opus','audio/mp4','audio/webm;codecs=opus'].find(t=>MediaRecorder.isTypeSupported(t));
    const parts = [];
    target = {account:state.active,chat:state.thread.chat,key:route};
    recorder = new MediaRecorder(stream,type ? {mimeType:type} : {});
    recorder.ondataavailable = event => { if (event.data.size) parts.push(event.data); };
    recorder.onstop = () => {
      const blob = new Blob(parts,{type:(recorder.mimeType || type || 'audio/webm').split(';')[0]}), owner = target, send = keep;
      finish();
      if (!send || !blob.size || route !== owner.key) return;
      const reader = new FileReader();
      reader.onload = () => run(()=>api.sendFile(owner.account,owner.chat,{name:'语音消息.'+blob.type.split('/')[1],data:reader.result,voice:true}));
      reader.readAsDataURL(blob);
    };
    recorder.start();
    started = Date.now(); bar.hidden = false;
    const tick = () => {
      const seconds = Math.floor((Date.now()-started)/1000);
      get('recording-time').textContent = Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');
      if (seconds >= 300) stop(true);
    };
    tick(); ticker = setInterval(tick,500);
  }
  button.onclick = start;
  get('recording-cancel').onclick = () => stop(false);
  get('recording-send').onclick = () => stop(true);
  return {cancel() { if (recorder) stop(false); }};
})();
// New group: members are picked from contacts, and numbers that are not saved can be typed in.
const newGroup = (() => {
  const dialog = get('create-group'), form = get('create-group-form'), owner = get('group-owner');
  const search = get('group-search'), results = get('group-candidates'), chips = get('group-chosen');
  const chosen = new Map();
  let ticket = 0, timer = null;
  function drawChosen() {
    get('group-chosen-label').textContent = chosen.size ? '已选 '+chosen.size+' 人' : '还没有选择成员';
    chips.replaceChildren(...[...chosen].map(([key,member]) => {
      const chip = el('button','member-chip',member.title);
      chip.type = 'button'; chip.title = '移除 '+member.title; chip.append(icon('close'));
      chip.onclick = () => { chosen.delete(key); drawChosen(); find(); };
      return chip;
    }));
  }
  function add(key, title) { if (chosen.size >= 50) { get('create-group-error').textContent = '最多选择 50 位成员'; return; } chosen.set(key,{title}); drawChosen(); }
  async function find() {
    const mine = ++ticket, term = search.value.trim();
    const digits = term.replace(/[\s()+-]/g,'');
    try {
      const rows = await api.contacts(owner.value,term);
      if (mine !== ticket) return;
      const items = rows.filter(row=>!chosen.has(row.chat)).slice(0,40).map(row => {
        const button = el('button','person-result'); button.type = 'button';
        const words = el('span','');
        words.append(el('strong','',row.title),el('small','',row.phone ? '+'+row.phone : ''));
        button.append(avatar(row.title,row.chat,owner.value),words);
        button.onclick = () => { add(row.chat,row.title); search.value = ''; find(); search.focus(); };
        return button;
      });
      // A typed number that is not among the contacts can be added as it is.
      if (/^[1-9]\d{6,14}$/.test(digits) && !chosen.has(digits) && !rows.some(row=>row.phone === digits)) {
        const button = el('button','person-result add-number','添加号码 +'+digits); button.type = 'button';
        button.onclick = () => { add(digits,'+'+digits); search.value = ''; find(); search.focus(); };
        items.unshift(button);
      }
      results.replaceChildren(...items);
      get('group-candidates-note').textContent = items.length ? (term ? '' : '最近联系人') : term ? '没有匹配的联系人。输入含国家区号的完整手机号可直接添加。' : '输入姓名或手机号查找联系人';
    } catch (error) { if (mine === ticket) get('group-candidates-note').textContent = translationError(error); }
  }
  search.oninput = () => { clearTimeout(timer); timer = setTimeout(find,200); };
  search.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); results.querySelector('button')?.click(); } };
  owner.onchange = () => { chosen.clear(); drawChosen(); find(); };
  get('new-group').onclick = () => {
    const online = state.accounts.filter(a=>a.status === 'online');
    if (!online.length) { warning('请先连接一个 WhatsApp 账号'); return; }
    owner.replaceChildren(...online.map(account => new Option([account.name,account.linkedPhone].filter(Boolean).join(' · '),account.id)));
    owner.value = online.some(a=>a.id === (state.feedScope || state.active)) ? state.feedScope || state.active : online[0].id;
    owner.parentElement.hidden = online.length < 2;
    get('group-name').value = search.value = get('create-group-error').textContent = '';
    chosen.clear(); drawChosen();
    dialog.showModal(); get('group-name').focus(); find();
  };
  get('create-group-cancel').onclick = () => dialog.close();
  form.onsubmit = async event => {
    event.preventDefault();
    const submit = form.querySelector('.primary');
    if (!get('group-name').value.trim()) { get('create-group-error').textContent = '请填写群名称'; get('group-name').focus(); return; }
    if (!chosen.size) { get('create-group-error').textContent = '请至少选择一位成员'; search.focus(); return; }
    submit.disabled = true; get('create-group-error').textContent = '';
    try {
      const result = await api.createGroup(owner.value,get('group-name').value,[...chosen.keys()]);
      dialog.close();
      warning(result.failed.length ? '群聊已创建，但未能添加：' + result.failed.map(p=>'+'+p).join('、') : '群聊已创建');
    } catch (error) { get('create-group-error').textContent = translationError(error); }
    finally { submit.disabled = false; }
  };
})();
// Dictation: speech is recognised, translated to the chosen language and placed in the draft.
const voiceInput = (() => {
  const bar = get('dictation'), button = get('dictate'), status = get('dictation-status'), dialog = get('voice-settings');
  let recorder = null, stream = null, ticker = null, ticket = 0, keep = false;
  function label() {
    const voice = chatTranslation.settings?.voice || 'en';
    get('dictation-target').textContent = voice === 'none' ? '不翻译' : '译成' + (chatTranslation.settings?.languages.find(l=>l.id === voice)?.name || voice);
  }
  function close() {
    clearInterval(ticker);
    for (const track of stream?.getTracks() || []) track.stop();
    recorder = stream = null; bar.hidden = true; bar.classList.remove('busy'); button.disabled = false;
  }
  function stop(send) { keep = send; if (recorder?.state === 'recording') recorder.stop(); else { ticket++; close(); } }
  async function understand(blob, mine, key) {
    clearInterval(ticker); bar.classList.add('busy'); status.textContent = '正在识别并翻译…';
    try {
      const audio = await new Promise((resolve,reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob);
      });
      const result = await api.dictate(audio);
      if (mine !== ticket || key !== route) return;
      const field = get('reply'), lead = field.value && !/\s$/.test(field.value.slice(0,field.selectionStart)) ? ' ' : '';
      field.setRangeText(lead + result.translated,field.selectionStart,field.selectionEnd,'end');
      field.dispatchEvent(new Event('input')); field.focus();
      warning(result.issue ? '已填入原话，翻译失败：' + result.issue : result.translated === result.text ? '已识别：' + result.text : '原话：' + result.text);
    } catch (error) { if (mine === ticket) warning(translationError(error)); }
    finally { if (mine === ticket) close(); }
  }
  async function start() {
    if (recorder || !state?.thread) return;
    voiceRecorder.cancel();
    button.disabled = true;
    try {
      if (await api.micAccess() === false) { close(); return; }
      stream = await navigator.mediaDevices.getUserMedia({audio:true});
    } catch { close(); warning('麦克风暂时无法使用，请确认已连接麦克风且没有被其他应用占用。'); return; }
    const type = ['audio/webm;codecs=opus','audio/mp4'].find(t=>MediaRecorder.isTypeSupported(t)), parts = [];
    const mine = ++ticket, key = route, started = Date.now();
    recorder = new MediaRecorder(stream,type ? {mimeType:type,audioBitsPerSecond:32000} : {});
    recorder.ondataavailable = event => { if (event.data.size) parts.push(event.data); };
    recorder.onstop = () => {
      const blob = new Blob(parts,{type:(recorder.mimeType || type || 'audio/webm').split(';')[0]});
      for (const track of stream?.getTracks() || []) track.stop();
      if (keep && mine === ticket && blob.size) void understand(blob,mine,key); else if (mine === ticket) close();
    };
    recorder.start();
    label(); bar.hidden = false;
    const tick = () => {
      const seconds = Math.floor((Date.now()-started)/1000);
      status.textContent = '正在聆听… 0:' + String(seconds).padStart(2,'0');
      if (seconds >= 55) stop(true);
    };
    tick(); ticker = setInterval(tick,500);
  }
  button.onclick = start;
  get('dictation-cancel').onclick = () => stop(false);
  get('dictation-done').onclick = () => stop(true);
  get('dictation-language').onclick = () => {
    const settings = chatTranslation.settings;
    if (!settings) return;
    get('voice-language').replaceChildren(new Option('不翻译，保留原话','none'),...settings.languages.map(item=>new Option(item.name,item.id)));
    get('voice-language').value = settings.voice || 'en'; get('voice-error').textContent = '';
    dialog.showModal();
  };
  button.oncontextmenu = event => { event.preventDefault(); get('dictation-language').click(); };
  get('voice-cancel').onclick = () => dialog.close();
  get('voice-form').onsubmit = async event => {
    event.preventDefault();
    try { chatTranslation.configure(await api.saveVoiceLanguage(get('voice-language').value)); label(); dialog.close(); if (state) render(state); }
    catch (error) { get('voice-error').textContent = translationError(error); }
  };
  return {cancel() { if (recorder || !bar.hidden) stop(false); }};
})();
