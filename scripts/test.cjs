// Run against the same SQLite and Node runtime that ships with the desktop app.
const {spawnSync}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const files=fs.readdirSync(path.join(root,'test')).filter(name=>name.endsWith('.test.cjs'));
const run=spawnSync(require('electron'),['--test',...files.map(name=>path.join(root,'test',name))],{
  stdio:'inherit',env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}
});
if (run.error) throw run.error;
process.exitCode=run.status ?? 1;
