(() => {
  const dialog=get('backup-dialog'), owners=get('backup-account'), password=get('backup-pass'), status=get('backup-status');
  let busy=false;
  const choices=get('backup-choices'), all=get('backup-all');
  const selected=()=>Array.from(choices.querySelectorAll('input:checked'),input=>input.value);
  function selectionChanged() {
    const count=selected().length,total=choices.children.length;
    all.checked=total>0 && count===total;
    all.indeterminate=count>0 && count<total;
    all.disabled=!total;
    get('backup-export').disabled=busy || !count;
    get('backup-export').textContent=count?'导出所选账号（'+count+'）':'导出所选账号';
  }
  all.onchange=()=>{for(const input of choices.querySelectorAll('input')) input.checked=all.checked;selectionChanged();};
  choices.onchange=selectionChanged;
  function accounts(items,id) {
    owners.replaceChildren(...items.map(a=>new Option(a.name+(a.phone?' · +'+a.phone:''),a.id)));
    if(items.some(a=>a.id===id)) owners.value=id;
    choices.replaceChildren(...items.map(a=>{
      const label=document.createElement('label'),input=document.createElement('input');
      input.type='checkbox';input.value=a.id;input.checked=a.id===owners.value;
      label.append(input,document.createTextNode(a.name+(a.phone?' · +'+a.phone:'')));return label;
    }));
    selectionChanged();
  }
  get('open-backup').onclick=()=>{
    accounts(state?.accounts || [],state?.active);
    status.textContent=''; dialog.showModal(); run(()=>backupHistory.refresh());
  };
  owners.onchange=()=>run(()=>backupHistory.refresh());
  dialog.addEventListener('cancel',e=>{ if(busy)e.preventDefault(); });
  dialog.addEventListener('close',()=>{ password.value=''; });
  get('backup-close').onclick=()=>dialog.close();
  api.onBackupStatus(label=>{ if(busy)status.textContent=label; });
  async function operate(importing) {
    if(busy) return;
    if(password.value.length<8){status.textContent='请输入至少 8 个字符的备份密码';password.focus();return;}
    busy=true;
    const buttons=['backup-import','backup-export','backup-close','backup-account','backup-pass','backup-owners'].map(get);
    buttons.forEach(b=>b.disabled=true);
    status.textContent=importing?'选择要导入的备份文件…':'选择备份保存位置…';
    try {
      if(importing) {
        const results=await api.backupImport(password.value);
        if(!results){status.textContent='';return;}
        for(const result of results) for(const [chat,text,mentions] of result.drafts) {
          const key=JSON.stringify([result.account,chat]);
          if(drafts.has(key)) continue;
          drafts.set(key,text);
          for(const span of mentions || []) mentionDrafts.add(key,text,span.start,span.label,span.id);
        }
        draftStore.persist(); accounts((await api.state()).accounts,results[0].account);
        await backupHistory.refresh(results[0].key);
        status.textContent=results.every(r=>r.already)?'这份备份已导入，可以查看记录。':'已恢复 '+results.length+' 个账号的聊天记录。';
      } else {
        const ids=selected(),items=Object.fromEntries(ids.map(id=>[id,[]]));
        for(const [key,text] of drafts) {
          const [id,chat]=JSON.parse(key);
          if(items[id] && chat && text.trim()) {
            const body=text.slice(0,4000);
            const spans=(mentionDrafts.sync(key,text)?.spans || []).filter(s=>body.startsWith(s.label,s.start));
            items[id].push([chat,body,spans]);
          }
        }
        const result=await api.backupExport(ids,password.value,items);
        if(!result){status.textContent='';return;}
        status.textContent='已导出 '+result.accounts+' 个账号、'+result.chats+' 个会话、'+result.messages+' 条消息'+(result.offline?'（其中 '+result.offline+' 个账号使用离线缓存）':'')+'。'+
          (result.missing ? result.missing+' 个附件原件无法取得。':'')+(result.pending ? result.pending+' 条消息尚无正文。':'');
      }
      password.value='';
    } catch(e){status.textContent=readable(e);}
    finally {busy=false; buttons.forEach(b=>b.disabled=false);selectionChanged();}
  }
  get('backup-import').onclick=()=>operate(true);get('backup-export').onclick=()=>operate(false);
})();
