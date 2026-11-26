// Compact account transfer UI. Password entry is only shown for older encrypted files.
(() => {
  const dialog=get('backup-dialog'), owners=get('backup-account'), password=get('backup-pass'), status=get('backup-status');
  const choices=get('backup-choices'), all=get('backup-all');
  let busy=false, importing=false,legacyPassword=false;
  const selected=()=>Array.from(choices.querySelectorAll('input:checked'),input=>input.value);
  function selectionChanged() {
    const boxes=[...choices.querySelectorAll('input:not(:disabled)')], count=selected().length;
    all.checked=boxes.length>0 && count===boxes.length;
    all.indeterminate=count>0 && count<boxes.length;
    all.disabled=!boxes.length;
    get('backup-export').disabled=busy || !count;
    get('backup-export').textContent=count?'导出所选账号（'+count+'）':'导出所选账号';
  }
  all.onchange=()=>{for(const input of choices.querySelectorAll('input:not(:disabled)')) input.checked=all.checked;selectionChanged();};
  choices.onchange=selectionChanged;
  // Only an account that is signed in has a login to carry over; the others are shown but cannot be ticked.
  function accounts(items,id) {
    owners.replaceChildren(...items.map(a=>new Option(a.name+(a.phone?' · +'+a.phone:''),a.id)));
    if(items.some(a=>a.id===id)) owners.value=id;
    const tones=accountTones(items);
    choices.replaceChildren(...items.map(a=>{
      const online=a.status==='online';
      const label=el('label','backup-account'+(online?'':' off')),input=document.createElement('input'),face=el('span','avatar '+tones.get(a.id)),words=el('span','backup-words');
      input.type='checkbox';input.value=a.id;input.disabled=!online;input.checked=online && a.id===id;
      face.append(avatarPhotos.face(a.id,'self'));
      words.append(el('strong','',a.name),el('small','',[a.linkedPhone || (a.phone?'+'+a.phone:''),online?'已登录':'未登录，无法导出'].filter(Boolean).join(' · ')));
      label.append(input,face,words);return label;
    }));
    if(!items.length) choices.append(el('p','detail-note','还没有账号。'));
    selectionChanged();
  }
  function mode(next) {
    importing=next;
    get('backup-tab-export').setAttribute('aria-selected',String(!next)); get('backup-tab-import').setAttribute('aria-selected',String(next));
    get('backup-owners').hidden=next;
    get('backup-export').hidden=next; get('backup-import').hidden=!next;
    legacyPassword=false;get('backup-password-field').hidden=true;password.value='';
    status.textContent=''; status.classList.remove('bad');
  }
  get('backup-tab-export').onclick=()=>{ if(!busy) mode(false); };
  get('backup-tab-import').onclick=()=>{ if(!busy) mode(true); };
  // Chat records imported with earlier versions stay readable, tucked away unless there are any.
  async function older(key) {
    const lists=await Promise.all(Array.from(owners.options,a=>api.backupList(a.value).catch(()=>[])));
    get('backup-old').hidden=!lists.some(list=>list.length);
    if(!get('backup-old').hidden) await backupHistory.refresh(key);
  }
  get('open-backup').onclick=()=>{
    accounts(state?.accounts || [],state?.active);
    mode(false); dialog.showModal(); run(()=>older());
  };
  owners.onchange=()=>run(()=>backupHistory.refresh());
  dialog.addEventListener('cancel',e=>{ if(busy)e.preventDefault(); });
  dialog.addEventListener('close',()=>{ password.value=''; });
  get('backup-close').onclick=()=>{ if(!busy) dialog.close(); };
  api.onBackupStatus(label=>{ if(busy)status.textContent=importing?'正在导入…':label; });
  const size=bytes=>bytes>=1048576?(bytes/1048576).toFixed(1)+' MB':Math.max(1,Math.round(bytes/1024))+' KB';
  async function operate() {
    if(busy) return;
    if(legacyPassword && password.value.length<8){status.classList.add('bad');status.textContent='请输入至少 8 个字符的旧文件密码';password.focus();return;}
    busy=true;
    const controls=['backup-import','backup-export','backup-close','backup-account','backup-pass','backup-owners','backup-tab-export','backup-tab-import'].map(get);
    controls.forEach(b=>b.disabled=true);
    status.classList.remove('bad');
    status.textContent=importing?'正在导入…':'选择保存位置…';
    try {
      if(importing) {
        const results=await api.backupImport(legacyPassword?password.value:undefined);
        if(results?.needsPassword){
          legacyPassword=true;get('backup-password-field').hidden=false;password.focus();
          status.textContent='这是旧版本加密文件，请输入原密码继续导入。';return;
        }
        if(!results){status.textContent='';return;}
        if(results.login) {
          const done=results.login.filter(r=>r.account && !r.skipped);
          status.textContent='导入完成';
          accounts((await api.state()).accounts,done[0]?.account || results.login[0]?.account);
        } else {
          // A file made by an earlier version holds chat records to read, not a login.
          for(const result of results) for(const [chat,text,mentions] of result.drafts) {
            const key=JSON.stringify([result.account,chat]);
            if(drafts.has(key)) continue;
            drafts.set(key,text);
            for(const span of mentions || []) mentionDrafts.add(key,text,span.start,span.label,span.id);
          }
          draftStore.persist(); accounts((await api.state()).accounts,results[0].account);
          await older(results[0].key); get('backup-old').open=true;
          status.textContent='导入完成';
        }
      } else {
        const result=await api.backupExport(selected());
        if(!result){status.textContent='';return;}
        status.textContent='已导出 '+result.accounts+' 个账号（'+size(result.size)+'）';
      }
      password.value='';
    } catch(e){status.textContent=readable(e);status.classList.add('bad');}
    finally {busy=false; controls.forEach(b=>b.disabled=false);selectionChanged();}
  }
  get('backup-import').onclick=get('backup-export').onclick=operate;
})();
