// A conversation belongs to one linked number, even when two accounts share a contact.
class Conversations {
  latest = new Map();
  unread = new Map();
  directory = new Map();
  index(accountId, entries) {
    if (!this.directory.has(accountId)) this.directory.set(accountId,new Map());
    const chats = this.directory.get(accountId);
    for (const row of entries) if (typeof row.chat === 'string' && typeof row.title === 'string') {
      // The directory carries the current name, so a contact renamed elsewhere is picked up here.
      const latest = this.latest.get(accountId)?.get(row.chat);
      if (latest && row.id === undefined && latest.title !== row.title) latest.title = row.title;
      chats.set(row.chat,{accountId,chat:row.chat,title:row.title,phone:row.phone ?? chats.get(row.chat)?.phone ?? '',time:Math.max(chats.get(row.chat)?.time || 0, Number(row.time)||0),id:null,text:'',outgoing:false});
    }
  }
  retitle(accountId, chat, title) {
    for (const store of [this.latest,this.directory]) {
      const entry = store.get(accountId)?.get(chat);
      if (entry) entry.title = title;
    }
  }
  find(accountId, chat) {
    return this.latest.get(accountId)?.get(chat) || this.directory.get(accountId)?.get(chat);
  }
  observe(message, latestInChat, live) {
    let chats = this.latest.get(message.accountId);
    if (!chats) this.latest.set(message.accountId, chats = new Map());
    const previous = chats.get(message.chat);
    const preferText = !message.chat.endsWith('@g.us');
    if (preferText && message.system && previous && !previous.system) return;
    if (!previous || (preferText && previous.system && !message.system) || message.id === previous.id || message.time > previous.time ||
        (message.time === previous.time && (latestInChat || live || (message.rowId != null && previous.rowId != null && message.rowId > previous.rowId)))) chats.set(message.chat, message);
  }
  setUnread(accountId, entries) {
    this.unread.set(accountId, new Map(entries));
  }
  clear(accountId) {
    this.directory.delete(accountId);
    this.latest.delete(accountId);
    this.unread.delete(accountId);
  }
  page(limit, scope, unreadOnly = false, matches = null) {
    const rows = [];
    for (const accountId of new Set([...this.latest.keys(), ...this.directory.keys()])) {
      if (scope && scope !== accountId) continue;
      const chats = new Map(this.directory.get(accountId));
      for (const [id, message] of this.latest.get(accountId) || []) chats.set(id,{...message,phone:chats.get(id)?.phone || '',time:Math.max(message.time,chats.get(id)?.time || 0)});
      for (const message of chats.values()) {
        if (unreadOnly && !(this.unread.get(accountId)?.get(message.chat) > 0)) continue;
        if (!matches || matches(message)) rows.push(message);
      }
    }
    rows.sort((a,b)=>b.time-a.time || a.accountId.localeCompare(b.accountId) || a.chat.localeCompare(b.chat));
    return {count: rows.length, messages: rows.slice(0,limit).map(m=>({
      ...m, unreadCount: this.unread.get(m.accountId)?.get(m.chat) || 0
    }))};
  }
}
module.exports = { Conversations };
