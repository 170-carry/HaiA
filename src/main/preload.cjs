const { contextBridge, ipcRenderer } = require('electron');
const desk = { platform: process.platform };
for (const name of ['sendSpecial','star','chatLabels','setLabel','groupMembers','statusList','statusItems','statusPost','statusMedia','openExternal','callStart','callAction','dictate','saveVoiceLanguage','listGroups','groupInfo','updateGroup','translate','translationSettings','saveTranslationSettings','state','select','add','open','openChat','searchPeople','searchFeed','filterUnread','photo','pair','more','moreFeed','reload','remove','send','sendFile','media','saveMedia','react','edit','removeMessage','typing','contactInfo','saveRemark','chatSetting','conversations','forward','createGroup','micAccess']) {
  desk[name] = (...args) => ipcRenderer.invoke('desk:' + name, ...args);
}
desk.onUpdate = callback => ipcRenderer.on('desk:update', (_event, state) => callback(state));
desk.onWarning = callback => ipcRenderer.on('desk:warning', (_event, message) => callback(message));
contextBridge.exposeInMainWorld('desk', desk);
