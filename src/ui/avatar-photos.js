const avatarPhotos = (() => {
  const cache = new Map(), queue = [];
  let accounts = new Map(), busy = 0;
  function pump() {
    while (busy < 4 && queue.length) {
      const job = queue.shift();
      busy++;
      window.desk.photo(job.accountId,job.who).then(job.resolve,()=>job.resolve(null))
        .finally(()=>{ busy--; pump(); });
    }
  }
  function face(accountId,who) {
    const node = el('span','photo-face');
    node.append(icon('person'));
    const identity = accounts.get(accountId);
    if (!identity || !who) return node;
    const key = JSON.stringify([accountId,identity,who]);
    let entry = cache.get(key);
    if (!entry || entry.expires < Date.now()) {
      entry = {expires:Date.now()+300000,promise:new Promise(resolve=>queue.push({accountId,who,resolve}))};
      cache.set(key,entry);
      if (cache.size > 500) cache.delete(cache.keys().next().value);
      pump();
    }
    entry.promise.then(src => {
      if (!src || accounts.get(accountId) !== identity || !node.isConnected) return;
      const img = new Image();
      img.alt = 'WhatsApp 头像';
      img.src = src;
      node.replaceChildren(img);
    });
    return node;
  }
  return {face, setAccounts(items) {
    accounts = new Map(items.filter(a=>a.status==='online').map(a=>[a.id,a.photoIdentity]));
  }};
})();
