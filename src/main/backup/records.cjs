const fs = require('node:fs/promises');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {hash,uuid,readJson,writeJson} = require('./package.cjs');

const {chatFile,chatPages,writeChat}=require('./chat-pages.cjs');
const assetFile = (chat,id) => 'file-'+hash(JSON.stringify([chat,id]));
const chatId = id => typeof id==='string' && id.length<=256 && /^[\w.:-]+@(?:c\.us|s\.whatsapp\.net|lid|g\.us)$/.test(id);
function validDraft(draft) {
  if (!Array.isArray(draft) || !chatId(draft[0]) || typeof draft[1]!=='string' || draft[1].length>4000) return false;
  const spans=draft[2];
  return spans===undefined || (Array.isArray(spans) && spans.every(span=>
    span && chatId(span.id) && Number.isInteger(span.start) && span.start>=0 &&
    typeof span.label==='string' && span.label.startsWith('@') && draft[1].startsWith(span.label,span.start)));
}
function checkManifest(m) {
  if (m?.format!==1 || !uuid.test(m.id) || !uuid.test(m.source) || typeof m.name!=='string' || !m.name.trim() ||
      m.name.length>48 || typeof m.phone!=='string' || !/^\d{0,20}$/.test(m.phone) || !Number.isSafeInteger(m.time) ||
      !Array.isArray(m.chats) || !Array.isArray(m.drafts) || !m.drafts.every(validDraft) ||
      !m.chats.every(c=>chatId(c.chat)&&typeof c.title==='string'&&Number.isSafeInteger(c.count)&&c.count>=0) ||
      new Set(m.chats.map(c=>c.chat)).size!==m.chats.length) throw new Error('账号备份格式无效');
  return m;
}
async function validate(folder) {
  const m=checkManifest(await readJson(folder,'manifest.json'));
  for (const c of m.chats) {
    for await (const rows of chatPages(folder,c)) for (const row of rows) {
      if (row?.chat!==c.chat || typeof row.id!=='string' || typeof row.text!=='string' || !Number.isFinite(row.time)) throw new Error('备份中的消息无效');
      if (row.attachment && (row.attachment!==assetFile(row.chat,row.id) || !(await fs.stat(path.join(folder,row.attachment))).isFile())) throw new Error('备份中的附件无效');
    }
  }
  return m;
}
async function capture(desk,session,folder,drafts,progress,download,previous) {
  const account=session.account, identity=session.identity, online=session.status==='online';
  function check() {
    if (session.disposed || desk.sessions.get(account.id)!==session || session.identity!==identity || (online && session.status!=='online')) throw new Error('账号连接发生变化，请重新导出');
  }
  const phone=/^(\d+)(?::\d+)?@(?:c\.us|s\.whatsapp\.net)$/.exec(identity || '')?.[1] || account.phone || '';
  const m={format:1,id:randomUUID(),source:account.archiveSource || account.id,name:account.name,phone,time:Date.now(),chats:[],drafts,
    missingAttachments:0,missingBodies:0,online};
  const chats=new Map();
  const existing=previous && (!phone || previous.meta.phone===phone) ? previous : null;
  for(const c of existing?.meta.chats || []) chats.set(c.chat,c);
  const directory=desk.inbox.conversations;
  for(const row of directory.directory.get(account.id)?.values() || []) if(chatId(row.chat)) chats.set(row.chat,{...row,...directory.flagsOf(row),unread:directory.unread.get(account.id)?.get(row.chat)||0});
  if (online) for (const c of await session.call('backupChats')) if(chatId(c.chat)) chats.set(c.chat,{...chats.get(c.chat),...c});
  const cached=new Map();
  for(const row of desk.inbox.byAccount.get(account.id)?.values() || []) {
    if(!chatId(row.chat)) continue;
    if(!chats.has(row.chat)) chats.set(row.chat,{chat:row.chat,title:row.title});
    if(!cached.has(row.chat)) cached.set(row.chat,[]);
    cached.get(row.chat).push(row);
  }
  const prior=new Map(existing?.meta.chats.map(c=>[c.chat,c]));
  for(const c of chats.values()) {
    check(); progress('正在导出会话 '+(m.chats.length+1)+' / '+chats.size);
    const rows=new Map();
    if(prior.has(c.chat)) for await(const page of chatPages(existing.folder,prior.get(c.chat))) for(const r of page) rows.set(r.id,r);
    for(const r of cached.get(c.chat) || []) {
      const saved=rows.get(r.id);
      if(!r.pendingText || !saved) rows.set(r.id,{...saved,...r});
    }
    if(online) {
      const seen=new Set(); let cursor=null;
      do {
        check();
        const page=await session.call('backupMessages',c.chat,cursor);
        for(const r of page.rows) {
          const saved=rows.get(r.id);
          if(!r.pendingText || !saved) rows.set(r.id,{...saved,...r});
        }
        cursor=page.next;
        if(cursor && seen.has(cursor)) throw new Error('读取较早消息时游标未前进，请重试');
        if(cursor) seen.add(cursor);
      } while(cursor);
    }
    for(const r of rows.values()) {
      check();
      if(r.pendingText) { m.missingBodies++; continue; }
      const file=assetFile(c.chat,r.id), target=path.join(folder,file);
      const had=r.attachment===file; delete r.attachment;
      if(!r.media || r.media.once || r.type==='revoked') continue;
      try {
        if(had && existing) await fs.copyFile(path.join(existing.folder,file),target);
        else if(online) await fs.copyFile((await download(session,r)).path,target);
        else { m.missingAttachments++; continue; }
        r.attachment=file;
      } catch(e) {
        check(); if(['ENOSPC','EACCES','EROFS','EPERM'].includes(e.code)) throw e;
        await fs.rm(target,{force:true}); m.missingAttachments++;
      }
    }
    const records=[...rows.values()].filter(r=>!r.pendingText).sort((a,b)=>a.time-b.time);
    await writeChat(folder,c.chat,records);
    m.chats.push({chat:c.chat,title:String(c.title || c.chat),count:records.length,unread:Number(c.unread)||0,
      pinned:!!c.pinned,archived:!!c.archived,muted:!!c.muted});
  }
  check(); checkManifest(m); await writeJson(folder,'manifest.json',m);
  return m;
}
module.exports={chatFile,assetFile,chatId,checkManifest,validate,capture};
