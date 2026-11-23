// A linked device starts with only the most recent messages of each chat. The rest stays on the phone until it is
// asked for. This sends the same request as WhatsApp Web's "get older messages from your phone" and follows
// WhatsApp's own success and failure events, because the phone may answer late or not at all.
window.createHistoryTransfer = function () {
  const asked = new Map();
  let listening = false;
  const idOf = chat => chat.id?._serialized || chat.id?.toString() || '';
  function listen() {
    if (listening) return;
    listening = true;
    try {
      const events = window.require('WAWebHistorySyncOnDemandEvents').WAWebHistorySyncOnDemandEvents;
      const settle = status => jid => {
        const key = String(jid?._serialized || jid || '');
        for (const entry of asked.values()) if (entry.status === 'asking' && (entry.jid === key || entry.chat === key)) { entry.status = status; entry.at = Date.now(); }
      };
      events.on('history_sync_on_demand_events:success_history_sync_od', settle('done'));
      events.on('history_sync_on_demand_events:error_history_sync_od', settle('failed'));
    } catch { /* Without the events a request simply expires after a while. */ }
  }
  // True while the phone still holds earlier messages of this chat.
  const pending = chat => chat?.endOfHistoryTransferType === 0;
  function status(chat) {
    const entry = chat && asked.get(idOf(chat));
    if (!entry) return '';
    // A request with no answer for a long time counts as unanswered.
    if (entry.status === 'asking' && Date.now() - entry.at > 45000) { entry.status = 'failed'; entry.at = Date.now(); }
    return entry.status;
  }
  // `force` is a retry the user asked for; otherwise a chat that just failed is left alone for a while,
  // because WhatsApp switches these requests off after repeated failures.
  async function requestHistory(chat, force = false) {
    if (!pending(chat)) return;
    listen();
    const id = idOf(chat), entry = asked.get(id), state = status(chat);
    if (state === 'asking' || (!force && state === 'failed' && Date.now() - entry.at < 180000)) return;
    let jid = id;
    try { jid = chat.id.toJid(); } catch { /* Older builds match on the chat id. */ }
    const record = {chat:id, jid, status:'asking', at:Date.now()};
    asked.set(id, record);
    try {
      if (window.require('WAWebNonMessageDataRequestHistorySyncOnDemandUtils').historySyncOnDemandRequestsFailureRecord.disableRequestSending) { record.status = 'failed'; return; }
    } catch { /* The check is optional. */ }
    try {
      let send = window.require('WAWebSendNonMessageDataRequest').sendPeerDataOperationRequest;
      try {
        const runtime = window.require('WAWebBackendRuntime');
        if (runtime.isWebDiBackendEnabled()) send = runtime.runtime(window.require('WAWebPeerDataService').PeerDataService).sendPeerDataOperationRequest;
      } catch { /* The direct sender is used. */ }
      await send(3,{chatId:chat.id});
    } catch { record.status = 'failed'; record.at = Date.now(); }
  }
  requestHistory.pending = pending;
  requestHistory.status = status;
  return requestHistory;
};
