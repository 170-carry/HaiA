const { Notification, shell, systemPreferences } = require('electron');
const { Inbox } = require('./inbox.cjs');
const { WebAccount } = require('./web-account.cjs');
const media = require('./media.cjs');

const {phoneSearchDigits, contactPhoneDigits, matchesContactQuery} = require('../shared/phone-number.js');

class Workspace {
  constructor(win, accounts) {
    this.win = win;
    this.accounts = accounts;
    this.sessions = new Map();
    this.inbox = new Inbox();
    this.notices = new Map();
    this.people = new Map();
    this.active = null;
    this.feedScope = null;
    this.feedQuery = '';
    this.feedLimit = 100;
    this.filter = 'all';
    this.limit = 100;
    this.thread = null;
    this.epoch = 0;
    for (const account of accounts.items) this.attach(account);

  }
  attach(account) {
    const session = new WebAccount(account, (s, batch) => this.receive(s, batch));
    this.sessions.set(account.id, session);
  }
  snapshot() {
    const query = this.feedQuery;
    const digits = phoneSearchDigits(query);
    const owners = new Map(this.accounts.items.map(a => [a.id,a.name]));
    const matches = query ? m => matchesContactQuery(query,digits,m.phone || contactPhoneDigits(m.chat),[m.title,m.text,owners.get(m.accountId)]) : null;
    const feed = this.inbox.conversations.page(this.feedLimit, this.feedScope, this.filter === 'unread', matches, this.filter === 'archived');
    const feedMore = this.feedSources().some(s => s.more);
    return { link: this.sessions.get(this.active)?.link || null, feedScope: this.feedScope, feed: this.thread ? feed : null, feedMore, feedFilter:this.filter, archivedCount:this.inbox.conversations.archivedCount(this.feedScope), calls:this.calls(), active: this.active, thread: this.thread && {...this.thread, presence:this.sessions.get(this.active)?.presence?.get(this.thread.chat) || null}, qr: this.sessions.get(this.active)?.qr || '', accounts: this.accounts.items.map(a => {
      const s = this.sessions.get(a.id);
      const phone = s?.status === 'online' && /^(\d+)(?::\d+)?@(c\.us|s\.whatsapp\.net)$/.exec(s.identity || '');
      return { ...a, photoIdentity:s?.status === 'online' ? s.identity : null, linkedPhone:phone ? '+' + phone[1] : '', status: s?.status || 'loading', unread: s?.unread || 0, historyError: !!s?.historyError };
    }), ...(this.thread ? this.inbox.page(this.limit, this.active, this.thread.chat) : feed), more: this.thread ? this.thread.more : this.sources().some(s => s.more) };
  }
  publish() {
    if (this.queued || this.win.isDestroyed()) return;
    this.queued = setTimeout(() => {
      this.queued = null;
      if (!this.win.isDestroyed()) this.win.webContents.send('desk:update', this.snapshot());
    }, 75);
  }
  receive(s, batch) {
    if (s.disposed) return;
    const id = s.account.id;
    const link = batch.status === 'pair' ? batch.link || null : null;
    const linkChanged = s.link?.code !== link?.code || s.link?.state !== link?.state;
    const changed = linkChanged || !!batch.chatUnread || s.unread !== (batch.unread || 0) || s.qr !== (batch.qr || '') || s.status !== batch.status || s.more !== !!batch.more || s.historyError !== !!batch.historyError;
    if ((batch.status === 'pair' && s.status !== 'pair') || (batch.identity && s.identity && s.identity !== batch.identity)) {
      this.inbox.clear(id);
      this.people.delete(id);
      if (this.active === id && this.thread) this.select(this.feedScope);
      this.clearNotices(id);
    }
    if (batch.directory?.length) this.inbox.conversations.index(id,batch.directory);
    s.link = link;
    if (batch.chatUnread) this.inbox.conversations.setUnread(id, batch.chatUnread);
    s.identity = batch.identity || s.identity;
    let receiptLate = false;
    s.qr = batch.qr || '';
    s.status = batch.status;
    s.unread = batch.unread || 0;
    s.more = !!batch.more;
    s.historyError = !!batch.historyError;
    if (this.trackLink(s, batch)) receiptLate = true;
    if (batch.status !== 'online' && s.activeCall) { s.activeCall = null; receiptLate = true; }
    if (batch.call !== undefined && batch.status === 'online') {
      const fresh = batch.call && (!s.activeCall || s.activeCall.id !== batch.call.id);
      s.activeCall = batch.call && typeof batch.call.id === 'string' ? {id:batch.call.id.slice(0,120), peer:String(batch.call.peer || '').slice(0,120), video:batch.call.video === true,
        incoming:batch.call.incoming === true, state:['ringing','calling','active'].includes(batch.call.state) ? batch.call.state : 'calling',
        since:Number(batch.call.since) || Date.now(), muted:batch.call.muted === true} : null;
      if (fresh && s.activeCall?.incoming && Notification.isSupported()) {
        new Notification({title:s.account.name + ' · ' + (s.activeCall.video ? '视频来电' : '语音来电'), body:this.callTitle(id,s.activeCall.peer)}).show();
      }
      receiptLate = true;
    }
    const added = this.inbox.add(id, batch.messages);
    for (const { message, notify } of added) {
      if (notify && Notification.isSupported()) this.notify(message, s.account.name);
    }
    let receiptChanged = false;
    for (const [key, ack] of batch.acknowledgements || []) if (this.inbox.receipt(id,key,ack)) receiptChanged = true;
    for (const change of batch.changes || []) {
      if (Array.isArray(change) && this.inbox.patch(id,change[0],change[1])) receiptChanged = true;
    }
    if (batch.status !== 'online') s.presence = new Map();
    for (const entry of batch.presence || []) {
      if (!Array.isArray(entry) || typeof entry[0] !== 'string') continue;
      if (!s.presence) s.presence = new Map();
      s.presence.set(entry[0],{state:String(entry[1]?.state || '').slice(0,20), who:String(entry[1]?.who || '').slice(0,80)});
      if (id === this.active && entry[0] === this.thread?.chat) receiptChanged = true;
    }
    if (receiptLate || receiptChanged || changed || added.length || batch.directory?.length) this.publish();
  }
  // A number that was linked and now asks to pair again was logged out from outside this app.
  trackLink(s, batch) {
    const account = s.account;
    if (batch.status === 'online') {
      const phone = /^(\d+)(?::\d+)?@(c\.us|s\.whatsapp\.net)$/.exec(s.identity || '')?.[1] || account.phone || '';
      if (account.linked && !account.dropped && account.phone === phone) return false;
      this.accounts.update(account.id,{linked:true, phone, dropped:undefined});
      return true;
    }
    if (batch.status !== 'pair' || !account.linked) return false;
    const reason = String(batch.logout || '').slice(0,60);
    if (account.dropped) {
      if (!reason || account.dropped.reason === reason) return false;
      this.accounts.update(account.id,{dropped:{...account.dropped,reason}});
      return true;
    }
    this.accounts.update(account.id,{dropped:{at:Date.now(),reason}});
    const text = account.name + (account.phone ? '（+' + account.phone + '）' : '') + '已退出登录，可能被 WhatsApp 限制或在手机上移除了此设备。';
    if (!this.win.isDestroyed()) this.win.webContents.send('desk:warning', text);
    if (Notification.isSupported()) new Notification({title:'WhatsApp 账号异常退出', body:text}).show();
    return true;
  }
  notify(message, name) {
    const n = new Notification({ title: name + ' · ' + message.title, body: message.text });
    this.notices.set(n, message.accountId);
    n.on('click', () => {
      this.notices.delete(n);
      if (!this.sessions.has(message.accountId)) return;
      if (this.win.isMinimized()) this.win.restore();
      this.win.show();
      this.win.focus();
      this.select(message.accountId);
      void this.openMessage(message.accountId, message.id).catch(() => this.warnChat());
    });
    n.on('close', () => this.notices.delete(n));
    n.on('failed', () => {
      this.notices.delete(n);
      this.win.webContents.send('desk:warning', '系统未能显示通知，请检查系统通知设置。');
    });
    n.show();
  }
  clearNotices(id) {
    for (const [notice, owner] of this.notices) if (owner === id) {
      notice.close();
      this.notices.delete(notice);
    }
  }
  warnChat() {
    this.win.webContents.send('desk:warning', '暂时无法读取对话，请重试。');
  }
  select(id) {
    if (id !== null && !this.sessions.has(id)) throw new Error('账号不存在');
    this.epoch++;
    this.thread = null;
    this.limit = 100;
    this.active = id;
    if (this.feedScope !== id) this.feedQuery = '';
    this.feedScope = id;
    this.feedLimit = 100;
    this.publish();
  }
  sources() {
    return this.active ? [this.sessions.get(this.active)].filter(Boolean) : [...this.sessions.values()];
  }
  async openMessage(accountId, id) {
    const msg = this.inbox.find(accountId, id);
    if (!msg) return;
    return this.openChat(accountId,msg.chat);
  }
  async searchPeople(term) {
    if (typeof term !== 'string' || !term.trim() || term.length > 100) return {rows:[],failed:0};
    const results = await Promise.allSettled(this.feedSources().filter(s => s.status === 'online').map(async s => {
      const identity = s.identity;
      const rows = await s.call('searchPeople',term);
      if (s.disposed || identity !== s.identity || s.status !== 'online') return [];
      if (!this.people.has(s.account.id)) this.people.set(s.account.id,new Map());
      for (const row of rows) this.people.get(s.account.id).set(row.chat,row);
      return rows.map(row=>({...row,accountId:s.account.id,accountName:s.account.name}));
    }));
    return {rows:results.filter(r=>r.status==='fulfilled').flatMap(r=>r.value), failed:results.filter(r=>r.status==='rejected').length};
  }
  async openChat(accountId, chat) {
    const indexed = this.inbox.conversations.find(accountId,chat);
    const msg = indexed || this.people.get(accountId)?.get(chat);
    if (!msg || !this.sessions.has(accountId)) throw new Error('会话不存在，请重新搜索。');
    if (this.feedScope !== null && this.feedScope !== accountId) this.select(accountId);
    this.epoch++;
    this.active = accountId;
    this.limit = 100;
    this.thread = { messageId: msg.id, chat: msg.chat, title: msg.title, more: true, before: null };
    this.thread.more = Boolean(indexed || msg.existing);
    this.publish();
    if (!this.thread.more) return;
    const epoch = this.epoch;
    await this.readThread();
    if (this.epoch !== epoch) return;
    await this.sessions.get(accountId).call('markRead', msg.chat);
    void this.sessions.get(accountId).call('watch', msg.chat).catch(() => {});
  }
  async readThread() {
    const epoch = this.epoch;
    const thread = this.thread;
    if (!thread || thread.loading) return;
    thread.loading = true;
    this.publish();
    try {
      const result = await this.sessions.get(this.active).call('thread', thread.chat, thread.before);
      if (this.epoch !== epoch) return;
      this.inbox.add(this.active, result.rows);
      const oldest = result.rows.reduce((best, row) => !best || row.time < best.time ? row : best, null);
      thread.more = !!oldest && oldest.id !== thread.before && result.more;
      thread.before = oldest?.id;
      this.limit += 40;
    } finally { thread.loading = false; this.publish(); }
  }
  // Message actions always target the conversation that is open in the window.
  current(accountId, chat, id) {
    const session = this.sessions.get(accountId);
    if (accountId !== this.active || chat !== this.thread?.chat || !session) throw new Error('请确认账号和对话');
    if (id === undefined) return {session};
    const message = this.inbox.find(accountId,id);
    if (!message || message.chat !== chat || message.system) throw new Error('消息不存在');
    return {session,message};
  }
  async deliver(session, accountId, work) {
    const identity = session.identity;
    const message = await work();
    if (!session.disposed && session.identity === identity && session.status === 'online') {
      this.inbox.add(accountId, [message]);
      this.publish();
    }
  }
  async send(accountId, chat, text, quote = null) {
    if (typeof text !== 'string' || !text.trim() || text.length > 65536) throw new Error('请确认账号、对话和消息内容');
    const {session} = this.current(accountId,chat);
    const quoted = quote ? this.current(accountId,chat,quote).message.id : null;
    await this.deliver(session,accountId,() => session.call('send', chat, text, quoted));
  }
  async sendFile(accountId, chat, file) {
    const {session} = this.current(accountId,chat);
    if (!file || typeof file.data !== 'string' || !/^data:[\w.+-]+\/[\w.+-]+(;[\w=.+-]+)*;base64,/.test(file.data.slice(0,200)) ||
        file.data.length > 70000000) throw new Error('无法发送此文件，单个文件不能超过 50 MB');
    const item = {voice:file.voice === true, data:file.data, name:String(file.name || '文件').replace(/[\\/\x00-\x1f]/g,'_').slice(0,200),
      caption:typeof file.caption === 'string' ? file.caption.slice(0,65536) : '',
      quote:file.quote ? this.current(accountId,chat,file.quote).message.id : null};
    await this.deliver(session,accountId,() => session.call('sendFile', chat, item));
  }
  media(accountId, chat, id) {
    const {session,message} = this.current(accountId,chat,id);
    return media.view(session,message);
  }
  saveMedia(accountId, chat, id) {
    const {session,message} = this.current(accountId,chat,id);
    return media.save(this.win,session,message);
  }
  async react(accountId, chat, id, emoji) {
    const {session,message} = this.current(accountId,chat,id);
    if (typeof emoji !== 'string' || emoji.length > 16) throw new Error('无效的表情');
    await session.call('react', message.id, emoji);
  }
  async removeMessage(accountId, chat, id, everyone) {
    const {session,message} = this.current(accountId,chat,id);
    if (everyone && !message.outgoing) throw new Error('只能撤回自己发送的消息');
    await session.call('remove', chat, message.id, everyone === true);
  }
  async edit(accountId, chat, id, text) {
    const {session,message} = this.current(accountId,chat,id);
    if (!message.outgoing || message.media || typeof text !== 'string' || !text.trim() || text.length > 65536) throw new Error('这条消息无法编辑');
    await session.call('edit', message.id, text);
  }
  callTitle(accountId, peer) {
    return this.inbox.conversations.find(accountId,peer)?.title || (/^\d+@/.test(peer) ? '+' + peer.split('@')[0] : '未知号码');
  }
  calls() {
    return [...this.sessions.values()].filter(s => s.activeCall).map(s => ({...s.activeCall, accountId:s.account.id, accountName:s.account.name, title:this.callTitle(s.account.id,s.activeCall.peer)}));
  }
  online(accountId) {
    const session = this.sessions.get(accountId);
    if (!session || session.status !== 'online') throw new Error('账号尚未连接');
    return session;
  }
  async microphone(video) {
    if (process.platform !== 'darwin') return;
    const allowed = await systemPreferences.askForMediaAccess('microphone') && (!video || await systemPreferences.askForMediaAccess('camera'));
    if (!allowed) throw new Error('请在系统设置中允许 HaiA 使用麦克风' + (video ? '和摄像头' : ''));
  }
  async callStart(accountId, chat, video) {
    const {session} = this.current(accountId,chat);
    if (chat.endsWith('@g.us')) throw new Error('暂不支持群通话');
    await this.microphone(video === true);
    await session.call('callStart', chat, video === true);
    if (video === true) session.reveal();
  }
  async callAction(accountId, action, value) {
    const session = this.online(accountId), call = session.activeCall;
    if (!call) throw new Error('通话已结束');
    if (action === 'accept') { await this.microphone(call.video); await session.call('callAccept', call.id); if (call.video) session.reveal(); }
    else if (action === 'end') await session.call('callEnd', call.id);
    else if (action === 'mute') await session.call('callMute', call.id, value === true);
    else if (action === 'window') session.reveal();
    else throw new Error('未知操作');
  }
  async sendSpecial(accountId, chat, kind, data) {
    const {session} = this.current(accountId,chat);
    const line = (value, limit) => String(value ?? '').trim().slice(0,limit);
    let payload;
    if (kind === 'location') {
      const lat = Number(data?.lat), lng = Number(data?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || data?.lat === '' || data?.lng === '') throw new Error('请填写有效的纬度（-90 到 90）和经度（-180 到 180）');
      payload = {lat, lng, name:line(data.name,100), address:line(data.address,200)};
    } else if (kind === 'contact') {
      const phone = String(data?.phone ?? '').replace(/[\s()+-]/g,''), name = line(data?.name,80);
      if (!/^[1-9]\d{6,14}$/.test(phone) || !name) throw new Error('请填写联系人姓名和含国家区号的手机号');
      payload = {phone, name};
    } else if (kind === 'poll') {
      const options = [...new Set((Array.isArray(data?.options) ? data.options : []).map(o=>line(o,100)).filter(Boolean))], name = line(data?.name,255);
      if (!name || options.length < 2 || options.length > 12) throw new Error('请填写投票问题和 2 到 12 个不同的选项');
      payload = {name, options, multiple:data.multiple === true};
    } else throw new Error('未知的消息类型');
    await this.deliver(session,accountId,() => session.call('sendSpecial', chat, kind, payload));
  }
  async star(accountId, chat, id, on) {
    const {session,message} = this.current(accountId,chat,id);
    await session.call('star', message.id, on === true);
  }
  chatLabels(accountId, chat) {
    return this.current(accountId,chat).session.call('chatLabels', chat);
  }
  async setLabel(accountId, chat, labelId, on, name) {
    const {session} = this.current(accountId,chat);
    const id = typeof labelId === 'string' ? labelId.slice(0,40) : '', title = String(name ?? '').trim().slice(0,100);
    if (!id && !title) throw new Error('请填写标签名称');
    await session.call('setLabel', chat, id, on === true, title);
  }
  statusList(accountId) { return this.online(accountId).call('statusList'); }
  statusItems(accountId, chat) {
    if (typeof chat !== 'string' || chat.length > 120) throw new Error('无效的联系人');
    return this.online(accountId).call('statusItems', chat);
  }
  async statusPost(accountId, data) {
    const text = String(data?.text ?? '').trim().slice(0,700);
    const image = typeof data?.image === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(data.image.slice(0,40)) && data.image.length < 22000000 ? data.image : null;
    if (!text && !image) throw new Error('请填写动态内容或选择一张图片');
    await this.online(accountId).call('statusPost', {text, image, color:/^#[0-9a-f]{6}$/i.test(data?.color) ? data.color : ''});
  }
  statusMedia(accountId, id, item) {
    if (typeof id !== 'string' || id.length > 200 || !id.includes('status@broadcast')) throw new Error('无效的动态');
    return media.view(this.online(accountId),{id, time:Date.now(), media:{kind:String(item?.kind || 'image')}});
  }
  openExternal(url) {
    let target;
    try { target = new URL(url); } catch { throw new Error('无效的链接'); }
    if (!['http:','https:'].includes(target.protocol)) throw new Error('只能打开网页链接');
    return shell.openExternal(target.href);
  }
  conversations(accountId) {
    if (!this.sessions.has(accountId)) throw new Error('账号不存在');
    return this.inbox.conversations.page(1000,accountId).messages.map(m => ({chat:m.chat,title:m.title}));
  }
  async forward(accountId, chat, id, to) {
    const {session,message} = this.current(accountId,chat,id);
    if (typeof to !== 'string' || !(this.inbox.conversations.find(accountId,to) || this.people.get(accountId)?.get(to))) throw new Error('请选择要转发到的会话');
    await session.call('forward', to, message.id);
  }
  async createGroup(accountId, name, phones) {
    const session = this.sessions.get(accountId);
    if (!session || session.status !== 'online') throw new Error('请选择已连接的账号');
    if (typeof name !== 'string' || !name.trim() || name.length > 100) throw new Error('请填写 100 字以内的群名称');
    const members = Array.isArray(phones) ? [...new Set(phones.map(p => String(p).replace(/[\s()+-]/g,'')))] : [];
    if (!members.length || members.length > 50 || members.some(p => !/^[1-9]\d{6,14}$/.test(p))) throw new Error('请填写 1 到 50 个含国家区号的手机号');
    const identity = session.identity;
    const group = await session.call('createGroup', name.trim(), members.map(p => p + '@c.us'));
    if (session.disposed || session.identity !== identity || typeof group?.chat !== 'string' || !group.chat.endsWith('@g.us')) throw new Error('群聊创建失败');
    this.inbox.conversations.index(accountId,[{chat:group.chat,title:name.trim(),time:Date.now()}]);
    await this.openChat(accountId,group.chat).catch(() => {});
    return {failed:Array.isArray(group.failed) ? group.failed.slice(0,50).map(String) : []};
  }
  contactInfo(accountId, chat) {
    return this.current(accountId,chat).session.call('contactInfo', chat);
  }
  async saveRemark(accountId, chat, name) {
    const {session} = this.current(accountId,chat);
    if (chat.endsWith('@g.us') || typeof name !== 'string' || name.length > 80) throw new Error('备注最多 80 个字');
    const identity = session.identity;
    const title = String(await session.call('renameContact', chat, name.trim()) || '').slice(0,160);
    if (!title || session.disposed || session.identity !== identity) return;
    this.inbox.conversations.retitle(accountId,chat,title);
    for (const message of this.inbox.byAccount.get(accountId)?.values() || []) if (message.chat === chat) message.title = title;
    const person = this.people.get(accountId)?.get(chat);
    if (person) person.title = title;
    if (this.active === accountId && this.thread?.chat === chat) this.thread.title = title;
    this.publish();
  }
  // Works for any conversation in the list, not only the one that is open.
  async chatSetting(accountId, chat, key, value) {
    const session = this.online(accountId);
    if (typeof chat !== 'string' || !this.inbox.conversations.find(accountId,chat)) throw new Error('会话不存在');
    if (!['muted','pinned','archived','blocked','unread'].includes(key) || (key === 'blocked' && chat.endsWith('@g.us'))) throw new Error('无法修改此设置');
    await session.call('chatSetting', chat, key, value === true);
    if (['muted','pinned','archived'].includes(key)) { this.inbox.conversations.setFlag(accountId,chat,key,value === true); this.publish(); }
  }
  async typing(accountId, chat, active) {
    const {session} = this.current(accountId,chat);
    await session.call('typing', chat, active === true).catch(() => {});
  }
  add(name) {
    const account = this.accounts.add(name);
    this.attach(account);
    this.select(account.id);
  }
  async remove(id) {
    const s = this.sessions.get(id);
    if (!s) return;
    if (this.active === id) this.select(null);
    s.close();
    this.people.delete(id);
    this.inbox.clear(id);
    this.clearNotices(id);
    try {
      await s.ses.clearData();
      this.accounts.remove(id);
      this.sessions.delete(id);
    } catch (err) {
      this.attach(s.account);
      throw err;
    } finally { this.publish(); }
  }
  async more() {
    if (this.thread) return this.readThread();
    await this.moreFeed();
  }
  feedSources() {
    return this.feedScope ? [this.sessions.get(this.feedScope)].filter(Boolean) : [...this.sessions.values()];
  }
  searchFeed(scope, term) {
    if (scope !== this.feedScope || typeof term !== 'string') return;
    this.feedQuery = term.trim().toLocaleLowerCase();
    this.feedLimit = 100;
    this.publish();
  }
  filterUnread(value) {
    this.filter = value === true || value === 'unread' ? 'unread' : value === 'archived' ? 'archived' : 'all';
    this.feedLimit = 100;
    this.publish();
  }
  async moreFeed() {
    this.feedLimit += 100;
    this.publish();
    if (this.inbox.conversations.page(0, this.feedScope).count < this.feedLimit) {
      await Promise.allSettled(this.feedSources().map(s => s.moreHistory()));
    }
  }
  close() {
    clearTimeout(this.queued);
    for (const session of this.sessions.values()) {
      this.clearNotices(session.account.id);
      session.close();
    }
  }
}
module.exports = { Workspace };
