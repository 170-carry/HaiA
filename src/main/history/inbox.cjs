const fs = require('node:fs');
const path = require('node:path');
const { Inbox, applyChange } = require('../inbox.cjs');
const journal=require('./journal.cjs');
const { HistoryStore } = require('./store.cjs');
const { uuid } = require('../backup/package.cjs');

class HistoryInbox extends Inbox {
  constructor(root) {
    super();
    this.root = path.join(root,'chat-snapshots');
    this.stores = new Map();
  }
  open(accountId) {
    if (!uuid.test(accountId)) throw new Error('无效的账号');
    if (!this.stores.has(accountId)) {
      const store = new HistoryStore(path.join(this.root,accountId));
      this.stores.set(accountId,store);
      store.restore(this,accountId);
    }
    return this.stores.get(accountId);
  }
  add(accountId,items,source='web-sync') {
    if (!items.length) return [];
    const store=this.open(accountId);
    // Commit before updating the live view. On a write failure the same input can
    // be replayed without an in-memory duplicate suppressing the database insert.
    const normalized = new Inbox().add(accountId,items);
    const originals=new Map(items.filter(Boolean).map(item=>[item.id,item]));
    const rows=store.transaction(()=>normalized.map(({message})=>store.save(message,false,source)).filter(Boolean));
    this.inserting=true;
    try {
      const added=super.add(accountId,rows.map(row=>({...originals.get(row.id),...row})));
      for (const row of rows) {
        const current=this.find(accountId,row.id);
        if (current) Object.assign(current,row);
      }
      return added;
    } finally {this.inserting=false;}
  }
  persistReceipt(store,id,ack) {
    const row = store.row(id);
    if (!row) {journal.defer(store,id,ack,null);return false;}
    if (!row.outgoing || row.ack === ack || (ack>=0 && row.ack>ack)) return false;
    row.ack = ack;
    store.save(row,true,'web-receipt','ack');
    return true;
  }
  receipt(account,id,ack) {
    if (this.inserting || !Number.isInteger(ack) || ack>4) return super.receipt(account,id,ack);
    const stored=this.persistReceipt(this.open(account),id,ack);
    return super.receipt(account,id,ack) || stored;
  }
  patch(account,id,change) {
    if (!change) return false;
    const store=this.open(account);
    const previous=store.row(id),row=previous && {...previous};
    store.transaction(()=>{
      if (change.removed) store.remove(id);
      else if (row && applyChange(row,change)) {
        if (JSON.stringify(previous)!==JSON.stringify(row)) store.save(row,true,'web-change',change.revoked?'revoked':change.text?'edited':'updated');
      } else journal.defer(store,id,null,change);
    });
    const result=super.patch(account,id,change);
    if (previous?.media && (change.removed || change.revoked)) {
      fs.rmSync(path.join(store.folder,require('../backup/records.cjs').assetFile(row.chat,id)),{force:true});
    }
    if (row && change.removed && this.conversations.latest.get(account)?.get(row.chat)?.id === id) {
      this.conversations.latest.get(account).delete(row.chat);
      const latest = store.sql('SELECT body FROM messages WHERE chat=? AND preview>0 ORDER BY preview DESC,time DESC,position DESC,id DESC LIMIT 1').get(row.chat);
      if (latest) this.conversations.observe({...JSON.parse(latest.body),accountId:account},true,false);
    }
    if (row && !change.removed && this.conversations.latest.get(account)?.get(row.chat)?.id===id) this.conversations.observe(row,true,false);
    return result || !!row;
  }
  mergeUnread(account,batch) {
    if (batch.chatUnread || !batch.chatUnreadDelta) return;
    const counts=new Map(this.conversations.unread.get(account));
    for (const [chat,count] of batch.chatUnreadDelta) {
      if (count) counts.set(chat,count); else counts.delete(chat);
    }
    batch.chatUnread=[...counts];
  }
  captureDirectory(account,batch) {
    if (!batch.directory?.length && !batch.chatUnread) return;
    const store=this.open(account);
    store.transaction(()=>{
      if (batch.directory?.length) store.directory(batch.directory);
      if (batch.chatUnread) store.set('unread',JSON.stringify(batch.chatUnread));
    });
  }
  discard(accountId) {
    this.stores.get(accountId)?.close();
    this.stores.delete(accountId);
    super.clear(accountId);
    if (uuid.test(accountId)) fs.rmSync(path.join(this.root,accountId),{recursive:true,force:true});
  }
  close() {
    for (const store of this.stores.values()) store.close();
    this.stores.clear();
  }
}
module.exports = { HistoryInbox };
