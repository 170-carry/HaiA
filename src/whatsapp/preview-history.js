// The initial read is small. Older pages are needed only when the newer records have no preview.
window.relayPreviewHistory = (() => {
  async function readPage(chat, before) {
    try {
      const recent = await WPP.chat.getMessages(chat.id, {count:before ? 32 : 2, id:before, direction:'before'});
      if (recent.length || before) return recent;
    } catch (error) {
      if (before) throw error;
      // A new conversation may expose its last key before the first page is available.
    }
    const key = chat.lastReceivedKey?._serialized;
    if (!key) return [];
    const last = await WPP.chat.getMessageById(key);
    return last?.id ? [last] : [];
  }
  function oldestId(rows) {
    let oldest = rows[0];
    for (const row of rows) {
      if (row.time < oldest.time || (row.time === oldest.time && row.rowId != null &&
          (oldest.rowId == null || row.rowId < oldest.rowId))) oldest = row;
    }
    return oldest.id;
  }
  return {readPage, oldestId};
})();
