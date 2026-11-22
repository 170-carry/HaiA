// Location, contact cards, polls, stars, labels, group members, status updates and calls.
window.relayMore = (() => {
  const idOf = value => value?._serialized || value?.toString() || '';
  const attempt = async work => { try { return await work(); } catch { return null; } };
  function special(chatId, kind, data) {
    if (kind === 'location') return WPP.chat.sendLocationMessage(chatId,{lat:data.lat,lng:data.lng,name:data.name || undefined,address:data.address || undefined,waitForAck:false});
    if (kind === 'contact') return WPP.chat.sendVCardContactMessage(chatId,{id:data.phone + '@c.us',name:data.name},{waitForAck:false});
    if (kind === 'poll') return WPP.chat.sendCreatePollMessage(chatId,data.name,data.options,{selectableCount:data.multiple ? 0 : 1,waitForAck:false});
    throw new Error('未知的消息类型');
  }
  function link(msg) {
    if (!['chat','text'].includes(msg.type) || typeof msg.matchedText !== 'string' || !/^https?:\/\//i.test(msg.matchedText) || !msg.title) return null;
    const thumb = typeof msg.thumbnail === 'string' && msg.thumbnail.length < 40000 && /^[A-Za-z0-9+/=]+$/.test(msg.thumbnail) ? 'data:image/jpeg;base64,' + msg.thumbnail : '';
    return {url:msg.matchedText.slice(0,2000), title:String(msg.title).slice(0,200), description:String(msg.description || '').slice(0,300), thumb};
  }
  function poll(msg) {
    if (msg.type !== 'poll_creation') return null;
    return {name:String(msg.pollName || ''), options:(Array.isArray(msg.pollOptions) ? msg.pollOptions : []).map(o=>String(o?.name || '')).slice(0,12), votes:[]};
  }
  async function votes(id) {
    const result = await WPP.chat.getVotes(id), counts = [];
    for (const vote of result?.votes || []) for (const option of vote.selectedOptions || []) {
      if (Number.isInteger(option) && option >= 0 && option < 12) counts[option] = (counts[option] || 0) + 1;
    }
    return Array.from(counts,count=>count || 0);
  }
  async function labels(chatId) {
    const all = await attempt(() => WPP.labels.getAllLabels());
    if (!Array.isArray(all)) return null;
    const active = new Set((WPP.chat.get(chatId)?.labels || []).map(String));
    return all.slice(0,40).map(label => ({id:String(label.id), name:String(label.name || ''), color:/^#[0-9a-f]{6}$/i.test(label.hexColor) ? label.hexColor : '#8a8c96', on:active.has(String(label.id))}));
  }
  async function setLabel(chatId, labelId, on, name) {
    const id = labelId || String((await WPP.labels.addNewLabel(name))?.id || '');
    if (!id) throw new Error('标签创建失败');
    await WPP.labels.addOrRemoveLabels(chatId,{labelId:id,type:on ? 'add' : 'remove'});
    return true;
  }
  async function members(groupId, action, ids) {
    if (action === 'add') {
      const result = await WPP.group.addParticipants(groupId,ids);
      return Object.entries(result || {}).filter(([,entry]) => Number(entry?.code) !== 200).map(([key,entry]) => String(entry?.wid || key).split('@')[0]);
    }
    const work = {remove:'removeParticipants',promote:'promoteParticipants',demote:'demoteParticipants'}[action];
    if (!work) throw new Error('未知操作');
    await WPP.group[work](groupId,ids);
    return [];
  }
  function statusRow(model) {
    const chat = idOf(model.id), contact = model.contact;
    return {chat, mine:chat === idOf(WPP.conn.getMyUserId()), title:contact?.name || contact?.pushname || contact?.formattedName || '+' + chat.split('@')[0],
      total:Number(model.totalCount) || model.msgs?.length || 0, unread:Number(model.unreadCount) || 0, time:Number(model.t) * 1000 || 0};
  }
  function statusList() {
    const models = WPP.whatsapp?.StatusV3Store?.getModelsArray?.() || [];
    return models.map(statusRow).filter(row=>row.chat && row.total).sort((a,b)=>Number(b.mine)-Number(a.mine) || b.time-a.time).slice(0,200);
  }
  async function statusItems(chatId) {
    const model = WPP.status.get(chatId);
    const items = model?.msgs?.getModelsArray?.() || model?.msgs?.models || [];
    return items.slice(-60).map(msg => ({id:idOf(msg.id), time:msg.t * 1000, type:String(msg.type || ''), text:String((['chat','text'].includes(msg.type) ? msg.body : msg.caption) || '').slice(0,2000),
      media:window.relayExtras.media(msg), color:Number.isInteger(msg.backgroundColor) ? '#' + (msg.backgroundColor >>> 0).toString(16).padStart(8,'0').slice(2) : ''})).filter(item=>item.id);
  }
  async function statusPost(data) {
    if (data.image) await WPP.status.sendImageStatus(data.image,{caption:data.text || undefined});
    else await WPP.status.sendTextStatus(data.text,{backgroundColor:data.color || '#145347'});
    return true;
  }
  // One call per account. WhatsApp's own VoIP stack in this page carries the audio.
  let call = null, callDirty = false;
  function track(event, state) {
    const id = String(event?.id || '');
    if (!id) return;
    if (state === 'ended') { if (call?.id === id) { call = null; callDirty = true; } return; }
    const peer = idOf(event.peerJid || event.sender || event.from);
    call = {id, peer:peer || call?.peer || '', video:Boolean(event.isVideo ?? call?.video), incoming:event.isOutgoing === undefined ? Boolean(call?.incoming) : !event.isOutgoing,
      state, since:state === 'active' ? Date.now() : call?.since || Date.now(), muted:Boolean(call?.muted && call.id === id)};
    callDirty = true;
  }
  function listen() {
    WPP.on('call.incoming_call', event => track({...event,isOutgoing:false},'ringing'));
    WPP.on('call.outgoing_call', event => track({...event,isOutgoing:true},'calling'));
    WPP.on('call.accepted', event => track(event,'active'));
    WPP.on('call.ended', event => track(event,'ended'));
  }
  const calls = {
    async start(chatId, video) {
      if (call) throw new Error('这个账号正在通话中');
      await attempt(() => WPP.call.enableCallInterface());
      await WPP.call.offer(chatId,{isVideo:video});
      return true;
    },
    async accept(id) { await WPP.call.accept(id); return true; },
    async end(id) {
      const current = call;
      if (current?.id === id && current.incoming && current.state === 'ringing') await WPP.call.reject(id); else await WPP.call.end(id);
      if (call?.id === id) { call = null; callDirty = true; }
      return true;
    },
    async mute(id, muted) { await WPP.call.setMute(muted,id); if (call?.id === id) { call.muted = muted; callDirty = true; } return true; },
    take() { if (!callDirty) return undefined; callDirty = false; return call ? {...call} : null; },
    reset() { if (call) { call = null; callDirty = true; } }
  };
  return {special,link,poll,votes,labels,setLabel,members,statusList,statusItems,statusPost,calls,listen};
})();
