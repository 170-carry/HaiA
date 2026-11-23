// Media, quotes and reactions read from the linked WhatsApp Web page.
window.relayExtras = (() => {
  const kinds = ['image','video','ptt','audio','document','sticker'];
  const labels = {image:'图片',video:'视频',ptt:'语音',audio:'音频',document:'文件',sticker:'贴纸',location:'位置',vcard:'联系人',multi_vcard:'联系人',poll_creation:'投票'};
  function media(msg) {
    if (!kinds.includes(msg.type)) return null;
    // WhatsApp keeps a small JPEG preview of pictures and videos in the message body.
    const body = ['image','video'].includes(msg.type) && typeof msg.body === 'string' ? msg.body : '';
    const thumb = body && body.length < 40000 && /^[A-Za-z0-9+/=]+$/.test(body) ? 'data:image/jpeg;base64,'+body : '';
    return {kind:msg.type, mime:String(msg.mimetype || ''), name:String(msg.filename || ''), size:Number(msg.size) || 0,
      duration:Number(msg.duration) || 0, caption:Boolean(msg.caption), thumb, once:Boolean(msg.isViewOnce)};
  }
  function describe(msg) {
    if (msg.type === 'location') {
      const point = Number.isFinite(msg.lat) && Number.isFinite(msg.lng) ? msg.lat.toFixed(5)+', '+msg.lng.toFixed(5) : '';
      return ['位置',typeof msg.loc === 'string' ? msg.loc.trim() : '',point].filter(Boolean).join(' · ');
    }
    if (msg.type === 'vcard' || msg.type === 'multi_vcard') {
      const cards = msg.type === 'vcard' ? [{vcard:msg.body,displayName:msg.vcardFormattedName}] : Array.isArray(msg.vcardList) ? msg.vcardList : [];
      const names = cards.map(card => card.displayName || /^FN[^:]*:(.+)$/m.exec(String(card.vcard || ''))?.[1]?.trim()).filter(Boolean);
      const phones = cards.map(card => /waid=(\d+)/.exec(String(card.vcard || ''))?.[1]).filter(Boolean).map(n=>'+'+n);
      return ['联系人',names.join('、'),phones.join('、')].filter(Boolean).join(' · ');
    }
    if (msg.type === 'poll_creation') {
      const options = Array.isArray(msg.pollOptions) ? msg.pollOptions.map(o=>o?.name).filter(Boolean) : [];
      return '投票：'+(msg.pollName || '')+(options.length ? '\n'+options.map(o=>'· '+o).join('\n') : '');
    }
    return null;
  }
  function quote(msg) {
    const source = msg.quotedMsg, id = msg.quotedStanzaID;
    if (!source || typeof id !== 'string') return null;
    const text = ['chat','text'].includes(source.type) ? source.body : source.caption || source.filename || labels[source.type] || '消息';
    return {id, sender:window.relayGroupMessage.sender({author:msg.quotedParticipant}).name,
      text:String(text || '').slice(0,300), kind:kinds.includes(source.type) ? source.type : ''};
  }
  async function reactions(id) {
    const data = await WPP.chat.getReactions(id);
    return (data?.reactions || []).slice(0,20).map(item => ({emoji:String(item.aggregateEmoji || ''),
      count:item.senders?.length || 0, mine:Boolean(item.hasReactionByMe)})).filter(item=>item.emoji && item.count);
  }
  // Downloads and uploads cross to the desktop app in pieces, so a large file is never one giant string.
  const staged = new Map(), uploads = new Map();
  let serial = 0;
  const base64 = blob => new Promise((resolve,reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).slice(String(reader.result).indexOf(',') + 1));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
  async function open(id) {
    const msg = await WPP.chat.getMessageById(id);
    const blob = await WPP.chat.downloadMedia(id);
    if (!blob) throw new Error('文件下载失败');
    const token = 'd' + (++serial);
    staged.set(token,blob);
    setTimeout(() => staged.delete(token),600000);
    return {token, size:blob.size, mime:String(msg?.mimetype || blob.type || ''), name:String(msg?.filename || '')};
  }
  function piece(token, offset, length) {
    const blob = staged.get(token);
    if (!blob) throw new Error('文件下载已过期，请重试');
    return base64(blob.slice(offset,offset + length));
  }
  function uploadOpen() {
    const token = 'u' + (++serial);
    uploads.set(token,[]);
    setTimeout(() => uploads.delete(token),1800000);
    return token;
  }
  function uploadPiece(token, data) {
    const parts = uploads.get(token);
    if (!parts) throw new Error('上传已过期，请重新发送');
    const text = atob(data), bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
    parts.push(bytes);
    return true;
  }
  function uploadTake(token, name, mime) {
    const parts = uploads.get(token);
    uploads.delete(token);
    if (!parts?.length) throw new Error('上传已过期，请重新发送');
    return new File(parts,name,{type:mime});
  }
  function presence(event) {
    const chat = event?.id?._serialized || event?.id?.toString();
    if (!chat) return null;
    const busy = (event.participants || []).find(p=>['composing','recording'].includes(p.state));
    const state = busy?.state || event.state;
    return [chat,{state:['composing','recording'].includes(state) ? state : event.isOnline ? 'available' : '',
      who:String(busy?.shortName || '').slice(0,80)}];
  }
  return {media,describe,quote,reactions,open,piece,close:token=>staged.delete(token),uploadOpen,uploadPiece,uploadTake,uploadClose:token=>uploads.delete(token),presence};
})();
