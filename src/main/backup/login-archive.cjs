const fs=require('node:fs');
const fsp=fs.promises;
const crypto=require('node:crypto');
const {pipeline}=require('node:stream/promises');
const {promisify}=require('node:util');
const tar=require('tar');
const path=require('node:path');
const {password}=require('./package.cjs');
const legacy=Buffer.from('HaiA-login-v1\n'), magic=Buffer.from('HaiA-login-v2\n');
const entryName=/^(manifest\.json|[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}(\/|\/(IndexedDB|Local Storage)(\/[\w .@()+=,~-]+)*\/?))$/i;
async function version(file) {
  const handle=await fsp.open(file,'r');
  try {const head=Buffer.alloc(magic.length);await handle.read(head,0,head.length,0);return head.equals(magic)?2:head.equals(legacy)?1:0;}
  finally {await handle.close();}
}
async function digest(file,start=0) {
  const hash=crypto.createHash('sha256');
  for await(const bytes of fs.createReadStream(file,{start}))hash.update(bytes);
  return hash.digest();
}
async function writeArchive(folder,target) {
  const temp=path.join(path.dirname(target),'.haia-'+crypto.randomUUID()+'.tmp');
  try {
    await fsp.writeFile(temp,Buffer.concat([magic,Buffer.alloc(32)]),{flag:'wx',mode:0o600});
    await pipeline(tar.c({cwd:folder,portable:true,gzip:true},await fsp.readdir(folder)),fs.createWriteStream(temp,{flags:'r+',start:magic.length+32}));
    const hash=await digest(temp,magic.length+32);
    const handle=await fsp.open(temp,'r+');
    try {await handle.write(hash,0,32,magic.length);await handle.sync();}finally{await handle.close();}
    await fsp.rename(temp,target);
  }finally{await fsp.rm(temp,{force:true});}
}
async function readArchive(file,folder,temp,pass) {
  const kind=await version(file),handle=await fsp.open(file,'r'),payload=path.join(temp,'payload.tgz');
  try {
    const {size}=await handle.stat();
    if(size>2*1024**3)throw Error('账号文件超过支持范围');
    if(kind===2){
      const hash=Buffer.alloc(32);await handle.read(hash,0,32,magic.length);
      if(!hash.equals(await digest(file,magic.length+32)))throw Error('账号文件损坏，请重新导出或传输');
      await pipeline(fs.createReadStream(file,{start:magic.length+32}),fs.createWriteStream(payload,{flags:'wx',mode:0o600}));
    }else if(kind===1){
      password(pass);
      const head=Buffer.alloc(legacy.length+28),tag=Buffer.alloc(16);
      if(size<=head.length+16)throw Error('账号文件不完整');
      await handle.read(head,0,head.length,0);await handle.read(tag,0,16,size-16);
      const key=await promisify(crypto.scrypt)(pass,head.subarray(legacy.length,legacy.length+16),32,{N:32768,maxmem:64*1024*1024});
      const decipher=crypto.createDecipheriv('aes-256-gcm',key,head.subarray(-12));
      decipher.setAAD(head);decipher.setAuthTag(tag);
      try {await pipeline(fs.createReadStream(file,{start:head.length,end:size-17}),decipher,fs.createWriteStream(payload,{flags:'wx',mode:0o600}));}
      catch(error){if(error.code)throw error;throw Error('旧文件密码不正确或文件损坏');}
    }else throw Error('无法识别这个账号文件');
  }finally{await handle.close();}
  const entries=new Set();let invalid=false,expanded=0;
  await tar.t({file:payload,strict:true,onReadEntry:entry=>{
    expanded+=entry.size;
    if(!['File','Directory'].includes(entry.type) || !entryName.test(entry.path) || entry.path.split('/').includes('..') ||
       entries.has(entry.path) || entries.size>100000 || expanded>2*1024**3)invalid=true;
    entries.add(entry.path);
  }});
  if(invalid || !entries.has('manifest.json'))throw Error('文件内容无效，已取消导入');
  await fsp.mkdir(folder,{mode:0o700});
  await tar.x({file:payload,cwd:folder,strict:true,preserveOwner:false,noChmod:true});
  return JSON.parse(await fsp.readFile(path.join(folder,'manifest.json'),'utf8'));
}
module.exports={version,writeArchive,readArchive};
