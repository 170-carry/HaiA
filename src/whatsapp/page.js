// Runs inside the user's linked WhatsApp Web page. No Electron or filesystem APIs.
(() => {
  if (window.relayReader) return;
  let pending = [], changes = [], logoutReason = '', finalHistory = null;
  const presence = new Map();
  const receipts = new Map();
  let identity = '';
  let requestHistory = window.createHistoryTransfer();
  let index = newIndex(), recovery = newRecovery();
  function newRecovery() {
    const worker = window.createMessageRecovery(async (id, chatId) => {
      const chat = WPP.chat.get(chatId);
      try {
        const batch = await WPP.whatsapp?.MsgStore?.getMessagesById?.([id]);
        const record = batch?.messages?.find(msg=>msg.id?._serialized === id);
        const row = record && format(record,chat,false);
        if (row && !row.pendingText) return row;
      } catch { /* Some web builds expose only the in-memory model lookup. */ }
      const msg = await WPP.chat.getMessageById(id);
      return msg && format(msg,chat,false);
    }, row => { if (worker === recovery) pending.push(row); });
    return worker;
  }
  function newIndex() {
    const source = window.createRelayIndex(window.relayPreviewHistory.readPage, format, rows => {
      if (source === index) pending.push(...rows);
    });
    return source;
  }
  let loaderReady = false;
  async function loadVotes(id) {
    const owner = identity;
    try {
      const votes = await window.relayMore.votes(id);
      if (owner === identity) changes.push([id,{votes}]);
    } catch { /* Vote counts are optional detail. */ }
  }
  async function loadReactions(id) {
    const owner = identity;
    try {
      const reactions = await window.relayExtras.reactions(id);
      if (owner === identity) changes.push([id,{reactions}]);
    } catch { /* Reactions are optional detail. */ }
  }
  const labels = { image: '图片', video: '视频', ptt: '语音', audio: '音频', document: '文件',
    sticker: '贴纸', location: '位置', vcard: '联系人', multi_vcard: '联系人', revoked: '消息已撤回', poll_creation: '投票', call_log:'通话记录', gp2:'群通知', notification_template:'系统通知', notification:'系统通知', e2e_notification:'加密通知', protocol:'系统通知', reaction:'表情回应', buttons_response:'按钮回复', list_response:'列表回复' };

  function reset(nextIdentity) {
    if (identity) finalHistory = {identity,messages:pending,changes,acknowledgements:[...receipts],...index.take(true,false)};
    pending = []; changes = []; receipts.clear(); presence.clear(); window.relayMore.calls.reset();
    index = newIndex();
    recovery = newRecovery();
    requestHistory = window.createHistoryTransfer();
    identity = nextIdentity;
  }
  function format(msg, chat, live) {
    const id = msg.id?._serialized;
    const remote = chat?.id?._serialized || chat?.id?.toString() || msg.id?.remote?._serialized || msg.id?.remote?.toString();
    if (!id || !remote || remote.endsWith('@broadcast') || remote.endsWith('@newsletter') || !msg.t) return;
    const title = chat?.formattedTitle || chat?.name || chat?.contact?.pushname || remote.split('@')[0];
    const textMessage = ['chat','text'].includes(msg.type);
    const pendingText = msg.type === 'ciphertext' || (textMessage && !msg.body);
    const groupSender = remote.endsWith('@g.us') ? window.relayGroupMessage.sender(msg) : null;
    const notice = window.relaySystemNotice(msg);
    const text = notice || (pendingText ? '' : ['chat','text'].includes(msg.type) ? msg.body : (window.relayExtras.describe(msg) || msg.caption || msg.filename || labels[msg.type] || (msg.type ? '消息类型：' + msg.type : '暂无消息内容')));
    const mention = window.relayMore.mentions(msg, typeof text === 'string' ? text : '');
    const mute = chat?.muteExpiration;
    const system = ['gp2','notification','notification_template','e2e_notification','protocol'].includes(msg.type);
    const previewable = !pendingText && typeof text === 'string' && Boolean(text.trim()) &&
      (textMessage || Boolean(msg.caption || msg.filename) || (!system && Boolean(labels[msg.type])) || msg.type === 'gp2');
    return { mentions:mention.names, mentionsMe:mention.me, ephemeral:Number(msg.ephemeralDuration) || 0, link:window.relayMore.link(msg), poll:window.relayMore.poll(msg), starred:Boolean(msg.star), media:window.relayExtras.media(msg), quote:window.relayExtras.quote(msg), edited:Boolean(msg.latestEditMsgKey), forwarded:Boolean(msg.isForwarded),
      ack:Number.isInteger(msg.ack) ? msg.ack : null, system, previewable, type:msg.type, subtype:msg.subtype, translatable:!pendingText && !system && Boolean(['chat','text'].includes(msg.type) ? msg.body : msg.caption), id, rowId:Number.isSafeInteger(msg.rowId) ? msg.rowId : null, chat: remote, title, sender: groupSender?.name || msg.notifyName || msg.author?.user || '', text: String((mention.names.length ? mention.text : text) || ''), originalText:(textMessage || ['vcard','buttons_response','list_response'].includes(msg.type)) ? msg.body : msg.caption, time: msg.t * 1000,
      senderId: groupSender?.id || msg.author?._serialized || msg.author?.toString() || null, pendingText, outgoing: !!msg.id.fromMe, live, latestInChat: id === chat?.lastReceivedKey?._serialized, notify: live && !system && !pendingText && !msg.id.fromMe && !chat?.isMuted && !(mute === -1 || mute > Date.now()/1000) };
  }
  WPP.loader.onReady(() => {
    loaderReady = true;
    WPP.on('chat.unread_count_changed', ({chat, unreadCount}) => {
      index.updateUnread(chat.id._serialized || chat.id.toString(), unreadCount);
    });
    window.relayPairing.listen();
    WPP.on('conn.logout', () => reset(''));
    WPP.on('conn.logout_reason', reason => { logoutReason = String(reason || '').slice(0,60); });
    const restore = msg => {
      if (!recovery.includes(msg?.id?._serialized) || !msg.type || msg.type === 'ciphertext') return;
      if (['chat','text'].includes(msg.type) && !msg.body) return;
      const row = format(msg,WPP.chat.get(msg.id.remote),false);
      if (row && !row.pendingText) { recovery.observe(row); pending.push(row); }
    };
    for (const event of ['change:type','change:body','add']) WPP.whatsapp?.MsgStore?.on(event,restore);
    WPP.whatsapp?.MsgStore?.on('change:ack', msg => {
      if (msg.id?.fromMe && Number.isInteger(msg.ack)) receipts.set(msg.id._serialized,msg.ack);
    });
    WPP.on('chat.msg_ack_change', ({ids,ack,sender,chat}) => {
      // Group participant receipts do not imply that every member has read the message.
      if (sender || String(chat).endsWith('@g.us')) return;
      if (!Number.isInteger(ack)) return;
      for (const key of ids || []) {
        const id = key?._serialized || (typeof key === 'string' && key);
        if (id) receipts.set(id,ack);
      }
    });
    window.relayMore.listen();
    WPP.on('chat.poll_response', ({msgId}) => {
      const id = msgId?._serialized || (typeof msgId === 'string' && msgId);
      if (id) void loadVotes(id);
    });
    WPP.on('chat.msg_revoke', ({refId}) => {
      const id = refId?._serialized || (typeof refId === 'string' && refId);
      if (id) changes.push([id,{revoked:true}]);
    });
    WPP.on('chat.msg_edited', ({id,msg}) => {
      const key = msg?.id?._serialized || id?._serialized || (typeof id === 'string' && id);
      if (key && typeof msg?.body === 'string') changes.push([key,{text:msg.body,edited:true}]);
    });
    WPP.on('chat.new_reaction', ({msgId}) => {
      const id = msgId?._serialized || (typeof msgId === 'string' && msgId);
      if (id) void loadReactions(id);
    });
    WPP.on('chat.presence_change', event => {
      const entry = window.relayExtras.presence(event);
      if (entry) presence.set(entry[0],entry[1]);
    });
    WPP.on('chat.new_message', msg => {
      let chat;
      try { chat = WPP.chat.get(msg.id.remote); } catch { /* New conversation. */ }
      const row = format(msg, chat, true);
      if (row) pending.push(row);
    });
  });
  window.relayReader = {
    ...window.createHistorySearch(format),
    ...window.createAccountBackupReader(format),
    take(draining = false) {
      let status = 'loading';
      if (loaderReady) {
        if (WPP.conn.isAuthenticated()) {
          status = WPP.conn.isMainReady() ? 'online' : 'syncing';
          logoutReason = '';
          const current = WPP.conn.getMyUserId()?.toString() || '';
          if (current && current !== identity) {
            if (identity) reset(current); else identity = current;
          }
        } else {
          status = 'pair';
          if (identity) reset('');
        }
      } else if (document.querySelector('canvas, [data-ref]')) status = 'pair';
      const messages = status === 'online' ? pending.splice(0, 250) : [];
      if (status === 'online' && !draining) {
        for (const row of messages) recovery.observe(row);
        void recovery.tick();
      }
      const acknowledgements = [...receipts]; receipts.clear();
      const updates = status === 'online' ? changes.splice(0,500) : [];
      const typing = [...presence]; presence.clear();
      let historySync = null;
      try { const sync = WPP.conn.getHistorySyncProgress?.(); // On a linked account this flag can stay set at 0 % long after linking, so only real progress is reported.
        if (sync?.inProgress && sync.progress > 0 && sync.progress < 100) historySync = {progress:Number.isFinite(sync.progress) ? Math.round(sync.progress) : null, paused:Boolean(sync.paused)}; } catch { /* Not available on this build. */ }
      const lastBatch=finalHistory;finalHistory=null;
      return { lastBatch, historySync, restriction:status === 'online' ? window.relayLimits.take() : null, call:window.relayMore.calls.take(), logout:logoutReason, status, identity, messages, acknowledgements, changes:updates, presence:typing, link: window.relayPairing.status(), ...index.take(status === 'online',!draining) };
    },
    listGroups:window.relayGroupTools.list, groupInfo:window.relayGroupTools.info, saveGroup:window.relayGroupTools.save, groupInvite:window.relayGroupTools.invite,
    more() { index.refresh(); },
    searchPeople: window.relaySearchPeople,
    contactInfo:window.relayContact.info, renameContact:window.relayContact.rename, chatSetting:window.relayContact.set, requestReview:window.relayContact.review,
    photo: window.relayProfilePhoto,
    async thread(chatId, before, retry) {
      const chat = WPP.chat.get(chatId);
      const worker = recovery;
      const rows = await WPP.chat.getMessages(chatId, { count: 40, id: before || undefined, direction: 'before' });
      const messages = rows.map(row => format(row, chat, false)).filter(Boolean);
      for (const row of messages) worker.observe(row);
      for (const row of rows) if (row.hasReaction && row.id?._serialized) void loadReactions(row.id._serialized);
      for (const row of rows) if (row.type === 'poll_creation' && row.id?._serialized) void loadVotes(row.id._serialized);
      // A short page means the local copy has run out. If the phone still has earlier messages they are asked for.
      // The answer can take a while, or never come when the phone is asleep or offline.
      const remote = rows.length < 40 && requestHistory.pending(chat);
      if (remote || messages.some(row=>row.pendingText)) void requestHistory(chat, retry === true);
      const transfer = remote ? requestHistory.status(chat) || 'asking' : '';
      return {rows:messages,more:rows.length >= 40 || remote,waiting:transfer === 'asking',phoneSilent:transfer === 'failed'};
    },
    async markRead(chatId) { await WPP.chat.markIsRead(chatId); return true; },
    async watch(chatId) {
      if (!chatId.endsWith('@g.us')) await WPP.contact.subscribePresence(chatId);
      return true;
    },
    async typing(chatId, active) {
      if (active) await WPP.chat.markIsComposing(chatId,5000); else await WPP.chat.markIsPaused(chatId);
      return true;
    },
    mediaOpen:window.relayExtras.open, mediaPiece:window.relayExtras.piece, mediaClose:window.relayExtras.close,
    uploadOpen:window.relayExtras.uploadOpen, uploadPiece:window.relayExtras.uploadPiece, uploadClose:window.relayExtras.uploadClose,
    async uploadSend(chatId, token, file) {
      const content = window.relayExtras.uploadTake(token,file.name,file.mime);
      const result = await WPP.chat.sendFileMessage(chatId, content, { type:file.kind === 'ptt' ? 'audio' : file.kind || 'auto-detect', isPtt:file.kind === 'ptt', filename:file.name, mimetype:file.mime, caption:file.caption || undefined, mentionedList:file.mentions,
        waitForAck:false, ...(file.quote ? {quotedMsg:file.quote} : {}) });
      return this.sent(result,chatId,file.caption || file.name);
    },
    async react(id, emoji) {
      await WPP.chat.sendReactionToMessage(id, emoji || false);
      await loadReactions(id);
      return true;
    },
    async remove(chatId, id, everyone) {
      const result = [].concat(await WPP.chat.deleteMessage(chatId,id,true,everyone))[0];
      if (everyone && result && !result.isRevoked) throw new Error('这条消息已无法撤回');
      changes.push([id,everyone ? {revoked:true} : {removed:true}]);
      return true;
    },
    async edit(id, text, mentions) {
      await WPP.chat.editMessage(id,text,{linkPreview:false,mentionedList:mentions});
      changes.push([id,{text,edited:true}]);
      return true;
    },
    async sent(result, chatId, fallback) {
      if (!result?.id) throw new Error('发送结果未知');
      let row;
      try {
        const msg = await WPP.chat.getMessageById(result.id);
        row = msg && format(msg,WPP.chat.get(chatId),true);
      } catch { /* The stored model may not be readable yet. */ }
      return row || {id: result.id, chat: chatId, title: WPP.chat.get(chatId)?.formattedTitle || chatId,
        text:fallback, time: Date.now(), ack:Number.isInteger(result.ack) ? result.ack : null, translatable:true, outgoing: true, live: true};
    },
    async sendSpecial(chatId, kind, data) {
      const labels = {location:'位置',contact:'联系人',poll:'投票'};
      return this.sent(await window.relayMore.special(chatId,kind,data),chatId,labels[kind]);
    },
    async star(id, on) { await WPP.chat.starMessage(id,on); changes.push([id,{starred:on}]); return true; },
    messageInfo:window.relayMore.messageInfo, setEphemeral:window.relayMore.setEphemeral,
    profileInfo:window.relayProfile.info, profileSave:window.relayProfile.save,
    chatLabels:window.relayMore.labels, setLabel:window.relayMore.setLabel, groupMembers:window.relayMore.members,
    statusList:window.relayMore.statusList, statusItems:window.relayMore.statusItems, statusPost:window.relayMore.statusPost,
    callStart:window.relayMore.calls.start, callAccept:window.relayMore.calls.accept, callEnd:window.relayMore.calls.end, callMute:window.relayMore.calls.mute,
    async send(chatId, text, quoted, mentions) {
      const result = await WPP.chat.sendTextMessage(chatId, text, { linkPreview: /https?:\/\/\S+/i.test(text), waitForAck: false, detectMentioned: chatId.endsWith('@g.us'), mentionedList:mentions, ...(quoted ? {quotedMsg:quoted} : {}) });
      return this.sent(result,chatId,text);
    },
    async forward(chatId, id) {
      if (await WPP.chat.forwardMessage(chatId,id) === false) throw new Error('WhatsApp 未接受这次转发');
      return true;
    },
    async createGroup(name, members) {
      const result = await WPP.group.create(name,members);
      const chat = result?.gid?._serialized || result?.gid?.toString();
      if (!chat) throw new Error('群聊创建失败');
      const failed = Object.entries(result.participants || {}).filter(([,entry]) => Number(entry?.code) !== 200)
        .map(([key,entry]) => String(entry?.wid || key).split('@')[0]);
      return {chat,title:name,failed};
    },
    async sendFile(chatId, file) {
      const result = await WPP.chat.sendFileMessage(chatId, file.data, { ...(file.voice ? {type:'audio',isPtt:true} : {type:'auto-detect'}), filename:file.name, caption:file.caption || undefined, mentionedList:file.mentions,
        waitForAck:false, ...(file.quote ? {quotedMsg:file.quote} : {}) });
      return this.sent(result,chatId,file.caption || file.name);
    }
  };
})();
