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
  function request(key, accountId, who) {
    let entry = cache.get(key);
    if (!entry || entry.expires < Date.now()) {
      entry = {expires:Date.now()+300000,promise:new Promise(resolve=>queue.push({accountId,who,resolve}))};
      // A photo that could not be read is asked for again soon, because right after connecting it is often not ready yet.
      entry.promise.then(src => { if (!src && cache.get(key) === entry) entry.expires = Date.now() + 8000; });
      cache.set(key,entry);
      if (cache.size > 500) cache.delete(cache.keys().next().value);
      pump();
    }
    return entry.promise;
  }
  // The picture is put into the node when it arrives. Without one, the node keeps asking at growing intervals
  // for as long as it is on screen, so an avatar drawn once still fills in later.
  function fill(node, accountId, who, identity, attempt) {
    const key = JSON.stringify([accountId,identity,who]);
    request(key,accountId,who).then(src => {
      if (accounts.get(accountId) !== identity) return;
      if (src) {
        if (!node.isConnected && attempt) return;
        const img = new Image();
        img.alt = 'WhatsApp 头像';
        img.src = src;
        node.replaceChildren(img);
      } else if (attempt < 6) {
        setTimeout(() => { if (node.isConnected) fill(node,accountId,who,identity,attempt + 1); }, [9000,15000,30000,60000,120000,300000][attempt]);
      }
    });
  }
  function face(accountId,who) {
    const node = el('span','photo-face');
    node.append(icon('person'));
    const identity = accounts.get(accountId);
    if (!identity || !who) return node;
    fill(node,accountId,who,identity,0);
    return node;
  }
  return {face, setAccounts(items) {
    accounts = new Map(items.filter(a=>a.status==='online').map(a=>[a.id,a.photoIdentity]));
  }, forget(accountId, who) {
    // After the picture was changed, the stored copy is dropped so the next draw reads the new one.
    for (const key of [...cache.keys()]) { const [account,,person] = JSON.parse(key); if (account === accountId && (!who || person === who)) cache.delete(key); }
  }};
})();
