const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {uuid,readJson,writeJson,pack}=require('./package.cjs');
const {validate}=require('./records.cjs');

async function exportSelection(ids,{temp,staging,target,pass,capture,progress}) {
  const index=[], totals={accounts:ids.length,chats:0,messages:0,missing:0,pending:0,offline:0};
  for(const [i,id] of ids.entries()) {
    const dir=ids.length===1?staging:await fs.mkdtemp(path.join(temp,'account-'));
    const m=await capture(id,dir,text=>progress('账号 '+(i+1)+' / '+ids.length+' · '+text));
    totals.chats+=m.chats.length;totals.messages+=m.chats.reduce((n,c)=>n+c.count,0);
    totals.missing+=m.missingAttachments;totals.pending+=m.missingBodies;if(!m.online) totals.offline++;
    if(dir!==staging) {
      index.push(m.id);
      for(const name of await fs.readdir(dir)) await fs.rename(path.join(dir,name),path.join(staging,m.id+'.'+name));
    }
  }
  if(index.length) await writeJson(staging,'manifest.json',{format:2,snapshots:index});
  progress('正在加密备份…');await pack(staging,target,pass);
  return totals;
}
async function readSelection(temp,staging) {
  const manifest=await readJson(staging,'manifest.json');
  if(manifest?.format===1) return [{dir:staging,meta:await validate(staging)}];
  const ids=manifest?.snapshots;
  if(manifest?.format!==2 || !Array.isArray(ids) || !ids.length || !ids.every(id=>typeof id==='string' && uuid.test(id)) ||
     new Set(ids).size!==ids.length) throw Error('多账号备份格式无效');
  const directories=new Map();
  for(const id of ids) {
    const dir=path.join(temp,id);await fs.mkdir(dir,{mode:0o700});directories.set(id,dir);
  }
  for(const name of await fs.readdir(staging)) {
    if(name==='manifest.json') continue;
    const dir=directories.get(name.slice(0,36));
    if(!dir || name[36]!=='.') throw Error('备份含有无法识别的账号记录');
    await fs.rename(path.join(staging,name),path.join(dir,name.slice(37)));
  }
  const bundles=[];
  for(const [id,dir] of directories) {
    const meta=await validate(dir);
    if(meta.id!==id) throw Error('账号记录与备份目录不匹配');
    bundles.push({dir,meta});
  }
  return bundles;
}
async function restoreSelection(desk,root,bundles) {
  const claimed=new Set(),fresh=[],moved=[],results=[];
  const exact=(a,m)=>(a.id===m.source || a.archiveSource===m.source) && (!a.phone || a.phone===m.phone);
  const reserved=new Set(desk.accounts.items.filter(a=>bundles.some(b=>exact(a,b.meta))).map(a=>a.id));
  try {
    for(const {meta:m,dir} of bundles) {
      let owner=desk.accounts.items.find(a=>!claimed.has(a.id) && exact(a,m));
      if(!owner && m.phone) owner=desk.accounts.items.find(a=>a.phone===m.phone && !reserved.has(a.id) && !claimed.has(a.id));
      if(!owner){owner={id:randomUUID(),name:m.name,phone:m.phone,archiveSource:m.source};fresh.push(owner);}
      claimed.add(owner.id);
      const parent=path.join(root,owner.id),dest=path.join(parent,m.id);
      await fs.mkdir(parent,{recursive:true,mode:0o700});
      const same=await fs.stat(dest).catch(e=>{if(e.code==='ENOENT') return null;throw e;});
      if(!same){await fs.rename(dir,dest);moved.push(dest);}
      results.push({account:owner.id,key:m.id,name:owner.name,drafts:m.drafts,already:!!same});
    }
    if(fresh.length) desk.accounts.save([...desk.accounts.items,...fresh]);
  } catch(error) {
    for(const dest of moved) await fs.rm(dest,{recursive:true,force:true});
    throw error;
  }
  for(const owner of fresh) desk.attach(owner);
  desk.select(results[0].account);desk.publish();
  return results;
}
module.exports={exportSelection,readSelection,restoreSelection};
