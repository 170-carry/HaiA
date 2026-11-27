const { contextBridge, ipcRenderer, webUtils } = require('electron');
const desk = { platform: process.platform };
for (const name of ['backupExport','backupImport','backupList','backupPage','backupSaveFile','stopPhoneReview','readPhoneReview','accountHelp','watchAccountReview','inspectAccount','profileInfo','saveProfile','groupInvite','requestReview','searchHistory','openHistoryHit','checkUpdate','updateState','downloadUpdate','installUpdate','openDataDirectory','preferences','savePreferences','reorder','searchMessages','messageInfo','setEphemeral','contacts','replyAs','sendSpecial','star','chatLabels','setLabel','groupMembers','statusList','statusItems','statusPost','statusMedia','openExternal','callStart','callAction','dictate','saveVoiceLanguage','listGroups','groupInfo','updateGroup','translate','translationSettings','saveTranslationSettings','state','select','add','open','openChat','searchPeople','searchFeed','filterUnread','photo','pair','more','moreFeed','reload','remove','send','sendFile','media','saveMedia','react','edit','removeMessage','typing','contactInfo','saveRemark','chatSetting','conversations','forward','createGroup','micAccess']) {
  desk[name] = (...args) => ipcRenderer.invoke('desk:' + name, ...args);
}
// A file picked or dropped by the user is sent by path, so its bytes never pass through the window.
// The path stays on this side of the bridge. Content without a path, such as a pasted picture, resolves to false.
desk.sendUpload = (account, chat, file, meta) => {
  let location = '';
  try { location = webUtils.getPathForFile(file); } catch { /* Not a file from disk. */ }
  return location ? ipcRenderer.invoke('desk:sendPath', account, chat, location, meta).then(() => true) : Promise.resolve(false);
};
desk.onUpdateProgress = callback => ipcRenderer.on('desk:update-progress',(_event,state)=>callback(state));
desk.onBackupStatus = callback => ipcRenderer.on('desk:backup-status',(_event,status)=>callback(status));
desk.onProgress = callback => ipcRenderer.on('desk:progress', (_event, progress) => callback(progress));
desk.onUpdate = callback => ipcRenderer.on('desk:update', (_event, state) => callback(state));
desk.onWarning = callback => ipcRenderer.on('desk:warning', (_event, message) => callback(message));
contextBridge.exposeInMainWorld('desk', desk);
