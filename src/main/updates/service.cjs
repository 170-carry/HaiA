const fs = require('node:fs/promises');
const path = require('node:path');
const {endpoint,verifyManifest} = require('./manifest.cjs');
const {download,verifyFile} = require('./download.cjs');
const {install} = require('./install.cjs');

function updateRoutes({app,fetch,notify,quit,publicKey,target=process.platform+'-'+process.arch,apply=install}) {
  const root=path.join(app.getPath('userData'),'updates');
  let release, file, checked=0, stage='idle', percent=0, busy=false;
  const snapshot=()=>({stage,percent,version:release?.version || ''});
  function publish(next) {stage=next;notify(snapshot());return snapshot();}
  async function operation(action) {
    if(busy) throw Error('更新操作正在进行');
    busy=true; try {return await action();} finally {busy=false;}
  }
  return {
    updateState:snapshot,
    checkUpdate:()=>operation(async()=>{
      if(stage==='ready' || (release && Date.now()-checked<60000)) return snapshot();
      const response=await fetch(endpoint,{cache:'no-store',signal:AbortSignal.timeout(15000)});
      if(!response.ok) throw Error(response.status===404?'发布页尚未提供更新清单':'暂时无法读取更新清单（HTTP '+response.status+'）');
      let length=0, chunks=[];
      for await(const chunk of response.body) {
        length+=chunk.length;if(length>32768) throw Error('更新清单过大');
        chunks.push(Buffer.from(chunk));
      }
      release=verifyManifest(JSON.parse(Buffer.concat(chunks).toString()),publicKey || await fs.readFile(path.join(__dirname,'public.pem')),target,app.getVersion());
      // Reuse a verified download across restarts; discard incomplete and superseded copies.
      file=null;
      const entries=await fs.readdir(root).catch(error=>{if(error.code==='ENOENT') return []; throw error;});
      for(const name of entries.filter(entry=>/^download-[A-Za-z0-9]{6}$/.test(entry))) {
        const dir=path.join(root,name), candidate=path.join(dir,release.name);
        if(!file && release.available) {
          try {await verifyFile(candidate,release);file=candidate;continue;} catch { /* Discard an incomplete download. */ }
        }
        // Windows may still have the old installer open during its first relaunch.
        await fs.rm(dir,{recursive:true,force:true}).catch(error=>{if(!['EBUSY','EPERM','EACCES'].includes(error.code)) throw error;});
      }
      checked=Date.now();return publish(file?'ready':release.available?'available':'latest');
    }),
    downloadUpdate:()=>operation(async()=>{
      if(stage!=='available' || !release?.available) throw Error('请先检查新版本');
      await fs.mkdir(root,{recursive:true,mode:0o700});
      // Only this instance downloads updates. Discard interrupted transfers and superseded installers.
      for(const entry of await fs.readdir(root)) {
        if(/^download-[A-Za-z0-9]{6}$/.test(entry)) await fs.rm(path.join(root,entry),{recursive:true,force:true});
      }
      const folder=await fs.mkdtemp(path.join(root,'download-'));
      file=path.join(folder,release.name); percent=0;publish('downloading');
      try {
        await download(fetch,release,file,value=>{percent=value;publish('downloading');});
        return publish('ready');
      } catch(error){await fs.rm(folder,{recursive:true,force:true});file=null;publish('available');throw error;}
    }),
    installUpdate:()=>operation(async()=>{
      if(stage!=='ready' || !file) throw Error('请先下载更新');
      if(!app.isPackaged) throw Error('开发模式不能替换已安装的应用');
      publish('installing');
      try {await apply(file,release);} catch(error){publish('available');throw error;}
      quit();
    })
  };
}
module.exports={updateRoutes};
