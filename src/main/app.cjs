const { app, BrowserWindow, ipcMain, Menu, dialog, systemPreferences } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { readPhoto } = require('./profile-photo.cjs');
const { translationRoutes } = require('./translation/service.cjs');
const { Accounts } = require('./accounts.cjs');
const { Workspace } = require('./workspace.cjs');

const fs = require('node:fs');
app.setName('HaiA');
// Existing users keep their linked sessions and settings in the original profile.
const legacyProfile = path.join(app.getPath('appData'), 'Relay Desk');
if (app.getPath('userData') === path.join(app.getPath('appData'), 'HaiA') &&
    fs.existsSync(path.join(legacyProfile, 'accounts.json'))) {
  app.setPath('userData', legacyProfile);
  app.setPath('sessionData', legacyProfile);
}
app.setAppUserModelId('com.relaydesk.desktop');
let win;
let desk;
if (!app.requestSingleInstanceLock()) app.quit();
else app.whenReady().then(async () => {
  const index = path.join(__dirname, '../ui/index.html');
  const accounts = new Accounts(app.getPath('userData'));
  const titleBarColors = {color:'#2b2c31', symbolColor:'#f2f3f5'};
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
  win.webContents.on('will-navigate', e => e.preventDefault());
  desk = new Workspace(win, accounts);
  const routes = {
    ...require('./group-routes.cjs').groupRoutes(desk),
    ...translationRoutes(app.getPath('userData'),require('electron').safeStorage,require('electron').net.fetch.bind(require('electron').net)),
    state: () => desk.snapshot(), select: id => desk.select(id), add: name => desk.add(name),
    photo: (id,who) => readPhoto(desk.sessions.get(id),who).catch(()=>null),
    searchFeed: (scope,term) => desk.searchFeed(scope,term),
    filterUnread: value => desk.filterUnread(value),
    openChat: (account, chat) => desk.openChat(account,chat), searchPeople: term => desk.searchPeople(term),
    open: (account, id) => desk.openMessage(account, id), more: () => desk.more(), moreFeed: () => desk.moreFeed(),
    send: (id, chat, text, quote) => desk.send(id, chat, text, quote),
    sendFile: (id, chat, file) => desk.sendFile(id, chat, file),
    media: (id, chat, msg) => desk.media(id, chat, msg), saveMedia: (id, chat, msg) => desk.saveMedia(id, chat, msg),
    react: (id, chat, msg, emoji) => desk.react(id, chat, msg, emoji), edit: (id, chat, msg, text) => desk.edit(id, chat, msg, text),
    removeMessage: (id, chat, msg, everyone) => desk.removeMessage(id, chat, msg, everyone),
    typing: (id, chat, active) => desk.typing(id, chat, active),
    sendSpecial: (id, chat, kind, data) => desk.sendSpecial(id, chat, kind, data), star: (id, chat, msg, on) => desk.star(id, chat, msg, on),
    chatLabels: (id, chat) => desk.chatLabels(id, chat), setLabel: (id, chat, label, on, name) => desk.setLabel(id, chat, label, on, name),
    statusList: id => desk.statusList(id), statusItems: (id, chat) => desk.statusItems(id, chat), statusPost: (id, data) => desk.statusPost(id, data),
    statusMedia: (id, msg, item) => desk.statusMedia(id, msg, item), openExternal: url => desk.openExternal(url),
    callStart: (id, chat, video) => desk.callStart(id, chat, video), callAction: (id, action, value) => desk.callAction(id, action, value),
    conversations: id => desk.conversations(id), forward: (id, chat, msg, to) => desk.forward(id, chat, msg, to),
    createGroup: (id, name, phones) => desk.createGroup(id, name, phones),
    micAccess: () => process.platform === 'darwin' ? systemPreferences.askForMediaAccess('microphone') : true,
    contactInfo: (id, chat) => desk.contactInfo(id, chat), saveRemark: (id, chat, name) => desk.saveRemark(id, chat, name),
    chatSetting: (id, chat, key, value) => desk.chatSetting(id, chat, key, value),
    pair: (id,phone) => {
      if (id !== desk.active || !desk.sessions.has(id)) throw new Error('请先选择要关联的账号');
      return desk.sessions.get(id).pair(phone);
    },
    reload: id => desk.sessions.get(id)?.load(),
    remove: id => desk.remove(id)
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
