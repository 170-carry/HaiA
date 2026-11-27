// One database per registered account. Polls write only changed rows in a transaction.
// The chat/time index serves offline pages, and the preview index chooses one row per chat.
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const journal = require('./journal.cjs');
const {reconcile} = require('./merge.cjs');

class HistoryStore {
  constructor(folder) {
    fs.mkdirSync(folder,{recursive:true,mode:0o700});
    // Staging files belong to an unfinished local upload from the prior process.
    for (const name of fs.readdirSync(folder)) if (/^\.upload-[0-9a-f-]{36}$/.test(name)) fs.rmSync(path.join(folder,name),{force:true});
    this.folder = folder;
    this.accountId = path.basename(folder);
    const file=path.join(folder,'history.sqlite');
    fs.closeSync(fs.openSync(file,'a',0o600));
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS chats (chat TEXT PRIMARY KEY, detail TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY, chat TEXT NOT NULL, time INTEGER NOT NULL,
        position INTEGER NOT NULL, preview INTEGER NOT NULL, body TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS history_page ON messages(chat,time DESC,position DESC,id DESC);
      CREATE INDEX IF NOT EXISTS history_preview ON messages(chat,preview DESC,time DESC,position DESC,id DESC);
      CREATE TABLE IF NOT EXISTS removed (id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS terms (id TEXT PRIMARY KEY, chat TEXT NOT NULL, time INTEGER NOT NULL, words TEXT NOT NULL, starred INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS terms_recent ON terms(time DESC);
      CREATE INDEX IF NOT EXISTS terms_chat ON terms(chat,time DESC);
      CREATE INDEX IF NOT EXISTS terms_starred ON terms(starred,time DESC);
      CREATE TRIGGER IF NOT EXISTS terms_insert AFTER INSERT ON messages WHEN
        json_extract(NEW.body,'$.system')=0 AND json_extract(NEW.body,'$.type')!='revoked'
      BEGIN
        INSERT OR REPLACE INTO terms VALUES(NEW.id,NEW.chat,NEW.time,lower(json_extract(NEW.body,'$.text')),json_extract(NEW.body,'$.starred'));
      END;
      CREATE TRIGGER IF NOT EXISTS terms_update AFTER UPDATE OF body ON messages
      BEGIN
        DELETE FROM terms WHERE id=NEW.id;
        INSERT INTO terms SELECT NEW.id,NEW.chat,NEW.time,lower(json_extract(NEW.body,'$.text')),json_extract(NEW.body,'$.starred')
          WHERE json_extract(NEW.body,'$.system')=0 AND json_extract(NEW.body,'$.type')!='revoked';
      END;
      CREATE TRIGGER IF NOT EXISTS terms_delete AFTER DELETE ON messages BEGIN DELETE FROM terms WHERE id=OLD.id; END;
    `);
    journal.initializeJournal(this.db);
    this.db.exec('CREATE TABLE IF NOT EXISTS translations(id TEXT NOT NULL,lang_key TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(id,lang_key))');
    this.statements = new Map();
    this.revision = 0;
    // One-time index construction for databases created with the earlier snapshot schema.
    if (!this.get('terms-ready')) this.transaction(()=>{
      this.db.exec(`INSERT OR REPLACE INTO terms SELECT id,chat,time,lower(json_extract(body,'$.text')),json_extract(body,'$.starred')
        FROM messages WHERE json_extract(body,'$.system')=0 AND json_extract(body,'$.type')!='revoked'`);
      this.set('terms-ready','1');
    });
  }
  sql(query) {
    if (!this.statements.has(query)) this.statements.set(query,this.db.prepare(query));
    return this.statements.get(query);
  }
  transaction(fn) {
    if (this.inTransaction) return fn();
    this.db.exec('BEGIN');
    this.inTransaction=true;
    try { const value=fn(); this.db.exec('COMMIT'); this.revision++; return value; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
    finally {this.inTransaction=false;}
  }
  get(key) { return this.sql('SELECT value FROM meta WHERE key=?').get(key)?.value; }
  set(key,value) { this.sql('INSERT OR REPLACE INTO meta VALUES (?,?)').run(key,String(value)); }
  row(id) {
    const body = this.sql('SELECT body FROM messages WHERE id=?').get(id)?.body;
    return body ? {...JSON.parse(body),accountId:this.accountId} : null;
  }
  save(row, replace = false, source='web-sync', operation='message') {
    if (!this.inTransaction) return this.transaction(()=>this.save(row,replace,source,operation));
    if (this.sql('SELECT 1 FROM removed WHERE id=?').get(row.id)) return null;
    const previous=this.row(row.id);
    if (row.pendingText) return previous || row;
    row=replace ? row : reconcile(previous,row);
    row=journal.consume(this,row);
    if (!previous && row.rowId==null) row.sequence=this.sql('SELECT coalesce(max(rowid),0)+1 AS position FROM messages').get().position;
    if (row===previous) return previous;
    const preview = row.previewable === false || !row.text?.trim() ? 0 : row.system && !row.chat.endsWith('@g.us') ? 1 : 2;
    if (row.media?.once) row={...row,media:{...row.media,thumb:''}};
    const body=JSON.stringify(row);
    this.sql(`INSERT INTO messages VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      body=excluded.body,preview=excluded.preview,time=excluded.time,position=excluded.position`)
      .run(row.id,row.chat,row.time,row.rowId ?? row.sequence ?? 0,preview,body);
    if (previous && (row.text!==previous.text || row.type==='revoked'))
      this.sql('DELETE FROM translations WHERE id=?').run(row.id);
    if (previous && operation==='message') {
      if (row.type==='revoked') operation='revoked';
      else if (previous.text!==row.text) operation=row.edited ? 'edited' : 'enriched';
      else if (row.ack!==previous.ack) operation='ack';
      else operation='updated';
    }
    journal.event(this,operation,source,row.id);
    this.sql('INSERT OR IGNORE INTO chats VALUES (?,?)').run(row.chat,JSON.stringify({chat:row.chat,title:row.title,time:row.time}));
    return row;
  }
  directory(entries, fallback = false) {
    for (const entry of entries) {
      const sql = fallback ? 'INSERT OR IGNORE INTO chats VALUES (?,?)' : 'INSERT OR REPLACE INTO chats VALUES (?,?)';
      this.sql(sql).run(entry.chat,JSON.stringify(entry));
    }
  }
  remove(id) {
    this.sql('DELETE FROM messages WHERE id=?').run(id);
    this.sql('DELETE FROM deferred WHERE id=?').run(id);
    this.sql('DELETE FROM translations WHERE id=?').run(id);
    if (this.sql('INSERT OR IGNORE INTO removed VALUES (?)').run(id).changes) journal.event(this,'removed','web-change',id);
  }
  restore(inbox, accountId) {
    const chats = this.sql(`SELECT c.detail,
      (SELECT body FROM messages m WHERE m.chat=c.chat AND preview>0 ORDER BY preview DESC,time DESC,position DESC,id DESC LIMIT 1) AS latest
      FROM chats c`).all();
    for (const chat of chats) {
      if (chat.latest) inbox.conversations.observe({...JSON.parse(chat.latest),accountId},true,false);
      inbox.conversations.index(accountId,[JSON.parse(chat.detail)]);
    }
    inbox.conversations.setUnread(accountId,JSON.parse(this.get('unread') || '[]'));
    return chats.length;
  }
  page(chat, limit) {
    // Count uses the covering chat index, payload lookup and JSON parsing are limited to the displayed rows.
    if (this.cached?.chat===chat && this.cached.limit===limit && this.cached.revision===this.revision)
      return {messages:[...this.cached.messages],count:this.cached.count,missingCount:0};
    const messages = this.sql('SELECT body FROM messages WHERE chat=? ORDER BY time DESC,position DESC,id DESC LIMIT ?')
      .all(chat,limit).map(row=>({...JSON.parse(row.body),accountId:this.accountId}));
    const count = this.sql('SELECT count(*) AS n FROM messages WHERE chat=?').get(chat).n;
    this.cached={chat,limit,revision:this.revision,messages,count};
    return {messages:[...messages],count,missingCount:0};
  }
  search(query,starred,chat) {
    // Scan only the compact text index in newest-first order, stop at 80 matches,
    // and fetch JSON (which can contain thumbnails) only for those matched IDs.
    const filters=[chat?'chat=?':'',starred?'starred=1':'',query?'instr(words,lower(?))>0':''].filter(Boolean);
    const sql='SELECT id FROM terms'+(filters.length?' WHERE '+filters.join(' AND '):'')+' ORDER BY time DESC LIMIT 80';
    return this.sql(sql).all(...(chat?[chat]:[]),...(query?[query]:[])).map(hit=>this.row(hit.id));
  }
  flag(chat,patch) {
    const row=this.sql('SELECT detail FROM chats WHERE chat=?').get(chat);
    if(row) this.directory([{...JSON.parse(row.detail),...patch}]);
  }
  close() { this.db.close(); }
}
module.exports = { HistoryStore };
