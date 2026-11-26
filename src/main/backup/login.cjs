const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {uuid}=require('./package.cjs');
const {version,writeArchive,readArchive}=require('./login-archive.cjs');
const {authSnapshot}=require('./snapshot-process.cjs');
const {stores}=require('./login-stores.cjs');
const {session:electronSession}=require('electron');
const {captureCookies,restoreCookies,validateCookies}=require('./login-cookies.cjs');
const partition=(root,id)=>path.join(root,'Partitions','wa-'+id);
async function exportLogins(desk,userData,ids,target,temp,progress) {
  const staging=path.join(temp,'login');await fs.mkdir(staging,{mode:0o700});
  const accounts=[];
  for(const [index,id] of ids.entries()){
    const session=desk.sessions.get(id),account=desk.accounts.items.find(a=>a.id===id);
    if(!session || !account || session.status!=='online')throw Error('所选账号已断开，请连接后再导出');
    progress('账号 '+(index+1)+' / '+ids.length+' · 正在整理登录资料…');
    session.close();
    try {
      await session.ses.flushStorageData();
      const cookies=await captureCookies(session.ses);
      await authSnapshot(session.ses.storagePath || partition(userData,id),path.join(staging,id),temp);
      await fs.writeFile(path.join(staging,id,'cookies.json'),JSON.stringify(cookies),{mode:0o600});
      accounts.push({id,name:account.name,phone:account.phone || ''});
    }finally{desk.attach(account);desk.publish();}
  }
  await fs.writeFile(path.join(staging,'manifest.json'),JSON.stringify({format:'login-3',id:crypto.randomUUID(),time:Date.now(),chrome:process.versions.chrome,accounts}),{mode:0o600});
  progress('正在保存账号文件…');await writeArchive(staging,target);
  return {accounts:accounts.length,size:(await fs.stat(target)).size};
}
async function importLogins(desk,userData,file,pass,temp,progress) {
  const staging=path.join(temp,'login'),manifest=await readArchive(file,staging,temp,pass),list=manifest?.accounts;
  if(!['login-1','login-2','login-3'].includes(manifest?.format) || !Array.isArray(list) || !list.length || list.length>50 ||
     !list.every(a=>typeof a.id==='string' && uuid.test(a.id) && typeof a.name==='string' && a.name.length<=48 && typeof a.phone==='string' && /^\d{0,20}$/.test(a.phone)) ||
     new Set(list.map(a=>a.id)).size!==list.length)throw Error('账号清单无效');
  // Validate every source before making any persistent change.
  const cookies=new Map();
  for(const a of list){
    for(const store of stores)if(!(await fs.stat(path.join(staging,a.id,store))).isDirectory())throw Error('文件缺少登录资料');
    const file=path.join(staging,a.id,'cookies.json');
    const data=await fs.readFile(file,'utf8').catch(error=>{if(error.code==='ENOENT'&&manifest.format!=='login-3')return '[]';throw error;});
    cookies.set(a.id,validateCookies(JSON.parse(data)));
  }
  const added=[],folders=[],results=[],transferId=manifest.id || 'legacy-'+manifest.time;
  try {
    for(const [index,item] of list.entries()){
      progress('账号 '+(index+1)+' / '+list.length+' · 正在恢复登录资料…');
      const matches=desk.accounts.items.filter(a=>a.id===item.id || a.transferSource===item.id || (item.phone && a.phone===item.phone));
      const same=matches.find(a=>desk.sessions.get(a.id)?.status==='online') || matches.find(a=>a.transferSource===item.id && a.transferId===transferId);
      if(same){results.push({name:same.name,account:same.id,skipped:true});continue;}
      const account={id:crypto.randomUUID(),name:item.name.trim() || '导入的账号',phone:item.phone,linked:true,transferSource:item.id,transferId};
      const dest=partition(userData,account.id);await fs.mkdir(dest,{recursive:true,mode:0o700});folders.push(dest);
      for(const store of stores)await fs.cp(path.join(staging,item.id,store),path.join(dest,store),{recursive:true});
      await restoreCookies(electronSession.fromPartition('persist:wa-'+account.id),cookies.get(item.id));
      added.push(account);results.push({name:account.name,account:account.id});
    }
    if(added.length)desk.accounts.save([...desk.accounts.items,...added]);
  }catch(error){for(const folder of folders)await fs.rm(folder,{recursive:true,force:true});throw error;}
  for(const account of added)desk.attach(account);
  if(results.length)desk.select(results[0].account);desk.publish();
  return results;
}
module.exports={exportLogins,importLogins,isLoginFile:async file=>(await version(file))>0};
