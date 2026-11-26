if (require('./backup/snapshot-worker.cjs').runSnapshotWorker()) return;
const { app, BrowserWindow, ipcMain, Menu, dialog, systemPreferences, protocol, Tray, nativeImage } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { readPhoto } = require('./profile-photo.cjs');
const { translationRoutes } = require('./translation/service.cjs');
const { Accounts } = require('./accounts.cjs');
const { Workspace } = require('./workspace.cjs');
const { Preferences } = require('./preferences.cjs');

const fs = require('node:fs');
app.setName('HaiA');
// Existing users keep their linked sessions and settings in the original profile.
const legacyProfile = path.join(app.getPath('appData'), 'Relay Desk');
if (app.getPath('userData') === path.join(app.getPath('appData'), 'HaiA') &&
    fs.existsSync(path.join(legacyProfile, 'accounts.json'))) {
  app.setPath('userData', legacyProfile);
  app.setPath('sessionData', legacyProfile);
}
// Downloaded media is read by the window through this scheme. It has to be declared before the app is ready.
protocol.registerSchemesAsPrivileged([{scheme:'haia-media',privileges:{stream:true,supportFetchAPI:true}}]);
app.setAppUserModelId('com.relaydesk.desktop');
let win;
let desk;
if (!app.requestSingleInstanceLock()) app.quit();
else app.whenReady().then(async () => {
  const index = path.join(__dirname, '../ui/index.html');
  const accounts = new Accounts(app.getPath('userData'));
  const titleBarColors = {color:'#18181a', symbolColor:'#f2f2f7'};
  win = new BrowserWindow({ title: 'HaiA', width: 1260, height: 820, minWidth: 820, minHeight: 520,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    ...(process.platform === 'darwin' ? {trafficLightPosition: {x: 14, y: 10}} :
      {titleBarOverlay: {...titleBarColors, height: 34}}),
    backgroundColor: titleBarColors.color, webPreferences: {
      sandbox: true, contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, 'preload.cjs')
    }
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{role:'appMenu'}] : []),
    {role:'editMenu'}, {role:'windowMenu'}
  ]));
  win.webContents.setWindowOpenHandler(() => ({action:'deny'}));
  win.webContents.session.protocol.handle('haia-media', request => require('./media.cjs').serve(request));
  // Text fields get cut, copy, paste and spelling suggestions; selected text anywhere can be copied.
  win.webContents.on('context-menu', (_event, params) => {
    const items = [];
    if (params.isEditable) {
      for (const word of params.dictionarySuggestions.slice(0,5)) items.push({label:word, click:() => win.webContents.replaceMisspelling(word)});
      if (items.length) items.push({type:'separator'});
      items.push({role:'undo',label:'撤销'},{role:'redo',label:'重做'},{type:'separator'},{role:'cut',label:'剪切',enabled:params.editFlags.canCut},
        {role:'copy',label:'复制',enabled:params.editFlags.canCopy},{role:'paste',label:'粘贴',enabled:params.editFlags.canPaste},{role:'selectAll',label:'全选'});
    } else if (params.selectionText.trim()) items.push({role:'copy',label:'复制'});
    if (items.length) Menu.buildFromTemplate(items).popup({window:win});
  });
  win.webContents.on('will-navigate', e => e.preventDefault());
  const preferences = new Preferences(app.getPath('userData'));
  desk = new Workspace(win, accounts, preferences);
  // Closing the window keeps the accounts connected in the background; quitting the app ends them.
  let quitting = Boolean(process.env.HAIA_TEST), tray;
  app.on('before-quit', () => { quitting = true; });
  app.on('activate', () => { win.show(); win.focus(); });
  win.on('close', event => {
    if (quitting || !preferences.all.background) return;
    event.preventDefault(); win.hide();
    if (process.platform !== 'darwin' && !tray) {
      tray = new Tray(nativeImage.createFromPath(path.join(__dirname,'../ui/assets/relay-icon.png')).resize({width:16,height:16}));
      tray.setToolTip('HaiA');
      tray.setContextMenu(Menu.buildFromTemplate([{label:'打开 HaiA',click:() => { win.show(); win.focus(); }},{label:'退出',click:() => { quitting = true; app.quit(); }}]));
      tray.on('click', () => { win.show(); win.focus(); });
    }
  });
  const routes = {
    ...require('./backup/routes.cjs').backupRoutes(desk,app.getPath('userData')),
    ...require('./account-health/routes.cjs').healthRoutes(desk),
    ...require('./group-routes.cjs').groupRoutes(desk),
    ...translationRoutes(app.getPath('userData'),require('electron').safeStorage,require('electron').net.fetch.bind(require('electron').net)),
    state: () => desk.snapshot(),
    ...require('./updates/service.cjs').updateRoutes({
      app, fetch:require('electron').net.fetch.bind(require('electron').net),
      notify:state=>{ if(!win.isDestroyed()) win.webContents.send('desk:update-progress',state); },
      quit:()=>{ quitting=true; desk.close(); app.quit(); }
    }),
    preferences: () => ({...preferences.all, version:require('../../package.json').version}), savePreferences: patch => desk.savePreferences(patch),
    searchHistory: (scope, term, chat) => require('./history-search.cjs').searchHistory(desk,scope,term,chat),
    openHistoryHit: (account, chat, id) => require('./history-search.cjs').openHit(desk,account,chat,id),
    reorder: ids => desk.reorder(ids), searchMessages: (scope, term, starred) => desk.searchMessages(scope, term, starred === true),
    messageInfo: (id, chat, msg) => desk.messageInfo(id, chat, msg), setEphemeral: (id, chat, seconds) => desk.setEphemeral(id, chat, seconds),
    contacts: (id, term) => desk.contacts(id, term),
    profileInfo: id => desk.profileInfo(id), saveProfile: (id, field, value) => desk.saveProfile(id, field, value),
    sendPath: (id, chat, file, meta) => desk.sendPath(id, chat, file, meta), select: id => desk.select(id), add: name => desk.add(name),
    photo: (id,who) => readPhoto(desk.sessions.get(id),who).catch(()=>null),
    searchFeed: (scope,term) => desk.searchFeed(scope,term),
    filterUnread: value => desk.filterUnread(value),
    openChat: (account, chat) => desk.openChat(account,chat), searchPeople: term => desk.searchPeople(term),
    open: (account, id) => desk.openMessage(account, id), more: () => desk.more(), moreFeed: () => desk.moreFeed(),
    send: (id, chat, text, quote, mentions) => desk.send(id, chat, text, quote, mentions),
    sendFile: (id, chat, file) => desk.sendFile(id, chat, file),
    media: (id, chat, msg) => desk.media(id, chat, msg), saveMedia: (id, chat, msg) => desk.saveMedia(id, chat, msg),
    react: (id, chat, msg, emoji) => desk.react(id, chat, msg, emoji), edit: (id, chat, msg, text, mentions) => desk.edit(id, chat, msg, text, mentions),
    removeMessage: (id, chat, msg, everyone) => desk.removeMessage(id, chat, msg, everyone),
    typing: (id, chat, active) => desk.typing(id, chat, active),
    sendSpecial: (id, chat, kind, data) => desk.sendSpecial(id, chat, kind, data), star: (id, chat, msg, on) => desk.star(id, chat, msg, on),
    chatLabels: (id, chat) => desk.chatLabels(id, chat), setLabel: (id, chat, label, on, name) => desk.setLabel(id, chat, label, on, name),
    statusList: id => desk.statusList(id), statusItems: (id, chat) => desk.statusItems(id, chat), statusPost: (id, data) => desk.statusPost(id, data),
    statusMedia: (id, msg, item) => desk.statusMedia(id, msg, item), openExternal: url => desk.openExternal(url),
    callStart: (id, chat, video) => desk.callStart(id, chat, video), callAction: (id, action, value) => desk.callAction(id, action, value),
    replyAs: (id, chat) => desk.replyAs(id, chat),
    conversations: id => desk.conversations(id), forward: (id, chat, msg, to, dest) => require('./forward-message.cjs').forwardMessage(desk,id,chat,msg,to,dest),
    createGroup: (id, name, phones) => desk.createGroup(id, name, phones),
    micAccess: () => require('./permissions.cjs').mediaAccess(win,'microphone'),
    contactInfo: (id, chat) => desk.contactInfo(id, chat), saveRemark: (id, chat, name) => desk.saveRemark(id, chat, name),
    chatSetting: (id, chat, key, value) => desk.chatSetting(id, chat, key, value), requestReview: (id, chat) => desk.requestReview(id, chat),
    pair: (id,phone) => {
      if (id !== desk.active || !desk.sessions.has(id)) throw new Error('请先选择要关联的账号');
      return desk.sessions.get(id).pair(phone);
    },
    reload: id => desk.sessions.get(id)?.load()
  };
  for (const [name, handler] of Object.entries(routes)) ipcMain.handle('desk:' + name, (event, ...args) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame ||
        event.senderFrame.url !== pathToFileURL(index).href) throw new Error('无效窗口');
    return handler(...args);
  });
  win.once('closed', () => { desk.close(); app.quit(); });
  await win.loadFile(index);
}).catch(err => { dialog.showErrorBox('HaiA 无法启动', err.message); app.quit(); });
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
