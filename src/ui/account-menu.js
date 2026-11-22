const accountMenu=(() => {
  const menu=get('menu');
  let target=null;
  function selected(){return state?.accounts.find(item=>item.id===target);}
  function open(id,button){
    target=id;
    for (const other of get('accounts').querySelectorAll('[data-menu-owner]')) delete other.dataset.menuOwner;
    button.dataset.menuOwner='true';
    get('menu-account').textContent=selected()?.name || '';
    if(!menu.matches(':popover-open')) menu.showPopover();
    get('account-details').focus({preventScroll:true});
  }
  menu.addEventListener('toggle',event=>{
    if(event.newState==='closed' && !menu.matches(':popover-open')){
      target=null;
      for (const other of get('accounts').querySelectorAll('[data-menu-owner]')) delete other.dataset.menuOwner;
    }
  });
  menu.onkeydown=event=>{
    const buttons=[...menu.querySelectorAll('button')],i=buttons.indexOf(document.activeElement);
    if(event.key==='ArrowDown' || event.key==='ArrowUp'){
      event.preventDefault();buttons[(i+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length].focus();
    } else if(event.key==='Escape') {
      const trigger=get('accounts').querySelector('[data-menu-owner]');
      menu.hidePopover();trigger?.focus({preventScroll:true});
    }
  };
  get('reload').onclick=()=>{const owner=selected();menu.hidePopover();if(owner)run(()=>api.reload(owner.id));};
  get('account-details').onclick=()=>{
    const owner=selected();menu.hidePopover();if(!owner)return;
    get('account-photo').className='avatar '+tone(owner.id);
    get('account-photo').replaceChildren(avatarPhotos.face(owner.id,'self'));
    get('account-name').textContent=owner.name;
    get('account-phone').textContent=owner.linkedPhone || '尚无已关联手机号';
    get('account-connection').textContent=statusText[owner.status] || owner.status;
    get('account-dialog').showModal();
  };
  get('account-close').onclick=()=>get('account-dialog').close();
  return {open,selected,get target(){return target;}};
})();

