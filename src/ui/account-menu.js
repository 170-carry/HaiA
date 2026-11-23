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
  get('account-details').onclick=()=>{ const owner=selected();menu.hidePopover();if(owner) ownProfile.open(owner.id); };
  return {open,selected,get target(){return target;}};
})();

