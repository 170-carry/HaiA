// Account-scoped provenance. Event entries reference a record, never copy its body or credentials.
function initializeJournal(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      seq INTEGER PRIMARY KEY, at INTEGER NOT NULL, operation TEXT NOT NULL,
      source TEXT NOT NULL, ref TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS events_record ON events(ref,seq);
    CREATE TABLE IF NOT EXISTS deferred (id TEXT PRIMARY KEY, ack INTEGER, patch TEXT);
  `);
}
function event(store,operation,source,ref='') {
  store.sql('INSERT INTO events(at,operation,source,ref) VALUES (?,?,?,?)').run(Date.now(),operation,source,ref);
}
function defer(store,id,ack,change) {
  if (store.sql('SELECT 1 FROM removed WHERE id=?').get(id)) return;
  const old=store.sql('SELECT ack,patch FROM deferred WHERE id=?').get(id);
  if (ack==null) ack=old?.ack ?? null;
  else if (ack>=0 && old?.ack>ack) ack=old.ack;
  const patch=change ? JSON.stringify({...JSON.parse(old?.patch || '{}'),...change}) : old?.patch ?? null;
  if (old && old.ack===ack && old.patch===patch) return;
  store.transaction(()=>{
    store.sql('INSERT OR REPLACE INTO deferred VALUES (?,?,?)').run(id,ack,patch);
    event(store,change ? 'change-before-body' : 'receipt-before-body',change ? 'web-change' : 'web-receipt',id);
  });
}
function consume(store,row) {
  const old=store.sql('SELECT ack,patch FROM deferred WHERE id=?').get(row.id);
  if (!old) return row;
  const next={...row};
  if(old.patch) require('../inbox.cjs').applyChange(next,JSON.parse(old.patch));
  if (next.outgoing && old.ack!=null && (old.ack<0 || old.ack>=(next.ack ?? -1))) next.ack=old.ack;
  store.sql('DELETE FROM deferred WHERE id=?').run(row.id);
  return next;
}
module.exports={initializeJournal,event,defer,consume};
