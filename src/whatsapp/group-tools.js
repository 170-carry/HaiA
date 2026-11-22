window.relayGroupTools = (() => {
  async function list() {
    const models = await WPP.chat.list({onlyGroups:true,ignoreGroupMetadata:true});
    return models.map(chat=>({chat:chat.id.toString(),title:chat.formattedTitle || chat.name || '群聊',
      time:(Number(chat.t)||0)*1000})).filter(row=>row.chat.endsWith('@g.us')).sort((a,b)=>b.time-a.time);
  }
  async function info(id) {
    const chat = await WPP.group.ensureGroup(id);
    const meta = chat.groupMetadata;
    const members = await WPP.group.getParticipants(id);
    const mine = WPP.conn.getMyUserId()?.toString();
    return {manage:members.some(p=>p.id.toString() === mine && (p.isAdmin || p.isSuperAdmin)), subject:meta?.subject || chat.formattedTitle || '',description:meta?.desc || '',
      editable:{subject:!!meta?.canSetSubject?.(),description:!!meta?.canSetDescription?.()},
      members:members.map(p=>({id:p.id.toString(),name:window.relayGroupMessage.sender({author:p.id}).name,admin:!!(p.isAdmin || p.isSuperAdmin)}))};
  }
  async function save(id,field,value) {
    const chat=await WPP.group.ensureGroup(id);
    const allowed = field === 'subject' ? chat.groupMetadata?.canSetSubject?.() : chat.groupMetadata?.canSetDescription?.();
    if (!allowed) throw new Error('当前账号没有修改群资料的权限');
    const ok=field === 'subject' ? await WPP.group.setSubject(id,value) : await WPP.group.setDescription(id,value);
    if (ok === false) throw new Error('WhatsApp 未接受这次更改');
    return true;
  }
  return {list,info,save};
})();

