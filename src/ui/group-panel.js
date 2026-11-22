const groupPanel = (() => {
  const dialog=get('group-dialog'), panel=get('group-panel-body'), status=get('group-status');
  const labels={list:'群组列表',members:'群成员',settings:'群组设置'};
  let account,chat,revision=0;
  function route(id,next) {
    if ((id!==account || next!==chat) && dialog.open) dialog.close();
    account=id; chat=next;
    get('group-directory').hidden=get('group-settings').hidden=!chat?.endsWith('@g.us');
  }
  function listRows(rows,groups,manage) {
    const search=el('input','group-search'); search.type='search'; search.placeholder=groups ? '搜索群名称' : '搜索成员';
    search.setAttribute('aria-label',search.placeholder);
    const list=el('div','group-rows');
    const draw=()=>{
      const query=search.value.trim().toLocaleLowerCase(), frag=document.createDocumentFragment();
      for (const row of rows) {
        const title=groups ? row.title : row.name;
        if (!title.toLocaleLowerCase().includes(query)) continue;
        const item=el(groups ? 'button' : 'div','group-row');
        item.append(avatar(title,row.chat || row.id,account),el('span','',title));
        if (groups) {
          if (row.chat===chat) item.append(el('small','','当前群聊'));
          item.onclick=()=>{ const id=account;dialog.close();run(()=>api.openChat(id,row.chat)); };
        } else {
          if (row.admin) item.append(el('small','','管理员'));
          if (manage && !row.self) {
            const tools=el('span','member-tools');
            for (const [label,action,danger] of [[row.admin ? '取消管理员' : '设为管理员',row.admin ? 'demote' : 'promote'],['移除','remove',true]]) {
              const button=el('button',danger ? 'danger-item' : '',label); button.type='button';
              button.onclick=()=>change(action,[row.id],button);
              tools.append(button);
            }
            item.append(tools);
          }
        }
        frag.append(item);
      }
      list.replaceChildren(frag);
      status.textContent=list.children.length ? '' : '没有匹配的结果';
    };
    search.oninput=draw; panel.append(search);
    if (manage) {
      const form=el('form','member-add'), input=el('input'), add=el('button','primary','添加成员');
      input.placeholder='手机号（含国家区号），多个用逗号分隔'; input.setAttribute('aria-label','要添加的成员手机号');
      form.append(input,add);
      form.onsubmit=event=>{ event.preventDefault(); const phones=input.value.split(/[,，;；\n]+/).map(p=>p.trim()).filter(Boolean); if (phones.length) change('add',phones,add); };
      panel.append(form);
    }
    panel.append(list); draw();
  }
  async function change(action,members,button) {
    const ticket=revision; button.disabled=true;
    try {
      const failed=await api.groupMembers(account,chat,action,members);
      if (ticket!==revision) return;
      await open('members');
      status.textContent=failed?.length ? '未能添加：'+failed.map(p=>'+'+p).join('、')+'（对方可能限制了被拉入群聊）' : '成员已更新';
    } catch(e) { if (ticket===revision) { status.textContent=translationError(e); button.disabled=false; } }
  }
  function settings(info,ticket) {
    for (const [field,title,limit] of [['subject','群名称',100],['description','群描述',2048]]) {
      const form=el('form','group-field'), label=el('label','',title);
      const input=el(field==='subject' ? 'input' : 'textarea');
      input.id='edit-group-'+field; label.htmlFor=input.id;
      input.maxLength=limit; input.value=info[field]; input.readOnly=!info.editable[field];
      form.append(label,input); panel.append(form);
      if (!info.editable[field]) continue;
      const save=el('button','primary','保存'+title); save.disabled=true;
      let original=input.value;
      function validate() {save.disabled=input.value===original || (field==='subject' && !input.value.trim());}
      input.oninput=validate; form.append(save);
      form.onsubmit=async event=>{
        event.preventDefault(); if(save.disabled)return;
        const value=field==='subject'?input.value.trim():input.value;
        input.disabled=save.disabled=true;
        try {
          await api.updateGroup(account,chat,field,value);
          if(ticket===revision){original=input.value=value;status.textContent=title+'已保存';}
        } catch(e) {if(ticket===revision)status.textContent=translationError(e);}
        finally {input.disabled=false;validate();}
      };
    }
    if (!Object.values(info.editable).some(Boolean)) status.textContent='当前账号可查看群资料。修改权限由 WhatsApp 群设置决定。';
  }
  async function open(tab) {
    if (!chat?.endsWith('@g.us')) return;
    const ticket=++revision;
    for(const button of dialog.querySelectorAll('[data-group-tab]')) button.setAttribute('aria-pressed',String(button.dataset.groupTab===tab));
    get('group-dialog-title').textContent=labels[tab];
    get('group-origin').textContent=tab==='list' ? state.accounts.find(a=>a.id===account)?.name : state.thread.title;
    panel.replaceChildren(); status.textContent='正在加载…';
    if(!dialog.open) dialog.showModal();
    try {
      const result=tab==='list' ? await api.listGroups(account,chat) : await api.groupInfo(account,chat);
      if(ticket!==revision || !dialog.open)return;
      status.textContent='';
      if(tab==='settings') settings(result,ticket);
      else listRows(tab==='list' ? result : result.members,tab==='list',tab==='members' && result.manage);
    } catch(e){if(ticket===revision && dialog.open) status.textContent=translationError(e);}
  }
  dialog.onclose=()=>{revision++;panel.replaceChildren();};
  get('group-close').onclick=()=>dialog.close();
  for(const button of dialog.querySelectorAll('[data-group-tab]')) button.onclick=()=>open(button.dataset.groupTab);
  get('group-directory').onclick=()=>open('list');
  get('group-settings').onclick=()=>open('settings');
  return {route};
})();

