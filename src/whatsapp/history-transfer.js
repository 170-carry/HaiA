window.createHistoryTransfer = function () {
  const attempts = new Map();
  return async function requestHistory(chat) {
    if (chat?.endOfHistoryTransferType !== 0) return;
    const id = chat.id.toString();
    if ((attempts.get(id) || 0) > Date.now()) return;
    attempts.set(id,Date.now()+120000);
    try {
      const history = window.require?.('WAWebSendNonMessageDataRequest');
      await history?.sendPeerDataOperationRequest(3,{chatId:chat.id});
    } catch { /* Local model updates and bounded lookups continue if transfer is unavailable. */ }
  };
};

