// The catalog records an interrupted identity change before the old history moves.
// On restart, finish that move before opening either account's database.
const fs=require('node:fs');
const path=require('node:path');
const {uuid}=require('../backup/package.cjs');
function finish(accounts,root,entry) {
  const source=entry.snapshotFrom;
  if (!entry.historyOnly || !uuid.test(source) || !uuid.test(entry.id) || source===entry.id)
    throw Error('本地账号历史迁移记录无效');
  const from=path.join(root,source),to=path.join(root,entry.id);
  if (!fs.existsSync(to)) fs.renameSync(from,to);
  if (!fs.existsSync(path.join(to,'history.sqlite'))) throw Error('无法找到正在迁移的聊天历史');
  const backupRoot=path.join(path.dirname(root),'account-backups');
  const oldBackups=path.join(backupRoot,source),archivedBackups=path.join(backupRoot,entry.id);
  if (fs.existsSync(oldBackups) && !fs.existsSync(archivedBackups)) fs.renameSync(oldBackups,archivedBackups);
  // The new account must never import rows from the previous identity's browser partition.
  const fresh=new (require('./store.cjs').HistoryStore)(from);
  try { fresh.set('legacy','1'); } finally { fresh.close(); }
  const original=accounts.items.find(a=>a.id===source);
  const clean={draftId:require('node:crypto').randomUUID(),phone:'',linked:false,dropped:undefined,restriction:undefined,appeal:undefined};
  accounts.save(accounts.items.map(a=>a===entry ? {...a,draftId:a.draftId || source,snapshotFrom:undefined} : a===original ? {...a,...clean} : a));
  // Keep references held by windows in step with the catalog committed on disk.
  if (original) Object.assign(original,clean);
  delete entry.snapshotFrom;
}
function finishInterrupted(accounts,root) {
  for(const entry of accounts.items.filter(a=>a.snapshotFrom)) finish(accounts,root,entry);
}
module.exports={finish,finishInterrupted};
