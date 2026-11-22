// Forwarding, voice notes and new groups.
const forwardPicker = (() => {
  const dialog = get('forward-dialog'), input = get('forward-query'), results = get('forward-results');
  let message = null, chats = [];
  function draw() {
    const query = input.value.trim().toLocaleLowerCase();
    const rows = chats.filter(c=>c.title.toLocaleLowerCase().includes(query) || c.chat.includes(query)).slice(0,80);
    get('forward-status').textContent = rows.length ? '选择要转发到的会话' : '没有匹配的会话';
    results.replaceChildren(...rows.map(chat => {
      const button = el('button','person-result');
      button.type = 'button';
      const words = el('span','');
      words.append(el('strong','',chat.title),el('small','',chat.chat.endsWith('@g.us') ? '群聊' : '私聊'));
      button.append(avatar(chat.title,chat.chat,message.accountId),words);
      button.onclick = () => {
        const source = message;
        dialog.close();
        run(async()=>{ await api.forward(source.accountId,source.chat,source.id,chat.chat); warning('已转发给 '+chat.title); });
      };
      return button;
    }));
  }
  input.oninput = draw;
  get('forward-close').onclick = () => dialog.close();
  return {open(target) {
    return run(async()=>{
      chats = await api.conversations(target.accountId);
      message = target; input.value = '';
      dialog.showModal(); draw(); input.focus();
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
      if (await api.micAccess() === false) throw new Error('denied');
      stream = await navigator.mediaDevices.getUserMedia({audio:true});
    } catch {
      finish(); warning('无法使用麦克风，请在系统设置中允许 HaiA 访问麦克风。'); return;
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
const newGroup = (() => {
  const dialog = get('create-group'), form = get('create-group-form'), owner = get('group-owner');
  get('new-group').onclick = () => {
    const online = state.accounts.filter(a=>a.status === 'online');
    if (!online.length) { warning('请先连接一个 WhatsApp 账号'); return; }
    owner.replaceChildren(...online.map(account => {
      const option = el('option','',[account.name,account.linkedPhone].filter(Boolean).join(' · '));
      option.value = account.id; return option;
    }));
    owner.value = online.some(a=>a.id === (state.feedScope || state.active)) ? state.feedScope || state.active : online[0].id;
    get('group-name').value = get('group-members').value = get('create-group-error').textContent = '';
    dialog.showModal(); get('group-name').focus();
  };
  get('create-group-cancel').onclick = () => dialog.close();
  form.onsubmit = async event => {
    event.preventDefault();
    const submit = form.querySelector('.primary');
    const phones = get('group-members').value.split(/[\n,，;；]+/).map(p=>p.trim()).filter(Boolean);
    submit.disabled = true; get('create-group-error').textContent = '';
    try {
      const result = await api.createGroup(owner.value,get('group-name').value,phones);
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
      if (await api.micAccess() === false) throw new Error('denied');
      stream = await navigator.mediaDevices.getUserMedia({audio:true});
    } catch { close(); warning('无法使用麦克风，请在系统设置中允许 HaiA 访问麦克风。'); return; }
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
