const groupPanel = (() => {
  const dialog=get('group-dialog'), panel=get('group-panel-body'), status=get('group-status');
  const labels={list:'群组列表',members:'群成员',invite:'邀请链接',settings:'群组设置'};
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
    if (manage) picker(rows);
    panel.append(list); draw();
  }
  // Members are added by picking contacts, or by typing phone numbers for people who are not contacts yet.
  function picker(members) {
    const form=el('form','member-add'), input=el('input'), add=el('button','primary','添加成员');
    const chips=el('div','member-picked'), found=el('div','member-found'), chosen=new Map(), inside=new Set(members.map(m=>m.id));
    input.type='search'; input.placeholder='搜索联系人，或输入含国家区号的手机号（多个用逗号分隔）'; input.setAttribute('aria-label','要添加的联系人或手机号');
    form.append(input,add);
    const phones=()=>input.value.split(/[,，;；\n]+/).map(p=>p.trim()).filter(p=>/^[1-9]\d{6,14}$/.test(p.replace(/[\s()+-]/g,'')));
    function drawChosen() {
      chips.replaceChildren(...[...chosen].map(([id,title])=>{
        const chip=el('button','member-chip',title); chip.type='button'; chip.title='移除 '+title; chip.append(icon('close'));
        chip.onclick=()=>{chosen.delete(id);drawChosen();find();};
        return chip;
      }));
      add.textContent=chosen.size ? '添加 '+chosen.size+' 位成员' : '添加成员';
    }
    let ticket=0,timer=null;
    async function find() {
      const mine=++ticket, term=input.value.trim(), owner=account;
      if (phones().length) { found.replaceChildren(); return; }
      try {
        const rows=await api.contacts(owner,term);
        if (mine!==ticket || owner!==account) return;
        found.replaceChildren(...rows.filter(row=>!chosen.has(row.chat) && !inside.has(row.chat)).slice(0,30).map(row=>{
          const button=el('button','person-result'), words=el('span',''); button.type='button';
          words.append(el('strong','',row.title),el('small','',row.phone ? '+'+row.phone : ''));
          button.append(avatar(row.title,row.chat,owner),words);
          button.onclick=()=>{ if (chosen.size>=50) { status.textContent='一次最多添加 50 位成员'; return; } chosen.set(row.chat,row.title); input.value=''; drawChosen(); find(); input.focus(); };
          return button;
        }));
        found.hidden=!found.children.length;
      } catch { /* The list of members below still works without suggestions. */ }
    }
    input.oninput=()=>{clearTimeout(timer);timer=setTimeout(find,200);};
    input.onfocus=()=>{ if (!found.children.length) find(); };
    form.onsubmit=event=>{
      event.preventDefault();
      const picked=[...chosen.keys(),...phones()];
      if (picked.length) change('add',picked,add); else status.textContent='请先选择联系人，或输入含国家区号的手机号';
    };
    found.hidden=true;
    panel.append(form,chips,found);
  }
  // The join link with its QR code. Resetting is asked twice because every copy already shared stops working.
  function invite(result,ticket) {
    const box=el('div','invite-box'), canvas=document.createElement('canvas'), link=el('input','invite-link'), tools=el('div','invite-tools');
    const draw=text=>{
      const cells=qrMatrix(text), quiet=4, scale=Math.max(4,Math.floor(264/(cells.length+quiet*2))), side=(cells.length+quiet*2)*scale, pen=canvas.getContext('2d');
      canvas.width=canvas.height=side; pen.fillStyle='#fff'; pen.fillRect(0,0,side,side); pen.fillStyle='#000';
      cells.forEach((row,y)=>row.forEach((on,x)=>{ if (on) pen.fillRect((x+quiet)*scale,(y+quiet)*scale,scale,scale); }));
      link.value=text;
    };
    link.readOnly=true; link.setAttribute('aria-label','群邀请链接'); canvas.className='invite-code'; canvas.setAttribute('role','img'); canvas.setAttribute('aria-label','群邀请二维码');
    link.onfocus=()=>link.select();
    const button=(label,work,kind)=>{ const b=el('button',kind || '',label); b.type='button'; b.onclick=()=>work(b); tools.append(b); return b; };
    button('复制链接',async()=>{ await navigator.clipboard.writeText(link.value); status.textContent='链接已复制'; },'primary');
    button('复制二维码',()=>canvas.toBlob(async blob=>{ try { await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]); status.textContent='二维码图片已复制，可直接粘贴发送'; } catch { status.textContent='复制失败，请改用"保存二维码"'; } }));
    button('保存二维码',()=>{ const a=document.createElement('a'); a.href=canvas.toDataURL('image/png'); a.download=(state.thread?.title || '群聊').replace(/[\\/:*?"<>|]/g,'_')+'-邀请二维码.png'; a.click(); });
    let armed=false;
    button('重置链接',async b=>{
      if (!armed) { armed=true; b.textContent='确认重置？旧链接和二维码将失效'; setTimeout(()=>{ if (b.isConnected) { armed=false; b.textContent='重置链接'; } },5000); return; }
      b.disabled=true;
      try { const next=await api.groupInvite(account,chat,true); if (ticket===revision) { draw(next.link); status.textContent='已重置，旧链接和二维码不再有效'; } }
      catch(e) { if (ticket===revision) status.textContent=translationError(e); }
      finally { armed=false; b.disabled=false; b.textContent='重置链接'; }
    },'danger-item');
    box.append(canvas,el('p','invite-note','扫描二维码或打开链接即可加入此群。请只发给你信任的人。'),link,tools);
    panel.append(box); draw(result.link);
  }
  async function change(action,members,button) {
    const ticket=revision; button.disabled=true;
    try {
      const failed=await api.groupMembers(account,chat,action,members);
      if (ticket!==revision) return;
      await open('members');
      status.textContent=failed?.length ? '未能添加：'+failed.map(p=>'+'+p).join('、')+'（对方可能限制了被拉入群聊，可以改为发送邀请链接）' : '成员已更新';
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
      const result=tab==='list' ? await api.listGroups(account,chat) : tab==='invite' ? await api.groupInvite(account,chat,false) : await api.groupInfo(account,chat);
      if(ticket!==revision || !dialog.open)return;
      status.textContent='';
      if(tab==='settings') settings(result,ticket);
      else if(tab==='invite') invite(result,ticket);
      else listRows(tab==='list' ? result : result.members,tab==='list',tab==='members' && result.manage);
    } catch(e){if(ticket===revision && dialog.open) status.textContent=translationError(e);}
  }
  dialog.onclose=()=>{revision++;panel.replaceChildren();};
  get('group-close').onclick=()=>dialog.close();
  for(const button of dialog.querySelectorAll('[data-group-tab]')) button.onclick=()=>open(button.dataset.groupTab);
  get('group-directory').onclick=()=>open('list');
  get('group-settings').onclick=()=>open('settings');
  return {route,open};
})();

