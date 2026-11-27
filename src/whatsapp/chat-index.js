// Runs inside the linked device. Directory rows do not depend on message history.
window.createRelayIndex = function (latestMessages, format, enqueue) {
  const idOf = value => value?._serialized || value?.toString() || '';
  const isChat = id => /@(c\.us|s\.whatsapp\.net|g\.us|lid)$/.test(id);
  const initialChanges = new Map(), unread = new Map(), known = new Map(), queue = new Map(), retry = new Map();
  let nextScan = 0, busy = false, failed = false, initialized = false, unreadDirty = true, directory = null;
  function updateUnread(id, value) {
    if (!isChat(id)) return;
    const count = value === -1 ? 1 : Math.max(0, Number(value) || 0);
    if (!initialized) initialChanges.set(id,count);
    if ((unread.get(id) || 0) === count) return;
    if (count) unread.set(id, count); else unread.delete(id);
    unreadDirty = true;
  }
  async function advance() {
    if (busy) return;
    busy = true;
    try {
      if (Date.now() >= nextScan) {
        const chats = await WPP.chat.list({ignoreGroupMetadata:true});
        directory = [];
        for (const model of chats) {
          const chat = idOf(model.id);
          if (!isChat(chat)) continue;
          const title = model.formattedTitle || model.name || model.contact?.pushname || chat.split('@')[0];
          const time = Number(model.t || 0) * 1000;
          const phone = contactPhoneDigits(chat, model.contact?.phoneNumber, model.contact?.formattedUser);
          const mute = model.muteExpiration ?? model.mute?.expiration;
          const flags = {pinned:Boolean(model.pin), archived:Boolean(model.archive), muted:Boolean(model.isMuted || mute === -1 || mute > Date.now()/1000)};
          // A short status for the list: a suspended or admin-only group, a group this number left, a blocked contact.
          const meta = model.groupMetadata;
          let blocked = false;
          try { blocked = !chat.endsWith('@g.us') && Boolean(WPP.blocklist?.isBlocked?.(chat)); } catch { /* The block list may not be loaded yet. */ }
          flags.state = meta?.suspended && !meta.terminated && String(meta.suspendAppealStatus || '').toUpperCase() === 'IN_REVIEW' ? 'review' : meta?.terminated || meta?.suspended ? 'suspended' : chat.endsWith('@g.us') && model.isReadOnly ? 'left' : meta?.announce ? 'announce' : blocked ? 'blocked' : '';
          const stamp = JSON.stringify([title,phone,time,idOf(model.lastReceivedKey),flags]);
          if (known.get(chat) !== stamp) {
            known.set(chat, stamp);
            queue.set(chat, {model});
            retry.delete(chat);
            directory.push({chat,title,phone,time,...flags});
          }
          if ((retry.get(chat)?.at ?? Infinity) <= Date.now()) queue.set(chat,{model,before:retry.get(chat).before});
          updateUnread(chat, model.unreadCount);
        }
        initialized = true;
        failed = false;
        nextScan = Date.now() + 15000;
      }
      let processed = 0;
      const budget = Math.min(queue.size,12);
      for (const [id, {model,before}] of queue) {
        if (processed++ >= budget) break;
        queue.delete(id);
        try {
          const rows = (await latestMessages(model,before)).map(row => format(row, model, false)).filter(Boolean);
          if (rows.length || before) {
            const content = rows.filter(row => row.previewable !== false && !row.pendingText);
            enqueue(before ? content : rows);
            retry.delete(id);
            if (!content.length && rows.length) {
              const cursor = window.relayPreviewHistory.oldestId(rows);
              if (cursor && cursor !== before) queue.set(id,{model,before:cursor});
            }
            continue;
          }
        } catch { /* A missing preview must not block the directory. */ }
        const delay = Math.min((retry.get(id)?.delay || 7500) * 2, 300000);
        retry.set(id,{before,delay,at:Date.now()+delay});
      }
    } catch { failed = true; nextScan = Date.now() + 6000; }
    finally { busy = false; }
  }
  return {
    updateUnread, refresh() { nextScan = 0; },
    take(online, refresh = true) {
      if (online && refresh && (queue.size || Date.now() >= nextScan)) void advance();
      const entries = online ? directory : null;
      if (online) directory = null;
      const chatUnread = online && initialized && unreadDirty ? [...unread] : null;
      const chatUnreadDelta=online && !initialized && initialChanges.size ? [...initialChanges] : null;
      if (online) initialChanges.clear();
      if (chatUnread) unreadDirty = false;
      return {directory:entries, chatUnread, chatUnreadDelta, unreadReady:initialized, unread:[...unread.values()].reduce((a,b)=>a+b,0),
        more:busy || queue.size > 0 || failed, historyError:failed};
    }
  };
};
