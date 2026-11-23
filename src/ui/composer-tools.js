const composerTools = (() => {
  const picker = document.getElementById('emoji-picker'), proposal = document.getElementById('draft-proposal');
  let suggestion, revision = 0;
  const categories = [
    ['笑脸','😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😋 😎 🤔 😭 🥹 😮 😴'],
    ['手势','👋 🤚 ✋ 👌 ✌️ 🤞 🤟 🤝 👍 👎 👏 🙌 🙏 💪 👀 🫶 👍🏻 👍🏼 👍🏽 👍🏾 👍🏿'],
    ['爱心与符号','❤️ 🧡 💛 💚 💙 💜 🤍 🖤 💔 💕 💯 ✅ ❌ ⭐ 🎉 🔥 ✨ 🎁 📦 📍 📞 💬']
  ];
  function insert(emoji) {
    const field = get('reply');
    field.setRangeText(emoji,field.selectionStart,field.selectionEnd,'end');
    field.dispatchEvent(new Event('input')); picker.hidePopover(); field.focus();
  }
  for (const [label,items] of categories) {
    const group = el('div','emoji-grid');
    for (const emoji of items.split(' ')) {
      const button = el('button','',emoji); button.type='button'; button.onclick=()=>insert(emoji); group.append(button);
    }
    picker.append(el('h3','',label),group);
  }
  function reset() {
    revision++; suggestion=null; proposal.hidden=true; get('draft-translate').disabled=false;
    if (picker.matches(':popover-open')) picker.hidePopover();
  }
  get('reply').addEventListener('input',reset);
  get('draft-translate').onclick = async () => {
    const source=get('reply').value;
    if (!source.trim()) { warning('先输入要翻译的草稿'); get('reply').focus(); return; }
    if (chatTranslation.settings?.engine==='keyed' && !chatTranslation.settings.providers.some(p=>p.configured)) { openTranslationSettings(); return; }
    const ticket=++revision, key=route;
    get('draft-translate').disabled=true;
    try {
      const result = await api.translate(source,'draft');
      if (ticket !== revision || route !== key || get('reply').value !== source) return;
      if (translateKey.mode() === 'replace') {
        // Typed in as an edit, so undo brings the original wording back.
        const field=get('reply'); field.focus(); field.select();
        if (!document.execCommand('insertText',false,result.text)) { field.value=result.text; field.dispatchEvent(new Event('input')); }
        return;
      }
      suggestion=result.text; get('draft-result').textContent=result.text; proposal.hidden=false;
    } catch (e) { if (ticket === revision) warning(translationError(e)); }
    finally { if (ticket === revision) get('draft-translate').disabled=false; }
  };
  get('apply-draft').onclick = () => {
    if (suggestion !== null) { get('reply').value=suggestion; get('reply').dispatchEvent(new Event('input')); get('reply').focus(); }
  };
  get('dismiss-draft').onclick=reset;
  return {reset};
})();

