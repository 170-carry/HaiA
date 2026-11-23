// On a really linked account: asks the phone for earlier history of a few chats the same way WhatsApp Web's own
// "get older messages from your phone" button does, and reports what comes back. Prints counts and states only.
process.env.HAIA_TEST = '1';
const { app, BrowserWindow, webContents, session } = require('electron');
require('../src/main/app.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const probe = `(async () => {
  const out = {log:[]};
  const note = (...parts) => out.log.push(parts.join(' '));
  const req = name => window.require(name);
  // WhatsApp's own log lines about history sync say why a request failed.
  out.waLog = [];
  try {
    const logger = req('WALogger');
    for (const level of ['LOG','WARN','ERROR','DEV']) {
      const original = logger[level];
      if (typeof original !== 'function') continue;
      logger[level] = function (strings, ...values) {
        try {
          const text = Array.isArray(strings) ? strings.reduce((line,part,i) => line + part + (i < values.length ? String(values[i]).slice(0,60) : ''),'') : String(strings);
          if (/history sync|rdu|on.demand|peer data/i.test(text) && out.waLog.length < 60) out.waLog.push(level + ' ' + text.replace(/\d{6,}@[a-z.]+/g,'<chat>').slice(0,220));
        } catch (e) { /* Logging must not break the page. */ }
        return original.apply(this, arguments);
      };
    }
  } catch (e) { out.waLog.push('hook failed ' + e.message); }
  out.progress = WPP.conn.getHistorySyncProgress();
  let di = null; try { di = req('WAWebBackendRuntime').isWebDiBackendEnabled(); } catch (e) { di = 'ERR ' + e.message; }
  out.diBackend = di;
  const utils = req('WAWebNonMessageDataRequestHistorySyncOnDemandUtils');
  out.failureRecord = {...utils.historySyncOnDemandRequestsFailureRecord};
  const events = req('WAWebHistorySyncOnDemandEvents').WAWebHistorySyncOnDemandEvents;
  let success = 0, failure = 0;
  try { events.on('history_sync_on_demand_events:success_history_sync_od', () => { success++; }); events.on('history_sync_on_demand_events:error_history_sync_od', () => { failure++; }); } catch (e) { note('listen failed', e.message); }
  const count = async chat => { let total = 0, before; for (let page = 0; page < 30; page++) { const rows = await WPP.chat.getMessages(chat.id,{count:40,id:before,direction:'before'}); total += rows.length; if (rows.length < 40) break; before = rows.reduce((o,r) => r.t < o.t ? r : o).id._serialized; } return total; };
  const chats = (await WPP.chat.list({ignoreGroupMetadata:true})).filter(c => c.endOfHistoryTransferType === 0).sort((a,b) => (b.t || 0) - (a.t || 0)).slice(0,4);
  const before = []; for (const chat of chats) before.push(await count(chat));
  const send = di === true ? req('WAWebBackendRuntime').runtime(req('WAWebPeerDataService').PeerDataService).sendPeerDataOperationRequest : req('WAWebSendNonMessageDataRequest').sendPeerDataOperationRequest;
  const kind = req('WAWebProtobufsE2E.pb').Message$PeerDataOperationRequestType.HISTORY_SYNC_ON_DEMAND;
  out.kind = kind;
  for (const [at,chat] of chats.entries()) {
    try { const result = await send(kind,{chatId:chat.id}); note('request', at, 'ok', typeof result === 'object' ? JSON.stringify(result).slice(0,120) : String(result)); }
    catch (e) { note('request', at, 'FAILED', String(e && e.message || e).slice(0,200)); }
  }
  out.inFlightAfterSend = utils.inFlightHistorySyncOnDemandRequests.size;
  const rounds = [];
  for (let round = 0; round < 6; round++) {
    await new Promise(resolve => setTimeout(resolve,10000));
    const now = []; for (const chat of chats) now.push(await count(chat));
    rounds.push({seconds:(round + 1) * 10, counts:now, transfer:chats.map(c => c.endOfHistoryTransferType), success, failure, inFlight:utils.inFlightHistorySyncOnDemandRequests.size});
  }
  out.before = before; out.rounds = rounds;
  out.progressAfter = WPP.conn.getHistorySyncProgress();
  out.failureRecordAfter = {...utils.historySyncOnDemandRequestsFailureRecord};
  return out;
})()`;
(async () => {
  await app.whenReady(); await delay(1500);
  const shell = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('file:')).webContents;
  let state;
  for (let i = 0; i < 80; i++) { state = await shell.executeJavaScript('window.desk.state()'); if (state.accounts.some(a => a.status === 'online')) break; await delay(1500); }
  const account = state.accounts.find(a => a.status === 'online');
  if (!account) throw new Error('no online account');
  await delay(6000);
  const page = webContents.getAllWebContents().find(w => w.session === session.fromPartition('persist:wa-' + account.id));
  console.log('ONDEMAND ' + JSON.stringify(await page.executeJavaScript(probe)));
  app.exit(0);
})().catch(error => { console.error('FAILED ' + error.message); app.exit(1); });
