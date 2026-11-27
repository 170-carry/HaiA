const {detail}=require('./history/details.cjs');
function groupRoutes(desk) {
  function session(id,chat) {
    if (id !== desk.active || chat !== desk.thread?.chat || typeof chat !== 'string' || !chat.endsWith('@g.us')) throw new Error('请重新打开群聊');
    return desk.sessions.get(id);
  }
  return {
    async listGroups(id,chat) {
      const source=session(id,chat), identity=source.identity;
      const rows=await source.call('listGroups');
      if (identity!==source.identity || source.disposed) throw new Error('账号已切换');
      desk.inbox.conversations.index(id,rows);
      source.historyStore.directory(rows,true);
      return rows;
    },
    groupInfo:(id,chat)=>detail(session(id,chat),'groupInfo',chat),
    async groupMembers(id,chat,action,members) {
      const source=session(id,chat);
      const list=Array.isArray(members) ? [...new Set(members.map(m=>String(m).trim()))] : [];
      if (!['add','remove','promote','demote'].includes(action) || !list.length || list.length>50) throw new Error('请选择 1 到 50 位成员');
      // A member to add is either a contact picked from the list or a typed phone number.
      const known=m=>/^[\w.:-]{3,60}@(c\.us|lid|s\.whatsapp\.net)$/.test(m);
      const ids=list.map(m=>action==='add' && !known(m) ? m.replace(/[\s()+-]/g,'') : m);
      if (action==='add' ? ids.some(m=>!known(m) && !/^[1-9]\d{6,14}$/.test(m)) : ids.some(m=>!known(m))) throw new Error('请填写含国家区号的手机号');
      return source.call('groupMembers',chat,action,action==='add' ? ids.map(m=>known(m) ? m : m+'@c.us') : ids);
    },
    async groupInvite(id,chat,reset) {
      const result=await session(id,chat).call('groupInvite',chat,reset===true);
      const link=String(result?.link || '');
      if (!/^https:\/\/chat\.whatsapp\.com\/[\w-]{10,64}$/.test(link)) throw new Error('WhatsApp 没有返回邀请链接');
      return {link};
    },
    async updateGroup(id,chat,field,value) {
      const source=session(id,chat);
      if (!['subject','description'].includes(field) || typeof value !== 'string' ||
          (field === 'subject' && (!value.trim() || value.length>100)) || value.length>2048) throw new Error('请检查群资料的长度');
      await source.call('saveGroup',chat,field,value);
      if (field === 'subject' && !source.disposed && desk.active === id && desk.thread?.chat === chat) {
        source.historyStore.flag(chat,{title:value});
        desk.thread.title=value;
        const entry=desk.inbox.conversations.find(id,chat);
        if (entry) entry.title=value;
        desk.publish();
      }
    }
  };
}
module.exports={groupRoutes};

