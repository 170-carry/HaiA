// Hover tools on a message: react, reply, copy, edit, save, revoke and delete.
const messageActions = (() => {
  const menu = get('message-menu'), quick = ['👍','❤️','😂','😮','😢','🙏'];
  let target = null;
  function find(id) { return state?.messages.find(m=>m.id === id); }
  function place(anchor) {
    if (!menu.matches(':popover-open')) menu.showPopover();
    const box = anchor.getBoundingClientRect(), own = menu.getBoundingClientRect();
    menu.style.left = Math.max(8,Math.min(box.left,innerWidth-own.width-8))+'px';
    menu.style.top = (box.bottom+own.height+8 > innerHeight ? Math.max(8,box.top-own.height-4) : box.bottom+4)+'px';
    menu.querySelector('button')?.focus({preventScroll:true});
  }
  function act(work) { menu.hidePopover(); return run(work); }
  function item(symbol,label,work,danger) {
    const button = el('button',danger ? 'danger-item' : '');
    button.type = 'button'; button.setAttribute('role','menuitem');
    button.append(icon(symbol),label); button.onclick = work;
    return button;
  }
  function react(message,emoji) {
    const mine = message.reactions?.some(r=>r.mine && r.emoji === emoji);
    return run(()=>api.react(message.accountId,message.chat,message.id,mine ? '' : emoji));
  }
  function openReactions(message,anchor) {
    const row = el('div','reaction-picker');
    for (const emoji of quick) {
      const button = el('button','',emoji);
      button.type = 'button'; button.setAttribute('aria-label','回应 '+emoji);
      button.setAttribute('aria-pressed',String(!!message.reactions?.some(r=>r.mine && r.emoji === emoji)));
      button.onclick = () => { menu.hidePopover(); react(message,emoji); };
      row.append(button);
    }
    menu.replaceChildren(row); place(anchor);
  }
  function openMore(message,anchor) {
    const items = [item('reply','回复',()=>{ menu.hidePopover(); composerExtras.reply(message); })];
    items.push(item('forward','转发',()=>{ menu.hidePopover(); forwardPicker.open(message); }));
    if (message.text && (!message.media || message.media.caption)) items.push(item('copy','复制文字',()=>act(async()=>{
      await navigator.clipboard.writeText(message.text); warning('已复制');
    })));
    if (message.media && !message.media.once) items.push(item('download','保存到电脑',()=>{ menu.hidePopover(); messageMedia.save(message); }));
    // WhatsApp accepts edits for about 15 minutes after sending.
    if (message.outgoing && !message.media && ['chat','text',''].includes(message.type) && Date.now()-message.time < 14*60000) {
      items.push(item('edit','编辑',()=>{ menu.hidePopover(); composerExtras.edit(message); }));
    }
    if (message.outgoing) items.push(item('refresh','撤回',()=>{
      menu.hidePopover();
      confirmAction('撤回消息','对方和你都将看不到这条消息的内容。','撤回',()=>api.removeMessage(message.accountId,message.chat,message.id,true));
    },true));
    items.push(item('trash','为我删除',()=>{
      menu.hidePopover();
      confirmAction('删除消息','只从你的 WhatsApp 中删除这条消息，对方仍然可以看到。','删除',()=>api.removeMessage(message.accountId,message.chat,message.id,false));
    },true));
    menu.replaceChildren(...items); place(anchor);
  }
  function confirmAction(title,detail,label,work) {
    get('action-title').textContent = title; get('action-detail').textContent = detail;
    get('action-confirm').textContent = label;
    get('action-confirm').onclick = () => { get('confirm-action').close(); run(work); };
    get('confirm-action').showModal();
  }
  get('action-cancel').onclick = () => get('confirm-action').close();
  function tools(message) {
    const bar = el('div','message-tools');
    for (const [act,symbol,label] of [['react','smile','表情回应'],['reply','reply','回复'],['more','more','更多操作']]) {
      const button = el('button');
      button.type = 'button'; button.dataset.act = act; button.title = label; button.setAttribute('aria-label',label);
      button.append(icon(symbol)); bar.append(button);
    }
    return bar;
  }
  function reactions(message) {
    const row = el('div','reactions');
    for (const reaction of message.reactions) {
      const chip = el('button',reaction.mine ? 'mine' : '',reaction.emoji+(reaction.count > 1 ? ' '+reaction.count : ''));
      chip.type = 'button'; chip.dataset.emoji = reaction.emoji;
      chip.title = reaction.mine ? '取消回应' : '同样回应';
      row.append(chip);
    }
    return row;
  }
  get('bubbles').addEventListener('click',event => {
    const row = event.target.closest('.message[data-id]'), message = row && find(row.dataset.id);
    if (!message) return;
    const tool = event.target.closest('[data-act]'), chip = event.target.closest('.reactions button'), quote = event.target.closest('.quote');
    if (chip) react(message,chip.dataset.emoji);
    else if (quote) {
      const origin = get('bubbles').querySelector('[data-stanza="'+CSS.escape(message.quote.id)+'"]');
      if (!origin) { warning('被引用的消息尚未加载'); return; }
      origin.scrollIntoView({block:'center',behavior:'smooth'});
      origin.classList.add('found'); setTimeout(()=>origin.classList.remove('found'),1600);
    } else if (tool?.dataset.act === 'reply') composerExtras.reply(message);
    else if (tool?.dataset.act === 'react') openReactions(message,tool);
    else if (tool?.dataset.act === 'more') openMore(message,tool);
  });
  get('bubbles').addEventListener('contextmenu',event => {
    const row = event.target.closest('.message[data-id]'), message = row && find(row.dataset.id);
    if (!message || getSelection().toString()) return;
    event.preventDefault(); openMore(message,row.querySelector('.message-body'));
  });
  menu.onkeydown = event => {
    const buttons = [...menu.querySelectorAll('button')], i = buttons.indexOf(document.activeElement);
    const step = {ArrowDown:1,ArrowRight:1,ArrowUp:-1,ArrowLeft:-1}[event.key];
    if (step) { event.preventDefault(); buttons[(i+step+buttons.length)%buttons.length].focus(); }
  };
  return {tools,reactions};
})();
