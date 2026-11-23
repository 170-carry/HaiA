// Export only displayable records returned by the chat API.
window.createAccountBackupReader = format => ({
  async backupChats() {
    const chats = await WPP.chat.list({ignoreGroupMetadata:true});
    return chats.map(chat => ({chat:chat.id.toString(),title:String(chat.formattedTitle || chat.name || chat.id.user || chat.id),
      unread:Number(chat.unreadCount)||0})).filter(row=>/@(?:c\.us|s\.whatsapp\.net|g\.us|lid)$/.test(row.chat));
  },
  async backupMessages(chatId,before) {
    const chat=WPP.chat.get(chatId);
    const raw=await WPP.chat.getMessages(chatId,{count:100,id:before || undefined,direction:'before',includeCallMessages:true});
    const oldest=raw.reduce((a,b)=>!a || (b.t-a.t || Number(b.rowId)-Number(a.rowId))<0 ? b : a,null);
    return {rows:raw.map(m=>format(m,chat,false)).filter(Boolean),next:raw.length>=100 ? oldest?.id?._serialized : null};
  }
});
