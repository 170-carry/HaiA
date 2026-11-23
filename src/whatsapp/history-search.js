// Use the linked device's own WhatsApp text index without loading each chat into the inbox.
window.createHistorySearch = format => ({
  async searchHistory(term,chatId) {
    const remote = chatId && WPP.chat.get(chatId)?.id;
    if (chatId && !remote) throw new Error('当前会话不可用');
    const result = await WPP.whatsapp.msgFindSearch({searchTerm:term, count:80, ...(remote ? {remote} : {})});
    if (result.canceled || (result.status && ![200,404].includes(result.status))) throw new Error('WhatsApp 历史索引暂不可用');
    return result.messages.flatMap(msg => {
      const chat = msg.id?.remote?._serialized || msg.id?.remote?.toString();
      if (!chat || (chatId && chat !== chatId)) return [];
      let model;
      try { model = WPP.chat.get(chat); } catch { /* Archived chats can still have indexed messages. */ }
      const row = format(msg,model,false);
      if (!row || row.pendingText || row.system || row.type === 'revoked') return [];
      return [{id:row.id,chat,title:row.title,text:row.text,sender:row.sender,time:row.time,outgoing:row.outgoing,starred:row.starred}];
    });
  },
  async historyHit(chat,id) {
    const model = await WPP.chat.getMessageById(id);
    if ((model?.id?.remote?._serialized || model?.id?.remote?.toString()) !== chat) throw new Error('这条历史消息已不可用');
    return format(model,WPP.chat.get(chat),false);
  }
});
