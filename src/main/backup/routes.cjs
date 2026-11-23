const fs = require('node:fs/promises');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {dialog} = require('electron');
const media = require('../media.cjs');
const {uuid,password,pack,unpack,readJson} = require('./package.cjs');
const {capture,validate,assetFile,chatId} = require('./records.cjs');

const {historyPage,chatPages}=require('./chat-pages.cjs');

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
  let busy=false;
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
    backupExport:(id,pass,drafts=[])=>operation(async(_,staging)=>{
      password(pass);
      const session=desk.sessions.get(id);
      if(!session) throw new Error('请选择要导出的账号');
      const choice=await dialog.showSaveDialog(win,{filters,defaultPath:'HaiA-'+session.account.name.replace(/[\\/:*?"<>|]/g,'_')+'.haia'});
      if(choice.canceled) return null;
      const m=await capture(desk,session,staging,drafts,progress,media.download,(await versions(id))[0]);
      progress('正在加密备份…'); await pack(staging,choice.filePath,pass);
      return {chats:m.chats.length,messages:m.chats.reduce((n,c)=>n+c.count,0),missing:m.missingAttachments,pending:m.missingBodies,online:m.online};
    }),
    backupImport:pass=>operation(async(temp,staging)=>{
      password(pass);
      const choice=await dialog.showOpenDialog(win,{filters,properties:['openFile']});
      if(choice.canceled) return null;
      progress('正在校验并恢复备份…');
      await unpack(choice.filePaths[0],staging,path.join(temp,'payload.tar'),pass);
      const m=await validate(staging);
      let owner=desk.accounts.items.find(a=> (a.id===m.source || a.archiveSource===m.source) && (!a.phone || a.phone===m.phone));
      if(!owner && m.phone) owner=desk.accounts.items.find(a=>a.phone===m.phone);
      const fresh=!owner;
      if(fresh) owner={id:randomUUID(),name:m.name,phone:m.phone,archiveSource:m.source};
      const parent=path.join(root,owner.id), dest=path.join(parent,m.id);
      await fs.mkdir(parent,{recursive:true,mode:0o700});
      const same=await fs.stat(dest).catch(e=>{if(e.code==='ENOENT')return null;throw e});
      if(!same) await fs.rename(staging,dest);
      if(fresh) {
        try { desk.accounts.save([...desk.accounts.items,owner]); }
        catch(e){await fs.rm(dest,{recursive:true,force:true});throw e;}
        desk.attach(owner);
      }
      desk.select(owner.id); desk.publish();
      return {account:owner.id,key:m.id,name:owner.name,drafts:m.drafts,already:!!same};
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
