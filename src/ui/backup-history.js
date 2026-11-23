const backupHistory = (() => {
  const owner=get('backup-account'), versions=get('backup-version'), chats=get('backup-chat'), log=get('backup-log'), older=get('backup-older');
  let snapshots=[],offset=0,ticket=0;
  async function page(append=false) {
    const mine=++ticket, account=owner.value, key=versions.value, chat=chats.value;
    older.hidden=true;
    if(!append) { offset=0; log.replaceChildren(); }
    if(!chat) return;
    const rows=await api.backupPage(account,key,chat,offset);
    if(ticket!==mine) return;
    const nodes=rows.map(row=>{
      const node=el('div','backup-row');
      node.append(el('small','',row.sender+' · '+new Date(row.time).toLocaleString()),el('p','',row.text));
      if(row.attachment) {
        const btn=el('button','plain','保存附件 · '+(row.name||'文件'));
        btn.onclick=()=>run(()=>api.backupSaveFile(account,key,chat,row.attachment));node.append(btn);
      }
      return node;
    });
    if(append) log.prepend(...nodes); else { log.replaceChildren(...nodes); log.scrollTop=log.scrollHeight; }
    offset+=rows.length;
    const c=snapshots.find(v=>v.key===key)?.chats.find(c=>c.chat===chat);
    older.hidden=!c || offset>=c.count;
  }
  function showChats() {
    const v=snapshots.find(s=>s.key===versions.value);
    chats.replaceChildren(...(v?.chats || []).map(c=>new Option(c.title+' · '+c.count+' 条',c.chat)));
    return page();
  }
  async function refresh(key) {
    const mine=++ticket;
    get('backup-library').hidden=true; log.replaceChildren();
    const data=owner.value ? await api.backupList(owner.value) : [];
    if(mine!==ticket) return;
    snapshots=data; versions.replaceChildren(...data.map(v=>new Option(v.name+' · '+new Date(v.time).toLocaleString(),v.key)));
    if(key) versions.value=key;
    get('backup-library').hidden=!data.length;
    return showChats();
  }
  versions.onchange=()=>run(showChats); chats.onchange=()=>run(()=>page()); older.onclick=()=>run(()=>page(true));
  return {refresh};
})();
