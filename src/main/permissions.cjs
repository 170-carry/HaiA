const { dialog, shell, systemPreferences } = require('electron');

const names = {microphone:'麦克风', camera:'摄像头'};
const panes = {
  darwin:{microphone:'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone', camera:'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera'},
  win32:{microphone:'ms-settings:privacy-microphone', camera:'ms-settings:privacy-webcam'}
};
// Asks the system for access the first time. Once access was refused, the system no longer asks,
// so the user is offered a direct jump to the matching privacy page instead.
async function mediaAccess(win, kind) {
  if (!panes[process.platform]) return true;
  const status = systemPreferences.getMediaAccessStatus(kind);
  if (status === 'granted') return true;
  if (process.platform === 'darwin' && status === 'not-determined' && await systemPreferences.askForMediaAccess(kind)) return true;
  if (process.platform === 'win32' && status !== 'denied') return true;
  const choice = await dialog.showMessageBox(win,{type:'warning', buttons:['打开系统设置','取消'], defaultId:0, cancelId:1,
    message:'需要' + names[kind] + '权限', detail:'请在系统设置的「隐私与安全性 → ' + names[kind] + '」中允许本应用，然后回到这里重试。部分系统需要重启应用后生效。'});
  if (choice.response === 0) await shell.openExternal(panes[process.platform][kind]);
  return false;
}
module.exports = { mediaAccess };
