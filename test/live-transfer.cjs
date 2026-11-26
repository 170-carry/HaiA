// Checks the account transfer with an account that is really linked on this computer.
// Phase "export": opens the real profile, counts what one signed-in account can read, exports its login.
// Phase "import": opens an empty profile, imports the file and counts again. In this phase the connection to
// WhatsApp's chat servers is blocked, so the copy never talks to WhatsApp: the real account is not disturbed, and what
// is counted is exactly what came across in the file. Only counts are printed. The installed app must be closed.
// Run: npx electron test/live-transfer.cjs <folder> export|import
process.env.HAIA_TEST = '1';
const { app, BrowserWindow, dialog, webContents, session } = require('electron');
const fs = require('node:fs'), path = require('node:path');
const [dir, phase] = process.argv.slice(2);
if (!dir || !['export','import'].includes(phase)) throw new Error('需要目录和阶段');
const file = path.join(dir,'transfer.haia'), notes = path.join(dir,'before.json');
dialog.showSaveDialog = async () => ({filePath:file});
dialog.showOpenDialog = async () => ({filePaths:[file]});
if (phase === 'import') {
  const profile = path.join(dir,'computer-b');
  fs.mkdirSync(profile,{recursive:true});
  app.setPath('userData',profile); app.setPath('sessionData',profile);
  app.on('session-created', ses => ses.webRequest.onBeforeRequest({urls:['wss://*/*','ws://*/*']}, (_details, done) => done({cancel:true})));
}
require('../src/main/app.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve,ms));
// Runs inside the WhatsApp page: how many chats there are and how many messages the local copy holds in the latest ones.
const count = `(async () => {
  const chats = (await WPP.chat.list({ignoreGroupMetadata:true})).filter(c => /@(c\\.us|g\\.us|lid)$/.test(c.id.toString())).sort((a,b) => (b.t || 0) - (a.t || 0));
  const rows = [];
  for (const chat of chats.slice(0,25)) {
    let total = 0, before;
    for (let page = 0; page < 15; page++) {
      const found = await WPP.chat.getMessages(chat.id,{count:40,id:before,direction:'before'});
      total += found.length;
      if (found.length < 40) break;
      before = found.reduce((oldest,row) => row.t < oldest.t ? row : oldest).id._serialized;
    }
    rows.push(total);
  }
  return {signedIn:Boolean(WPP.conn.isAuthenticated()), chats:chats.length, messagesInLatest25:rows.reduce((a,b) => a + b,0), perChat:rows};
})()`;
// Counts the records in WhatsApp Web's own local database, which works even while the page is not connected.
const stored = `(async () => {
  const names = (await indexedDB.databases()).map(d => d.name);
  if (!names.includes('model-storage')) return {databases:names.length, modelStorage:false};
  const db = await new Promise((done,fail) => { const open = indexedDB.open('model-storage'); open.onsuccess = () => done(open.result); open.onerror = () => fail(open.error); });
  const out = {databases:names.length, modelStorage:true, stores:db.objectStoreNames.length};
  for (const name of ['chat','message','contact','group-metadata']) if (db.objectStoreNames.contains(name))
    out[name] = await new Promise(done => { const ask = db.transaction(name).objectStore(name).count(); ask.onsuccess = () => done(ask.result); ask.onerror = () => done(-1); });
  db.close();
  return out;
})()`;
const pageOf = id => webContents.getAllWebContents().find(w => !w.isDestroyed() && w.session === session.fromPartition('persist:wa-' + id) && w.getURL().startsWith('https:'));
(async () => {
  await app.whenReady();
  await delay(1500);
  const shell = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('file:')).webContents;
  const ui = code => shell.executeJavaScript(code);
  if (phase === 'export') {
    let state;
    for (let i = 0; i < 80; i++) { state = await ui('window.desk.state()'); if (state.accounts.some(a => a.status === 'online')) break; await delay(1500); }
    const account = state.accounts.find(a => a.status === 'online');
    if (!account) throw new Error('没有已连接的账号');
    await delay(8000);
    const before = await pageOf(account.id).executeJavaScript(count);
    console.log('BEFORE ' + JSON.stringify(before));
    before.stored = await pageOf(account.id).executeJavaScript(stored);
    console.log('STORED_BEFORE ' + JSON.stringify(before.stored));
    const started = Date.now();
    const result = await ui('window.desk.backupExport(' + JSON.stringify([account.id]) + ')');
    console.log('EXPORT ' + JSON.stringify({accounts:result.accounts, megabytes:+(result.size / 1048576).toFixed(1), seconds:Math.round((Date.now() - started) / 1000)}));
    let back = false;
    for (let i = 0; i < 60 && !back; i++) { await delay(1500); back = (await ui('window.desk.state()')).accounts.find(a => a.id === account.id)?.status === 'online'; }
    console.log('SOURCE_ONLINE_AGAIN ' + back);
    fs.writeFileSync(notes,JSON.stringify(before));
  } else {
    const before = JSON.parse(fs.readFileSync(notes,'utf8'));
    const result = await ui('window.desk.backupImport()');
    const id = result.login.find(r => r.account)?.account;
    if (!id) throw new Error('没有导入任何账号');
    // Offline on purpose, so "online" never comes; the page is ready once it has opened the stored account.
    let after = null, link = '';
    for (let i = 0; i < 60; i++) {
      await delay(2000);
      const page = pageOf(id);
      if (!page) continue;
      if (i % 10 === 5) console.log('PROBE ' + JSON.stringify(await page.executeJavaScript("({wpp:typeof WPP, ready:typeof WPP === 'object' ? WPP.isReady : null, full:typeof WPP === 'object' ? WPP.isFullReady : null, auth:(()=>{try{return WPP.conn.isAuthenticated()}catch{return 'n/a'}})(), registered:(()=>{try{return WPP.conn.isRegistered()}catch{return 'n/a'}})(), qr:!!document.querySelector('canvas, [data-ref]'), text:document.body.innerText.length})").catch(e => String(e.message).slice(0,80))));
      if (i === 20) console.log('STORED_AFTER ' + JSON.stringify(await page.executeJavaScript(stored).catch(e => String(e.message).slice(0,80))) + ' STORED_BEFORE ' + JSON.stringify(before.stored));
      link = await page.executeJavaScript("typeof WPP === 'object' && WPP.isReady ? (WPP.conn.isAuthenticated() ? 'signed-in' : document.querySelector('canvas, [data-ref]') ? 'asks-for-qr' : 'loading') : 'loading'").catch(() => 'loading');
      if (link !== 'signed-in') continue;
      after = await page.executeJavaScript(count).catch(() => null);
      if (after) break;
    }
    console.log('LINK_STATE ' + link);
    console.log('AFTER ' + JSON.stringify(after));
    if (after) console.log('COMPARE ' + JSON.stringify({signedInWithoutPairing:after.signedIn, chatsBefore:before.chats, chatsAfter:after.chats,
      messagesBefore:before.messagesInLatest25, messagesAfter:after.messagesInLatest25, chatsWithFewerMessages:after.perChat.filter((n,i) => n < before.perChat[i]).length}));
  }
  app.exit(0);
})().catch(error => { console.error('FAILED ' + error.message); app.exit(1); });
