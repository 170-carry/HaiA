// These functions run in an isolated Chromium profile. postMessage preserves non-exportable CryptoKeys
// through structured cloning while writing only selected authentication stores to a fresh database.
async function acceptSnapshot() {
  const port=await window.haiaPortReady;
  port.onmessage=async event=>{
    try {
      for(const item of event.data.databases) {
        const db=await new Promise((resolve,reject)=>{
          const q=indexedDB.open(item.name,item.version);
          q.onupgradeneeded=()=>{
            for(const schema of item.stores){
              const store=q.result.createObjectStore(schema.name,{keyPath:schema.keyPath,autoIncrement:schema.autoIncrement});
              for(const index of schema.indexes)store.createIndex(index.name,index.keyPath,{unique:index.unique,multiEntry:index.multiEntry});
            }
          };
          q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);
        });
        try {
          if(item.stores.length)await new Promise((resolve,reject)=>{
            const tx=db.transaction(item.stores.map(s=>s.name),'readwrite');
            for(const schema of item.stores){
              const store=tx.objectStore(schema.name);
              schema.values.forEach((value,i)=>schema.keyPath===null?store.put(value,schema.keys[i]):store.put(value));
            }
            tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);tx.onerror=()=>reject(tx.error);
          });
        }finally{db.close();}
      }
      for(const [key,value] of event.data.storage)localStorage.setItem(key,value);
      port.postMessage({ok:true});
    }catch(error){port.postMessage({error:String(error.message)});}
  };
  port.start();
}
async function sendSnapshot(allowed, filters = {}) {
  const databases=[];
  for(const item of await indexedDB.databases()){
    if(!Object.hasOwn(allowed,item.name))continue;
    const db=await new Promise((resolve,reject)=>{const q=indexedDB.open(item.name);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
    const stores=[];
    try {
      for(const name of db.objectStoreNames){
        const transaction=db.transaction(name),store=transaction.objectStore(name);
        const schema={name,keyPath:store.keyPath,autoIncrement:store.autoIncrement,
          indexes:Array.from(store.indexNames,n=>{const i=store.index(n);return {name:n,keyPath:i.keyPath,unique:i.unique,multiEntry:i.multiEntry};}),keys:[],values:[]};
        if(allowed[item.name]===null || allowed[item.name].includes(name)){
          const ask=request=>new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
          [schema.keys,schema.values]=await Promise.all([ask(store.getAllKeys()),ask(store.getAll())]);
          const keys=filters[item.name+'/'+name];
          if(keys){
            const positions=schema.keys.map((key,i)=>keys.includes(key)?i:-1).filter(i=>i>=0);
            schema.keys=positions.map(i=>schema.keys[i]);schema.values=positions.map(i=>schema.values[i]);
          }
        }
        stores.push(schema);
      }
    }finally{db.close();}
    databases.push({name:item.name,version:item.version,stores});
  }
  if(!databases.length)throw Error('未找到支持的登录数据库');
  await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(Error('登录数据复制超时')),30000);
    window.haiaPortReady.then(port=>{
      port.onmessage=event=>{
        clearTimeout(timeout);port.close();
        event.data.ok?resolve():reject(Error(event.data.error || '登录数据复制失败'));
      };
      port.start();port.postMessage({databases,storage:Object.keys(localStorage).map(key=>[key,localStorage.getItem(key)])});
    }).catch(reject);
  });
  return databases.length;
}
module.exports={acceptSnapshot,sendSnapshot};
