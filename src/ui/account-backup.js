(() => {
  const dialog=get('backup-dialog'), owners=get('backup-account'), password=get('backup-pass'), status=get('backup-status');
  let busy=false;
  function accounts(items,id) {
    owners.replaceChildren(...items.map(a=>new Option(a.name+(a.phone?' · +'+a.phone:''),a.id)));
    if(items.some(a=>a.id===id)) owners.value=id;
    get('backup-export').disabled=busy || !owners.value;
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
    const buttons=['backup-import','backup-export','backup-close','backup-account','backup-pass'].map(get);
    buttons.forEach(b=>b.disabled=true);
    status.textContent=importing?'选择要导入的备份文件…':'选择备份保存位置…';
    try {
      if(importing) {
        const result=await api.backupImport(password.value);
        if(!result){status.textContent='';return;}
        for(const [chat,text,mentions] of result.drafts) {
          const key=JSON.stringify([result.account,chat]);
          if(drafts.has(key)) continue;
          drafts.set(key,text);
          for(const span of mentions || []) mentionDrafts.add(key,text,span.start,span.label,span.id);
        }
        draftStore.persist(); accounts((await api.state()).accounts,result.account);
        await backupHistory.refresh(result.key);
        status.textContent=result.already?'这份备份已导入，可以查看记录。':'已导入 '+result.name+' 的账号和聊天记录。';
      } else {
        const items=[];
        for(const [key,text] of drafts) {
          const [id,chat]=JSON.parse(key);
          if(id===owners.value && chat && text.trim()) {
            const body=text.slice(0,4000);
            const spans=(mentionDrafts.sync(key,text)?.spans || []).filter(s=>body.startsWith(s.label,s.start));
            items.push([chat,body,spans]);
          }
        }
        const result=await api.backupExport(owners.value,password.value,items);
        if(!result){status.textContent='';return;}
        status.textContent='已导出 '+result.chats+' 个会话、'+result.messages+' 条消息'+(result.online?'':'（离线缓存）')+'。'+
          (result.missing ? result.missing+' 个附件原件无法取得。':'')+(result.pending ? result.pending+' 条消息尚无正文。':'');
      }
      password.value='';
    } catch(e){status.textContent=readable(e);}
    finally {busy=false; buttons.forEach(b=>b.disabled=false);get('backup-export').disabled=!owners.value;}
  }
  get('backup-import').onclick=()=>operate(true);get('backup-export').onclick=()=>operate(false);
})();
