const { Conversations } = require('./conversations.cjs');

const text = (value, limit) => typeof value === 'string' ? value.slice(0,limit) : '';
function mediaOf(item) {
  if (!item || typeof item.kind !== 'string') return null;
  return {kind:item.kind.slice(0,20), mime:text(item.mime,120), name:text(item.name,200), size:Number(item.size) || 0, duration:Number(item.duration) || 0,
    caption:item.caption === true, once:item.once === true, thumb:/^data:image\/jpeg;base64,[A-Za-z0-9+/=]{1,40000}$/.test(item.thumb) ? item.thumb : ''};
}
function quoteOf(item) {
  if (!item || typeof item.id !== 'string') return null;
  return {id:item.id.slice(0,120), sender:text(item.sender,160), text:text(item.text,300), kind:text(item.kind,20)};
}
function reactionsOf(items) {
  if (!Array.isArray(items)) return [];
  return items.slice(0,20).filter(r=>r && typeof r.emoji === 'string' && r.emoji && Number.isInteger(r.count) && r.count > 0)
    .map(r=>({emoji:r.emoji.slice(0,16), count:r.count, mine:r.mine === true}));
}
const thumbOf = value => /^data:image\/jpeg;base64,[A-Za-z0-9+/=]{1,40000}$/.test(value) ? value : '';
function linkOf(item) {
  if (!item || typeof item.url !== 'string' || !/^https?:\/\//i.test(item.url)) return null;
  return {url:item.url.slice(0,2000), title:text(item.title,200), description:text(item.description,300), thumb:thumbOf(item.thumb)};
}
const votesOf = items => Array.isArray(items) ? items.slice(0,12).map(n => Number.isInteger(n) && n > 0 ? n : 0) : [];
function pollOf(item) {
  if (!item || !Array.isArray(item.options)) return null;
  return {name:text(item.name,300), options:item.options.slice(0,12).map(o=>text(o,120)), votes:votesOf(item.votes)};
}
// Message text stays in memory. WhatsApp itself owns the on-disk history.
class Inbox {
  conversations = new Conversations();
  byAccount = new Map();
  byChat = new Map();
  early = new Map();
  // Ids of one conversation, so a thread is read without scanning the whole account.
  chatIds(accountId, chat, create = false) {
    let chats = this.byChat.get(accountId);
    if (!chats) { if (!create) return null; this.byChat.set(accountId, chats = new Map()); }
    let ids = chats.get(chat);
    if (!ids && create) chats.set(chat, ids = new Set());
    return ids || null;
  }
  // Long sessions would otherwise grow without bound. The oldest messages go first; WhatsApp still has them
  // and "load earlier messages" brings them back.
  trim(accountId, chat) {
    const bucket = this.byAccount.get(accountId), ids = this.chatIds(accountId,chat);
    const drop = (list, keep) => {
      const latest = new Set([...(this.conversations.latest.get(accountId)?.values() || [])].map(m=>m.id));
      list.sort((a,b)=>a.time-b.time);
      for (const message of list.slice(0,list.length-keep)) if (!latest.has(message.id)) {
        bucket.delete(message.id); this.chatIds(accountId,message.chat)?.delete(message.id);
      }
    };
    if (ids && ids.size > Inbox.chatLimit) drop([...ids].map(id=>bucket.get(id)).filter(Boolean), Math.floor(Inbox.chatLimit*0.8));
    if (bucket.size > Inbox.accountLimit) drop([...bucket.values()], Math.floor(Inbox.accountLimit*0.8));
  }
  // What goes to the window for an open thread. A preview image is sent with the first update that carries its
  // message; later updates only say that it was sent, and the window keeps its copy.
  deliver(messages, seen) {
    return messages.map(message => {
      const media = message.media?.thumb, link = message.link?.thumb;
      if (!media && !link) return message;
      const known = seen.has(message.id);
      seen.add(message.id);
      if (!known) return message;
      return {...message, ...(media ? {media:{...message.media,thumb:'',kept:true}} : {}), ...(link ? {link:{...message.link,thumb:'',kept:true}} : {})};
    });
  }
  receipt(accountId,id,ack) {
    if (!Number.isInteger(ack) || ack > 4) return false;
    const msg = this.find(accountId,id);
    if (msg) {
      if (!msg.outgoing || ack === msg.ack || (ack >= 0 && msg.ack > ack)) return false;
      msg.ack = ack;
      return true;
    }
    if (!this.early.has(accountId)) this.early.set(accountId,new Map());
    const pending = this.early.get(accountId);
    if (pending.size >= 2000) pending.delete(pending.keys().next().value);
    if (!pending.has(id) || ack < 0 || pending.get(id) < ack) pending.set(id,ack);
    return false;
  }
  add(accountId, messages) {
    let bucket = this.byAccount.get(accountId);
    if (!bucket) this.byAccount.set(accountId, bucket = new Map());
    const added = [], touched = new Set();
    for (const item of messages) {
      if (!item || typeof item.id !== 'string' || typeof item.chat !== 'string' ||
          typeof item.text !== 'string' || !Number.isFinite(item.time)) continue;
      const previous = bucket.get(item.id);
      if (previous && !(previous.chat === item.chat && previous.pendingText && !item.pendingText)) {
        if (previous.chat === item.chat && this.receipt(accountId,item.id,item.ack)) added.push({message:previous,notify:false});
        continue;
      }
      const message = { id: item.id, chat: item.chat, time: item.time, title: String(item.title).slice(0, 160),
        senderId:typeof item.senderId === 'string' ? item.senderId : null, sender: String(item.sender || '').slice(0,160), text: item.text.slice(0, 65536), outgoing: Boolean(item.outgoing), pendingText: Boolean(item.pendingText), accountId };
      message.sequence = previous?.sequence ?? bucket.size;
      message.rowId = Number.isSafeInteger(item.rowId) ? item.rowId : previous?.rowId ?? null;
      message.type = typeof item.type === 'string' ? item.type.slice(0,80) : '';
      message.subtype = typeof item.subtype === 'string' ? item.subtype.slice(0,80) : '';
      message.system = !!item.system;
      message.translatable = item.translatable === true;
      message.ack = previous?.ack ?? null;
      message.media = mediaOf(item.media);
      message.quote = quoteOf(item.quote);
      message.edited = item.edited === true;
      message.forwarded = item.forwarded === true;
      message.reactions = previous?.reactions || [];
      message.link = linkOf(item.link);
      message.poll = pollOf(item.poll);
      message.starred = item.starred === true;
      message.mentions = Array.isArray(item.mentions) ? item.mentions.slice(0,30).map(name => text(name,80)).filter(Boolean) : [];
      message.mentionsMe = item.mentionsMe === true;
      message.ephemeral = Number.isFinite(item.ephemeral) && item.ephemeral > 0 ? item.ephemeral : 0;
      bucket.set(message.id, message);
      this.chatIds(accountId,message.chat,true).add(message.id);
      touched.add(message.chat);
      this.receipt(accountId,message.id,item.ack);
      this.receipt(accountId,message.id,this.early.get(accountId)?.get(message.id));
      this.early.get(accountId)?.delete(message.id);
      if (message.pendingText || item.previewable === false || !message.text.trim()) {
        this.conversations.index(accountId,[message]);
      } else this.conversations.observe(message, item.latestInChat, item.live);
      added.push({ message, notify: !previous && item.notify === true && !message.outgoing });
    }
    for (const chat of touched) this.trim(accountId,chat);
    return added;
  }
  // Later events for a known message: revoke, edit, reactions and local deletion.
  patch(accountId, id, change) {
    const message = this.find(accountId,id);
    if (!message || !change || typeof change !== 'object') return false;
    if (change.removed === true) {
      this.byAccount.get(accountId).delete(id);
      this.chatIds(accountId,message.chat)?.delete(id);
      return true;
    }
    if (change.revoked === true) {
      Object.assign(message,{type:'revoked',text:'消息已撤回',media:null,quote:null,link:null,poll:null,starred:false,reactions:[],translatable:false,edited:false});
      return true;
    }
    if (Array.isArray(change.reactions)) message.reactions = reactionsOf(change.reactions);
    if (Array.isArray(change.votes) && message.poll) message.poll.votes = votesOf(change.votes);
    if (typeof change.starred === 'boolean') message.starred = change.starred;
    if (typeof change.text === 'string' && change.text.trim() && message.type !== 'revoked') {
      message.text = change.text.slice(0,65536);
      message.edited = true;
    }
    return true;
  }
  find(accountId, id) { return this.byAccount.get(accountId)?.get(id); }
  clear(accountId) { this.early.delete(accountId); this.byAccount.delete(accountId); this.byChat.delete(accountId); this.conversations.clear(accountId); }
  page(limit, accountId = null, chat = null) {
    const bucket = accountId && this.byAccount.get(accountId);
    const maps = accountId ? [bucket || new Map()] : this.byAccount.values();
    const all = accountId && chat ? [...(this.chatIds(accountId,chat) || [])].map(id=>bucket?.get(id)).filter(Boolean) :
      Array.from(maps).flatMap(map => Array.from(map.values()).filter(m => !chat || m.chat === chat));
    const visible = all.filter(message=>!message.pendingText);
    visible.sort((a, b) => b.time - a.time || a.accountId.localeCompare(b.accountId) || ((b.rowId ?? b.sequence) - (a.rowId ?? a.sequence)));
    return { messages: visible.slice(0, limit), count: visible.length, missingCount:all.length-visible.length };
  }
}
Inbox.chatLimit = 1500;
Inbox.accountLimit = 30000;
module.exports = { Inbox };
