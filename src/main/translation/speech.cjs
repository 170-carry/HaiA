// Keyless speech recognition. Each service is tried in order until one returns text.
const speechNames = {hfLarge:'Hugging Face Whisper large-v3', ovh:'OVHcloud Whisper', hfOpen:'Hugging Face OpenAI Whisper'};
const spaces = {hfLarge:['https://hf-audio-whisper-large-v3.hf.space','transcribe'], hfOpen:['https://openai-whisper.hf.space','predict']};
const extensions = {'audio/webm':'webm','audio/ogg':'ogg','audio/mp4':'m4a','audio/mpeg':'mp3','audio/wav':'wav','audio/x-wav':'wav'};

function multipart(fields) {
  const boundary = '----relay' + Math.random().toString(16).slice(2) + Date.now().toString(16);
  const parts = [];
  for (const [name,value] of Object.entries(fields)) {
    const file = value && typeof value === 'object';
    parts.push(Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="' + name + '"' +
      (file ? '; filename="' + value.name + '"\r\nContent-Type: ' + value.type : '') + '\r\n\r\n'), file ? value.data : Buffer.from(String(value)), Buffer.from('\r\n'));
  }
  parts.push(Buffer.from('--' + boundary + '--\r\n'));
  return {body:Buffer.concat(parts), headers:{'Content-Type':'multipart/form-data; boundary=' + boundary}};
}
async function request(fetcher, url, options, timeout) {
  const res = await fetcher(url,{redirect:'error',credentials:'omit',signal:AbortSignal.timeout(timeout),...options});
  if (!res.ok) throw Object.assign(new Error('服务请求失败'),{status:res.status});
  return res;
}
async function space(fetcher, id, file) {
  const [base,endpoint] = spaces[id];
  const uploaded = await (await request(fetcher,base + '/gradio_api/upload',{method:'POST',...multipart({files:file})},30000)).json();
  if (typeof uploaded?.[0] !== 'string') throw new Error('上传失败');
  const call = await (await request(fetcher,base + '/gradio_api/call/' + endpoint,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({data:[{path:uploaded[0],meta:{_type:'gradio.FileData'}},'transcribe']})},30000)).json();
  if (!/^[\w-]{6,80}$/.test(call?.event_id || '')) throw new Error('排队失败');
  const stream = await (await request(fetcher,base + '/gradio_api/call/' + endpoint + '/' + call.event_id,{},90000)).text();
  const done = /event: complete\s*\ndata: (.+)/.exec(stream);
  if (!done) throw Object.assign(new Error('识别失败'),{status:/event: error/.test(stream) ? 503 : undefined});
  return JSON.parse(done[1])[0];
}
async function recognise(fetcher, id, file) {
  if (spaces[id]) return space(fetcher,id,file);
  const result = await (await request(fetcher,'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/audio/transcriptions',
    {method:'POST',...multipart({file,model:'whisper-large-v3',temperature:'0'})},60000)).json();
  return result?.text;
}
function speechService(fetcher) {
  const cooldown = new Map();
  return async function transcribe(source) {
    const match = typeof source === 'string' && source.length < 12000000 && /^data:(audio\/[\w.+-]+)(?:;[\w=.+-]+)*;base64,/.exec(source.slice(0,120));
    if (!match) throw new Error('录音无效或超过 60 秒，请重新录制');
    const data = Buffer.from(source.slice(match[0].length),'base64');
    if (data.length < 800) throw new Error('没有录到声音，请重试');
    const file = {name:'speech.' + (extensions[match[1]] || 'webm'), type:match[1], data};
    const issues = [];
    for (const id of Object.keys(speechNames)) {
      const suspended = cooldown.get(id);
      if (suspended?.until > Date.now()) { issues.push(suspended.reason); continue; }
      try {
        const text = await recognise(fetcher,id,file);
        if (typeof text !== 'string') throw new Error('服务未返回文字');
        return {text:text.trim().slice(0,30000), provider:speechNames[id]};
      } catch (e) {
        const reason = speechNames[id] + (e.status ? '（HTTP ' + e.status + '）' : '（连接或响应异常）');
        issues.push(reason);
        cooldown.set(id,{reason,until:Date.now() + (e.status === 429 ? 120000 : 30000)});
      }
    }
    throw new Error('语音识别暂不可用：' + issues.join('、') + '。请稍后重试。');
  };
}
module.exports = {speechNames, speechService};
