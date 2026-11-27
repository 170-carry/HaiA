const fs = require('node:fs/promises');
const path = require('node:path');
const {readSelection,restoreSelection}=require('./collection.cjs');
const {dialog} = require('electron');
const {uuid,unpack,readJson} = require('./package.cjs');
const {assetFile,chatId} = require('./records.cjs');

const {historyPage,chatPages}=require('./chat-pages.cjs');
const {exportLogins,importLogins,isLoginFile}=require('./login.cjs');

const {version}=require('./login-archive.cjs');

function backupRoutes(desk,dir) {
  const root=path.join(dir,'account-backups'), win=desk.win, filters=[{name:'HaiA 账号备份',extensions:['haia']}];
  const account=id=>desk.accounts.items.find(a=>a.id===id);
  function folder(id,key) {
    if(!uuid.test(id)||!uuid.test(key)||!account(id)) throw new Error('请选择已导入的账号备份');
    return path.join(root,id,key);
  }
  async function versions(id) {
    if(!uuid.test(id)||!account(id)) return [];
    const keys=await fs.readdir(path.join(root,id)).catch(e=>{if(e.code==='ENOENT') return [];throw e});
    const all=await Promise.all(keys.filter(k=>uuid.test(k)).map(async k=>({folder:folder(id,k),meta:await readJson(folder(id,k),'manifest.json')})));
    return all.sort((a,b)=>b.meta.time-a.meta.time);
  }
  async function conversation(dir,chat) {
    const manifest=await readJson(dir,'manifest.json');
    const summary=manifest.chats.find(item=>item.chat===chat);
    if(!summary) throw new Error('这份备份中没有该会话');
    return summary;
  }
  let busy=false,pendingFile=null;
  async function operation(action) {
    if(busy) throw new Error('另一个备份操作正在进行');
    busy=true; let temp;
    try {
      await fs.mkdir(root,{recursive:true,mode:0o700});
      // A prior process may have exited before removing its temporary plaintext staging area.
      for(const name of await fs.readdir(root)) {
        if(/^\.work-[a-zA-Z0-9]{6}$/.test(name)) await fs.rm(path.join(root,name),{recursive:true,force:true});
      }
      temp=await fs.mkdtemp(path.join(root,'.work-'));
      const staging=path.join(temp,'records');
      await fs.mkdir(staging,{mode:0o700});
      return await action(temp,staging);
    } finally {try { if(temp) await fs.rm(temp,{recursive:true,force:true}); } finally {busy=false;} }
  }
  const progress=status=>{if(!win.isDestroyed()) win.webContents.send('desk:backup-status',status)};
  return {
    remove:async id=>{
      if (!uuid.test(id) || !account(id)) return;
      if (busy) throw new Error('请等待当前账号操作完成');
      busy=true;
      try {
        await desk.remove(id);
        await fs.rm(path.join(root,id),{recursive:true,force:true});
      } finally { busy=false; }
    },
    // Only what keeps the account linked is exported; the other computer then shows the same conversations without re-linking.
    backupExport:ids=>operation(async temp=>{
      if(!Array.isArray(ids) || !ids.length || ids.length>50 || new Set(ids).size!==ids.length ||
         !ids.every(id=>uuid.test(id) && desk.sessions.has(id))) throw Error('请勾选要导出的账号');
      const label=ids.length===1?account(ids[0]).name:ids.length+'个账号';
      const choice=await dialog.showSaveDialog(win,{filters,defaultPath:'HaiA-'+label.replace(/[\\/:*?"<>|]/g,'_')+'.haia'});
      if(choice.canceled) return null;
      return exportLogins(desk,dir,ids,choice.filePath,temp,progress);
    }),
    backupImport:pass=>operation(async(temp,staging)=>{
      if(pass===undefined || !pendingFile){
        const choice=await dialog.showOpenDialog(win,{filters,properties:['openFile']});
        if(choice.canceled) {pendingFile=null;return null;}
        pendingFile=choice.filePaths[0];
      }
      const kind=await version(pendingFile);
      if(kind!==2 && !pass)return {needsPassword:true};
      if(await isLoginFile(pendingFile)){
        const result={login:await importLogins(desk,dir,pendingFile,pass,temp,progress)};
        pendingFile=null;return result;
      }
      progress('正在校验并恢复备份…');
      await unpack(pendingFile,staging,path.join(temp,'payload.tar'),pass);
      const result=await restoreSelection(desk,root,await readSelection(temp,staging));
      for (const archive of result) await require('../history/recovery.cjs').importArchive(desk,dir,archive);
      pendingFile=null;return result;
    }),
    backupList:async id=>(await versions(id)).map(({meta:m})=>({key:m.id,time:m.time,name:m.name,phone:m.phone,chats:m.chats,missing:m.missingAttachments,pending:m.missingBodies})),
    backupPage:async(id,key,chat,offset=0)=>{
      if(!chatId(chat)||!Number.isSafeInteger(offset)||offset<0) throw new Error('无效的会话页');
      const dir=folder(id,key);
      const rows=await historyPage(dir,await conversation(dir,chat),offset);
      return rows.map(r=>({
        text:r.text,time:r.time,sender:r.outgoing?'我':r.sender || r.title,attachment:r.attachment || null,name:r.media?.name || r.media?.kind || ''}));
    },
    backupSaveFile:async(id,key,chat,file)=>{
      if(!chatId(chat)||!/^file-[a-f0-9]{64}$/.test(file)) throw new Error('无效附件');
      const dir=folder(id,key), summary=await conversation(dir,chat);
      let r;
      for await(const page of chatPages(dir,summary)) {
        r=page.find(row=>row.attachment===file && assetFile(chat,row.id)===file);
        if(r) break;
      }
      if(!r) throw new Error('这份备份中没有该附件');
      const choice=await dialog.showSaveDialog(win,{defaultPath:path.basename(r.media?.name || '附件').replace(/[\\/:*?"<>|]/g,'_')});
      if(!choice.canceled) await fs.copyFile(path.join(dir,file),choice.filePath);
    }
  };
}
module.exports={backupRoutes};
