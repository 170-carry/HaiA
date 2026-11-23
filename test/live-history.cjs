// Measures, on the accounts that are really linked on this computer, how many messages can be read before and after
// asking the phone for earlier history. Read-only: nothing is sent, nothing is marked read. Only counts are printed.
// The installed app must be closed first, because both would use the same linked sessions.
// Run: npx electron test/live-history.cjs [chatsPerAccount]
process.env.HAIA_TEST = '1';
const { app, BrowserWindow, webContents, session } = require('electron');
require('../src/main/app.cjs');
const limit = Math.min(60, Number(process.argv[2]) || 20);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Runs inside the WhatsApp page of one account.
const probe = `(async limit => {
  const chats = (await WPP.chat.list({ignoreGroupMetadata:true})).filter(c => /@(c\\.us|g\\.us|lid)$/.test(c.id.toString()))
    .sort((a,b) => (b.t || 0) - (a.t || 0)).slice(0,limit);
  // Counts what paging through the local copy reaches, which is all the previous version could show.
  const count = async chat => {
    let total = 0, before;
    for (let page = 0; page < 30; page++) {
      const rows = await WPP.chat.getMessages(chat.id,{count:40,id:before,direction:'before'});
      total += rows.length;
      if (rows.length < 40) break;
      before = rows.reduce((oldest,row) => row.t < oldest.t ? row : oldest).id._serialized;
    }
    return total;
  };
  const rows = [];
  for (const chat of chats) rows.push({group:chat.id.toString().endsWith('@g.us'), transfer:chat.endOfHistoryTransferType ?? null, before:await count(chat)});
  const sync = (() => { try { return WPP.conn.getHistorySyncProgress(); } catch { return null; } })();
  const request = window.createHistoryTransfer();
  let asked = 0;
  for (const [at,chat] of chats.entries()) if (request.pending(chat)) { asked++; rows[at].asked = true; await request(chat); }
  // The phone answers a little later; three rounds, like the app's own re-reading.
  for (let round = 0; round < 6; round++) {
    await new Promise(resolve => setTimeout(resolve,8000));
    // Each answer brings about fifty messages, so a chat that still has more on the phone is asked again.
    for (const [at,chat] of chats.entries()) if (rows[at].asked && chat.endOfHistoryTransferType === 0 && request.status(chat) !== 'failed') await request(chat);
  }
  for (const [at,chat] of chats.entries()) { rows[at].after = await count(chat); rows[at].transferAfter = chat.endOfHistoryTransferType ?? null; }
  for (const [at,chat] of chats.entries()) rows[at].state = request.status(chat);
  return {chats:rows.length, asked, syncInProgress:Boolean(sync?.inProgress), rows};
})(${limit})`;

(async () => {
  await app.whenReady();
  await delay(1500);
  const shell = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('file:')).webContents;
  let state;
  for (let i = 0; i < 80; i++) {
    state = await shell.executeJavaScript('window.desk.state()');
    if (state.accounts.length && state.accounts.every(a => ['online','pair','offline','adapter-error'].includes(a.status)) && state.accounts.some(a => a.status === 'online')) break;
    await delay(1500);
  }
  const online = state.accounts.filter(a => a.status === 'online');
  console.log('ACCOUNTS ' + JSON.stringify(state.accounts.map((a,i) => ({account:i + 1,status:a.status}))));
  if (!online.length) throw new Error('没有已连接的账号');
  await delay(6000);
  for (const account of online) {
    const page = webContents.getAllWebContents().find(w => w.session === session.fromPartition('persist:wa-' + account.id));
    const result = await page.executeJavaScript(probe);
    const sum = key => result.rows.reduce((total,row) => total + row[key],0);
    const grew = result.rows.filter(row => row.after > row.before);
    console.log('RESULT ' + JSON.stringify({account:state.accounts.indexOf(account) + 1, chatsChecked:result.chats, chatsWherePhoneHasMore:result.rows.filter(r => r.transfer === 0).length,
      chatsAsked:result.asked, initialSyncRunning:result.syncInProgress, messagesBefore:sum('before'), messagesAfter:sum('after'), chatsThatGrew:grew.length,
      perChat:result.rows.map(r => [r.group ? 'group' : 'private', r.transfer, r.before, r.after, r.transferAfter, r.state])}));
  }
  app.exit(0);
})().catch(error => { console.error('FAILED ' + error.message); app.exit(1); });
