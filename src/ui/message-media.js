// Pictures, voice notes, videos and files inside message bubbles.
const messageMedia = (() => {
  const files = new Map(), nodes = new Map(), waiting = new Map(), queue = [];
  let used = new Set(), busy = 0;
  const labels = {image:'图片',sticker:'贴纸',video:'视频',ptt:'语音消息',audio:'音频',document:'文件'};
  const observer = new IntersectionObserver(changes => {
    for (const item of changes) if (item.isIntersecting) { observer.unobserve(item.target); waiting.get(item.target)?.(); }
  },{root:document.getElementById('scroll'),rootMargin:'300px'});
  function size(bytes) {
    return bytes >= 1048576 ? (bytes/1048576).toFixed(1)+' MB' : bytes >= 1024 ? Math.round(bytes/1024)+' KB' : bytes ? bytes+' B' : '';
  }
  function clock(seconds) {
    return seconds ? Math.floor(seconds/60)+':'+String(Math.round(seconds%60)).padStart(2,'0') : '';
  }
  function pump() {
    while (busy < 2 && queue.length) {
      const job = queue.shift();
      busy++;
      window.desk.media(...job.args).then(job.resolve,job.reject).finally(()=>{ busy--; pump(); });
    }
  }
  function load(message) {
    const key = message.accountId+'\n'+message.id;
    if (!files.has(key)) {
      const task = new Promise((resolve,reject)=>queue.push({args:[message.accountId,message.chat,message.id],resolve,reject}));
      task.catch(()=>files.delete(key));
      files.set(key,task);
      if (files.size > 40) files.delete(files.keys().next().value);
      pump();
    }
    return files.get(key);
  }
  function save(message) {
    return run(async()=>{ if (await window.desk.saveMedia(message.accountId,message.chat,message.id)) warning('文件已保存'); });
  }
  function picture(message,box) {
    const button = el('button','media-picture'+(message.media.kind === 'sticker' ? ' sticker' : '')), img = new Image();
    button.type = 'button'; button.title = '查看'+labels[message.media.kind];
    img.alt = labels[message.media.kind];
    if (message.media.thumb) { img.src = message.media.thumb; img.className = 'preview'; }
    button.append(img);
    let full;
    waiting.set(button,()=>load(message).then(src=>{ full = src; img.src = src; img.className = ''; },()=>{
      if (!message.media.thumb) button.replaceChildren(el('span','media-note','图片加载失败，点击重试'));
    }));
    observer.observe(button);
    button.onclick = () => {
      if (!full) { waiting.get(button)(); return; }
      get('viewer-image').src = full;
      get('viewer-save').onclick = () => save(message);
      get('media-viewer').showModal();
    };
    box.append(button);
  }
  function player(message,box) {
    const media = message.media, video = media.kind === 'video';
    const button = el('button','media-play'+(video ? ' video' : ''));
    button.type = 'button';
    if (video && media.thumb) { const img = new Image(); img.src = media.thumb; img.alt = ''; button.append(img); }
    const label = el('span','media-label',[labels[media.kind],clock(media.duration)].filter(Boolean).join(' · '));
    button.append(el('i','media-icon'),label);
    button.querySelector('i').append(icon('play'));
    button.onclick = async () => {
      button.disabled = true; label.textContent = '正在加载…';
      try {
        const node = document.createElement(video ? 'video' : 'audio');
        node.controls = true; node.autoplay = true; node.src = await load(message);
        box.replaceChildren(node);
      } catch (error) {
        button.disabled = false; label.textContent = '加载失败，点击重试';
        warning(translationError(error));
      }
    };
    box.append(button);
  }
  function view(message) {
    const key = message.accountId+'\n'+message.id;
    used.add(key);
    if (nodes.has(key)) return nodes.get(key);
    const media = message.media, box = el('div','media');
    if (media.once) box.append(el('span','media-note','一次性消息，请在手机上查看'));
    else if (['image','sticker'].includes(media.kind)) picture(message,box);
    else if (['video','ptt','audio'].includes(media.kind)) player(message,box);
    else {
      const button = el('button','media-file');
      button.type = 'button'; button.title = '保存到电脑';
      const words = el('span','media-file-words');
      words.append(el('strong','',media.name || '文件'),el('small','',[size(media.size),'点击保存'].filter(Boolean).join(' · ')));
      button.append(icon('file'),words,icon('download'));
      button.onclick = () => save(message);
      box.append(button);
    }
    nodes.set(key,box);
    return box;
  }
  // Nodes are reused across renders so that playback survives incoming updates.
  function begin() {
    for (const key of nodes.keys()) if (!used.has(key)) nodes.delete(key);
    used = new Set();
  }
  get('viewer-close').onclick = () => get('media-viewer').close();
  get('media-viewer').onclick = event => { if (event.target === get('media-viewer')) get('media-viewer').close(); };
  return {view,begin,save,size};
})();
