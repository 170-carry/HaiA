const { app, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Readable } = require('node:stream');

// Files move between the WhatsApp page and disk in small pieces, so nothing larger than one piece is ever held
// as a string. The window then reads a downloaded file through the haia-media: protocol.
const PIECE = 3 * 1048576, CACHE_LIMIT = 600 * 1048576, FILE_LIMIT = 200 * 1048576;
const inline = /^(image\/(jpeg|png|webp|gif)|video\/(mp4|webm|3gpp|quicktime)|audio\/[\w.+-]+)$/;
const extensions = {'image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp','image/gif':'.gif','video/mp4':'.mp4','audio/ogg':'.ogg','audio/mpeg':'.mp3','audio/mp4':'.m4a','application/pdf':'.pdf'};
const types = {jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif',mp4:'video/mp4',mov:'video/quicktime',webm:'video/webm',
  mp3:'audio/mpeg',ogg:'audio/ogg',m4a:'audio/mp4',wav:'audio/wav',pdf:'application/pdf',txt:'text/plain',csv:'text/csv',zip:'application/zip',
  doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls:'application/vnd.ms-excel',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt:'application/vnd.ms-powerpoint',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation'};
const files = new Map(), pending = new Map();
let folder;

// Each running copy of the app keeps its own folder, named after its process, so that a second copy (or a test run)
// cannot empty the folder this one is serving pictures from.
function directory() {
  if (!folder) {
    const base = app.getPath('temp');
    folder = path.join(base,'haia-media-' + process.pid);
    for (const name of fs.readdirSync(base)) {
      const owner = /^haia-media-(\d+)$/.exec(name);
      if (!owner || name === path.basename(folder)) continue;
      // Left behind by a copy that is no longer running. The folder without a number belongs to older versions and is left alone.
      let alive = true;
      try { process.kill(Number(owner[1]),0); } catch (error) { alive = error.code === 'EPERM'; }
      if (!alive) fs.rmSync(path.join(base,name),{recursive:true,force:true});
    }
    fs.rmSync(folder,{recursive:true,force:true});
    app.once('quit',() => fs.rmSync(folder,{recursive:true,force:true}));
  }
  // The system may clear temporary files while the app is running.
  fs.mkdirSync(folder,{recursive:true});
  return folder;
}
// Oldest downloads are removed first once the cache is over its limit.
function evict() {
  let total = [...files.values()].reduce((sum,file)=>sum+file.size,0);
  for (const [key,file] of files) {
    if (total <= CACHE_LIMIT || files.size <= 1) break;
    files.delete(key); total -= file.size;
    fs.promises.rm(file.path,{force:true}).catch(() => {});
  }
}
async function fetchToDisk(session, message) {
  if (!message?.media || message.media.once) throw new Error('这条消息没有可下载的文件');
  const owner = session.identity;
  const opened = await session.call('mediaOpen', message.id);
  if (typeof opened?.token !== 'string' || !Number.isFinite(opened.size)) throw new Error('文件下载失败，请重试');
  const token = randomUUID(), target = path.join(directory(),token);
  try {
    if (opened.size > FILE_LIMIT) throw new Error('文件超过 200 MB，请在手机上查看');
    const handle = await fs.promises.open(target,'w');
    try {
      for (let offset = 0; offset < opened.size; offset += PIECE) {
        const piece = await session.call('mediaPiece', opened.token, offset, PIECE);
        if (typeof piece !== 'string' || session.disposed || session.identity !== owner) throw new Error('文件下载失败，请重试');
        const bytes = Buffer.from(piece,'base64');
        if (bytes.length !== Math.min(PIECE,opened.size-offset)) throw new Error('收到的文件不完整，请重试');
        await handle.writeFile(bytes);
      }
    } finally { await handle.close(); }
  } catch (error) {
    await fs.promises.rm(target,{force:true}).catch(() => {});
    throw error;
  } finally { void session.call('mediaClose', opened.token).catch(() => {}); }
  const mime = String(opened.mime || message.media.mime || '').split(';')[0].trim().toLowerCase();
  return {token, path:target, size:opened.size, mime, name:opened.name || message.media.name || ''};
}
// Concurrent requests for the same message share one download.
function download(session, message) {
  const key = JSON.stringify([session.account.id,session.identity,message.id]), ready = files.get(key);
  // A file that has since been removed from disk is fetched again instead of being served as a broken picture.
  if (ready && fs.existsSync(ready.path)) { files.delete(key); files.set(key,ready); return Promise.resolve(ready); }
  if (ready) files.delete(key);
  if (!pending.has(key)) {
    pending.set(key, fetchToDisk(session,message).then(file => { files.set(key,file); evict(); return file; }).finally(() => pending.delete(key)));
  }
  return pending.get(key);
}
// Only pictures, audio and video are shown in the window. Other files go straight to disk.
async function view(session, message) {
  const file = await download(session, message);
  if (!inline.test(file.mime)) throw new Error('此文件无法预览，请保存后查看');
  return 'haia-media://file/' + file.token;
}
async function save(win, session, message) {
  const file = await download(session, message);
  const stamp = new Date(message.time).toISOString().slice(0,19).replace(/[T:]/g,'-');
  const fallback = 'WhatsApp-' + stamp + (extensions[file.mime] || '');
  const name = path.basename(String(file.name || '')).replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').slice(0,120) || fallback;
  const choice = await dialog.showSaveDialog(win,{defaultPath:name});
  if (choice.canceled || !choice.filePath) return false;
  await fs.promises.copyFile(file.path, choice.filePath);
  return true;
}
// Serves a downloaded file to the window, with byte ranges so that video can seek.
async function serve(request) {
  const token = new URL(request.url).pathname.slice(1);
  const file = [...files.values()].find(item => item.token === token);
  if (!file) return new Response('',{status:404});
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') || '');
  let start = 0, end = file.size - 1;
  if (range) {
    if (range[1]) { start = Number(range[1]); if (range[2]) end = Math.min(end,Number(range[2])); }
    else if (range[2]) start = Math.max(0,file.size - Number(range[2]));
    if (start > end) return new Response('',{status:416,headers:{'Content-Range':'bytes */' + file.size}});
  }
  const headers = {'Content-Type':file.mime,'Content-Length':String(end - start + 1),'Accept-Ranges':'bytes','Cache-Control':'no-store',
    ...(range ? {'Content-Range':'bytes ' + start + '-' + end + '/' + file.size} : {})};
  const body = file.size ? Readable.toWeb(fs.createReadStream(file.path,{start,end})) : null;
  return new Response(body,{status:range ? 206 : 200,headers});
}
// Sends a file from disk to a chat by feeding it to the page piece by piece.
async function upload(session, chat, filePath, meta, progress = () => {}) {
  const stat = await fs.promises.stat(filePath).catch(() => null);
  if (!stat?.isFile() || !stat.size) throw new Error('无法读取这个文件');
  if (stat.size > FILE_LIMIT) throw new Error('单个文件不能超过 200 MB');
  const name = path.basename(meta.name || filePath).replace(/[\\/:*?"<>|]/g,'_').slice(0,200);
  const mime = meta.mime || types[path.extname(name).slice(1).toLowerCase()] || 'application/octet-stream';
  const identity = session.identity;
  const handle = await fs.promises.open(filePath,'r');
  let token;
  function checkAccount() {
    if (session.disposed || session.status !== 'online' || session.identity !== identity) throw new Error('账号连接已变更，文件发送已停止');
  }
  try {
    checkAccount();
    token = await session.call('uploadOpen');
    const buffer = Buffer.alloc(Math.min(PIECE,stat.size));
    for (let offset = 0; offset < stat.size;) {
      const {bytesRead} = await handle.read(buffer,0,buffer.length,offset);
      if (!bytesRead) throw new Error('无法读取这个文件');
      checkAccount();
      await session.call('uploadPiece', token, buffer.subarray(0,bytesRead).toString('base64'));
      offset += bytesRead;
      progress(name, offset, stat.size);
    }
    checkAccount();
    return await session.call('uploadSend', chat, token, {name, mime, kind:meta.kind, caption:meta.caption, quote:meta.quote, mentions:meta.mentions});
  } catch (error) {
    if (token && session.identity === identity) void session.call('uploadClose', token).catch(() => {});
    throw error;
  } finally { await handle.close(); }
}
module.exports = { download, view, save, serve, upload };
