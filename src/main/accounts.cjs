const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

class Accounts {
  constructor(dir) {
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'accounts.json');
    this.items = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : [];
  }
  save(items) {
    const temp = this.file + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(items), { mode: 0o600, flush: true });
    fs.renameSync(temp, this.file);
    this.items = items;
  }
  add(label) {
    const name = String(label || '').trim().slice(0, 48);
    if (!name) throw new Error('请填写账号名称');
    const account = { id: randomUUID(), name };
    this.save([...this.items, account]);
    return account;
  }
  // Remembers the linked number and an unexpected logout across restarts.
  update(id, patch) {
    const item = this.items.find(entry => entry.id === id);
    if (!item) return;
    this.save(this.items.map(account=>account===item ? {...item,...patch} : account));
    Object.assign(item,patch);
    this.items[this.items.findIndex(account=>account.id===id)]=item;
  }
  reorder(ids) {
    const order = new Map(ids.map((id,index) => [id,index]));
    this.save([...this.items].sort((a,b) => (order.get(a.id) ?? 1e6) - (order.get(b.id) ?? 1e6)));
  }
  remove(id) {
    this.save(this.items.filter(item => item.id !== id));
  }
}

module.exports = { Accounts };
