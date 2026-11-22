(() => {
  let target;
  const dialog=get('confirm-remove');
  get('remove').onclick=()=>{
    const owner=accountMenu.selected();
    get('menu').hidePopover();
    if (!owner) return;
    target=owner.id;
    get('remove-detail').textContent='移除「'+owner.name+'」会清除这台电脑上的登录状态和消息预览。';
    dialog.showModal();
  };
  get('remove-cancel').onclick=()=>dialog.close();
  get('remove-confirm').onclick=()=>{const id=target;dialog.close();if(id)run(()=>api.remove(id));};
  dialog.onclose=()=>{target=null;};
})();

