const { dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const inline = /^(image\/(jpeg|png|webp|gif)|video\/(mp4|webm|3gpp|quicktime)|audio\/[\w.+-]+)$/;
const extensions = {'image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp','image/gif':'.gif','video/mp4':'.mp4','audio/ogg':'.ogg','audio/mpeg':'.mp3','audio/mp4':'.m4a','application/pdf':'.pdf'};

async function download(session, message) {
  if (!message?.media || message.media.once) throw new Error('这条消息没有可下载的文件');
  const owner = session.identity;
  const result = await session.call('media', message.id);
  const mark = typeof result?.data === 'string' ? result.data.indexOf(';base64,') : -1;
  if (mark < 0 || result.data.length > 90000000 || session.disposed || session.identity !== owner) throw new Error('文件下载失败，请重试');
  const mime = String(result.mime || message.media.mime).split(';')[0].trim().toLowerCase();
  return {mime, base64:result.data.slice(mark + 8), name:result.name || message.media.name};
}
// Only pictures, audio and video are handed to the window. Other files go straight to disk.
async function view(session, message) {
  const file = await download(session, message);
  if (!inline.test(file.mime)) throw new Error('此文件无法预览，请保存后查看');
  return 'data:' + file.mime + ';base64,' + file.base64;
}
async function save(win, session, message) {
  const file = await download(session, message);
  const stamp = new Date(message.time).toISOString().slice(0,19).replace(/[T:]/g,'-');
  const fallback = 'WhatsApp-' + stamp + (extensions[file.mime] || '');
  const name = path.basename(String(file.name || '')).replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').slice(0,120) || fallback;
  const choice = await dialog.showSaveDialog(win,{defaultPath:name});
  if (choice.canceled || !choice.filePath) return false;
  await fs.promises.writeFile(choice.filePath, Buffer.from(file.base64,'base64'));
  return true;
}
module.exports = { view, save };
