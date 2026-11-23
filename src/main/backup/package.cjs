// Portable account backups contain a tar of application records and attachments.
// Authenticate the complete file before parsing any archive entries.
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');
const {promisify} = require('node:util');
const {pipeline} = require('node:stream/promises');
const tar = require('tar');

const MAGIC = Buffer.from('HaiA-backup-v1\n');
const HEADER = MAGIC.length + 16 + 12;
const TAG = 16;
const namePattern = /^(?:manifest\.json|chat-[a-f0-9]{64}\.json|file-[a-f0-9]{64})$/;
const uuid = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function password(value) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 256) throw new Error('请输入 8 至 256 个字符的备份密码');
}
async function key(pass,header) {
  password(pass);
  return promisify(crypto.scrypt)(pass,header.subarray(MAGIC.length,MAGIC.length+16),32,{N:32768,maxmem:64*1024*1024});
}
async function pack(folder,target,pass) {
  const header = Buffer.concat([MAGIC,crypto.randomBytes(16),crypto.randomBytes(12)]);
  const cipher = crypto.createCipheriv('aes-256-gcm',await key(pass,header),header.subarray(-12));
  cipher.setAAD(header);
  const temp = path.join(path.dirname(target),'.haia-'+crypto.randomUUID()+'.tmp');
  const file = await fsp.open(temp,'wx',0o600);
  try {
    await file.writeFile(header);
    await pipeline(tar.c({cwd:folder,portable:true},await fsp.readdir(folder)),cipher,fs.createWriteStream(temp,{flags:'r+',start:HEADER}));
    await fsp.appendFile(temp,cipher.getAuthTag());
    await file.sync(); await file.close();
    await fsp.rename(temp,target);
  } finally { await file.close(); await fsp.rm(temp,{force:true}); }
}
async function unpack(input,folder,temp,pass) {
  const file = await fsp.open(input,'r');
  try {
    const {size} = await file.stat(), header = Buffer.alloc(HEADER), tag = Buffer.alloc(TAG);
    if (size <= HEADER+TAG || (await file.read(header,0,HEADER,0)).bytesRead !== HEADER || !header.subarray(0,MAGIC.length).equals(MAGIC)) throw new Error('请选择 HaiA 导出的账号备份');
    await file.read(tag,0,TAG,size-TAG);
    const decipher = crypto.createDecipheriv('aes-256-gcm',await key(pass,header),header.subarray(-12));
    decipher.setAAD(header); decipher.setAuthTag(tag);
    try {
      await pipeline(fs.createReadStream(input,{fd:file.fd,start:HEADER,end:size-TAG-1,autoClose:false}),decipher,fs.createWriteStream(temp,{flags:'wx',mode:0o600}));
    } catch (e) { if (e.code) throw e; throw new Error('无法解开备份，请检查密码和文件完整性'); }
  } finally { await file.close(); }
  const payload = await fsp.open(temp,'r');
  try {
    const format = Buffer.alloc(5);
    await payload.read(format,0,5,257);
    if (format.toString() !== 'ustar') throw new Error('备份文件格式无效');
  } finally { await payload.close(); }
  let invalid = false;
  const names = new Set();
  await tar.t({file:temp,strict:true,onReadEntry:entry=>{
    if (entry.type !== 'File' || !namePattern.test(entry.path) || names.has(entry.path) ||
        names.size >= 1000000 || (entry.path.endsWith('.json') && entry.size > 64*1024*1024)) invalid = true;
    if (!invalid) names.add(entry.path);
  }});
  if (invalid || !names.has('manifest.json')) throw new Error('备份目录无效或数据超出支持范围');
  await tar.x({file:temp,cwd:folder,strict:true,preserveOwner:false,noChmod:true,filter:(name,entry)=>entry.type==='File' && names.has(name)});
}
async function writeJson(folder,name,data) {
  const json = JSON.stringify(data);
  if (Buffer.byteLength(json)>64*1024*1024) throw new Error('单个会话的消息记录超过 64 MB，已取消导出');
  await fsp.writeFile(path.join(folder,name),json,{mode:0o600});
}
const readJson = async (folder,name) => JSON.parse(await fsp.readFile(path.join(folder,name),'utf8'));
module.exports = {pack,unpack,hash,uuid,password,writeJson,readJson};
