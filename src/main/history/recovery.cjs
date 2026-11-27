const fs = require('node:fs/promises');
const path = require('node:path');
const { BrowserWindow } = require('electron');
const { Inbox } = require('../inbox.cjs');
const { readJson,uuid } = require('../backup/package.cjs');
const { checkManifest } = require('../backup/records.cjs');
const { chatPages } = require('../backup/chat-pages.cjs');
const { readLegacyPage } = require('./legacy-page.cjs');

function importRows(store,accountId,rows,source) {
  const normal = new Inbox();
  const added = normal.add(accountId,rows);
  const originals=new Map(rows.map(row=>[row.id,row]));
  store.transaction(()=>{
    for (const {message} of added) {
      const original = originals.get(message.id);
      if (original?.reactions) normal.patch(accountId,message.id,{reactions:original.reactions});
      if (source==='browser') message.legacyProjection = true;
      store.save(message,false,{browser:'legacy-local',backup:'backup-import',linked:'web-history'}[source]);
    }
  });
}

async function readBrowser(session,store,valid) {
  const w = new BrowserWindow({show:false,webPreferences:{session:session.ses,sandbox:true,nodeIntegration:false,contextIsolation:true}});
  const id = session.account.id, names = new Map(), unread = [];
  const reader = '('+readLegacyPage.toString()+')';
  try {
    await w.loadURL('data:text/html,<html></html>',{baseURLForDataURL:'https://web.whatsapp.com/'});
    for (const name of ['contact','chat','message']) {
      let next = null;
      do {
        if (!valid()) return;
        const page = await w.webContents.executeJavaScript(reader+'('+JSON.stringify(name)+','+JSON.stringify(next)+')');
        if (!valid()) return;
        if (name==='contact') for (const row of page.rows) names.set(row.chat,row.title);
        if (name==='chat') {
          for (const row of page.rows) {
            row.title ||= names.get(row.chat) || row.chat.split('@')[0];
            names.set(row.chat,row.title);
            if (row.unread) unread.push([row.chat,row.unread]);
          }
          store.transaction(()=>store.directory(page.rows,true));
        }
        if (name==='message') importRows(store,id,page.rows.map(row=>({...row,title:names.get(row.chat)||row.chat.split('@')[0]})),'browser');
        next = page.next;
      } while (next!=null);
    }
    if (!store.get('unread')) store.set('unread',JSON.stringify(unread));
  } finally { w.destroy(); }
}
async function readBackups(root,account,store,valid,selected) {
  const folder = path.join(root,'account-backups',account.id);
  const keys = await fs.readdir(folder).catch(error=>{if(error.code==='ENOENT') return []; throw error;});
  const versions = [];
  for (const key of keys.filter(k=>uuid.test(k))) {
    if ((selected && key!==selected) || store.get('backup:'+key)) continue;
    const dir = path.join(folder,key);
    const meta = checkManifest(await readJson(dir,'manifest.json'));
    if (meta.id===key && (!account.phone || !meta.phone || account.phone===meta.phone)) versions.push({meta,dir});
  }
  for (const {meta,dir} of versions.sort((a,b)=>b.meta.time-a.meta.time)) {
    if (!valid()) return;
    for (const chat of meta.chats) {
      store.directory([chat],true);
      for await (const page of chatPages(dir,chat)) {
        if (!valid()) return;
        importRows(store,account.id,page,'backup');
        for (const row of page) if (row.attachment) await require('./attachments.cjs').importAttachment(store,dir,row);
      }
    }
    if (!store.get('unread')) store.set('unread',JSON.stringify(meta.chats.filter(c=>c.unread).map(c=>[c.chat,c.unread])));
    store.set('backup:'+meta.id,'1');
  }
}
async function recover(desk,root,session,store) {
  const account = session.account, valid = ()=>!session.disposed && desk.inbox.stores.get(account.id)===store;
  let incomplete=false;
  try {await readBackups(root,account,store,valid);} catch {incomplete=true;}
  if (!valid()) return;
  try {
    const indexed=path.join(session.ses.storagePath,'IndexedDB');
    if (store.get('legacy')!=='1' && await fs.stat(indexed).then(s=>s.isDirectory(),e=>{if(e.code==='ENOENT')return false;throw e;}))
      await readBrowser(session,store,valid);
  } catch {incomplete=true;}
  if (!valid()) return;
  const count = store.restore(desk.inbox,account.id);
  if (count && !account.linked && !account.archiveSource) desk.accounts.update(account.id,{linked:true});
  if (!incomplete) store.set('legacy','1');
  desk.publish();
  if (incomplete) throw Error('部分旧记录未能回溯');
}
async function importArchive(desk,root,result) {
  const session=desk.sessions.get(result.account);
  if (!session || session.preparing) return session?.preparing;
  const store=session.historyStore,valid=()=>!session.disposed && session.historyStore===store;
  await readBackups(root,session.account,store,valid,result.key);
  if (valid()) {store.restore(desk.inbox,session.account.id);desk.publish();}
}
module.exports = { recover,importRows,importArchive };
