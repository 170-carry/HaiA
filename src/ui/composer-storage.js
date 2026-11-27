// Same local Electron profile as the workspace UI. Structured cloning keeps pasted
// files on disk as blobs without inflating them into a single localStorage JSON value.
const composerDisk = (() => {
  const opened=new Promise((resolve,reject)=>{
    const q=indexedDB.open('HaiA-composer',1);
    q.onupgradeneeded=()=>{for(const name of ['text','mentions','extras']) q.result.createObjectStore(name);};
    q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);
  });
  async function transact(name,mode,work) {
    const db=await opened;
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(name,mode,{durability:'strict'});
      const result=work(tx.objectStore(name));
      tx.oncomplete=()=>resolve(result?.result);tx.onabort=()=>reject(tx.error);
    });
  }
  const get=(name,key)=>transact(name,'readonly',s=>s.get(key));
  const put=(name,key,value)=>transact(name,'readwrite',s=>value==null ? s.delete(key) : s.put(value,key));
  async function load(name,legacy,map) {
    let previous=[];
    try {
      const rows=JSON.parse(localStorage.getItem(legacy) || '[]');
      if (!Array.isArray(rows) || !rows.every(row=>Array.isArray(row) && typeof row[0]==='string')) throw Error();
      previous=rows;
    } catch { warning('读取旧草稿失败，已保留原文件。'); }
    if(previous.length) {
      await transact(name,'readwrite',store=>{
        for(const [key,value] of previous) {
          const q=store.getKey(key);
          q.onsuccess=()=>{if(q.result===undefined)store.put(value,key);};
        }
      });
      localStorage.removeItem(legacy);
    }
    await transact(name,'readonly',store=>{
      const q=store.openCursor();q.onsuccess=()=>{const row=q.result;if(row){map.set(row.key,row.value);row.continue();}};
    });
  }
  async function removeAccount(id) {
    const prefix='['+JSON.stringify(id)+',';
    for(const name of ['text','extras','mentions'])
      await transact(name,'readwrite',s=>s.delete(IDBKeyRange.bound(prefix,prefix+'\uffff')));
  }
  function write(name,key,value) { return put(name,key,value).catch(()=>warning('本机草稿保存失败，请检查磁盘空间和数据目录权限。')); }
  const flush=()=>Promise.all(['text','extras','mentions'].map(name=>transact(name,'readwrite',store=>store.count(IDBKeyRange.only(''))))).then(()=>true);
  return {get,put,load,removeAccount,write,flush};
})();
