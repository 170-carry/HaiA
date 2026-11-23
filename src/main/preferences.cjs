const fs = require('node:fs');
const path = require('node:path');

const defaults = {background:true, notify:true, sound:true, badge:true, mutedAccounts:[], templates:[]};
// App-wide choices that the main process needs: background mode, notifications and quick replies.
class Preferences {
  constructor(directory) {
    this.file = path.join(directory,'preferences.json');
    try { this.values = {...defaults, ...JSON.parse(fs.readFileSync(this.file,'utf8'))}; } catch { this.values = {...defaults}; }
  }
  get all() { return {...this.values}; }
  save(patch) {
    const next = {...this.values};
    for (const key of ['background','notify','sound','badge']) if (typeof patch?.[key] === 'boolean') next[key] = patch[key];
    if (Array.isArray(patch?.mutedAccounts)) next.mutedAccounts = [...new Set(patch.mutedAccounts.filter(id => typeof id === 'string'))].slice(0,200);
    if (Array.isArray(patch?.templates)) {
      next.templates = patch.templates.filter(item => item && typeof item.text === 'string' && item.text.trim()).slice(0,100)
        .map(item => ({title:String(item.title || '').trim().slice(0,40) || item.text.trim().slice(0,20), text:item.text.slice(0,4000)}));
    }
    fs.writeFileSync(this.file + '.tmp',JSON.stringify(next),{mode:0o600});
    fs.renameSync(this.file + '.tmp',this.file);
    this.values = next;
    return this.all;
  }
}
module.exports = { Preferences };
