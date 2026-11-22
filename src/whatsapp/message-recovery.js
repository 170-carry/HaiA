// WhatsApp Web can expose a message key before its text is decrypted.
window.createMessageRecovery = function (resolve, deliver) {
  const waiting = new Map();
  let busy = false;
  return {
    includes(id) { return waiting.has(id); },
    observe(row) {
      if (!row.pendingText) { waiting.delete(row.id); return; }
      if (!waiting.has(row.id)) waiting.set(row.id,{chat:row.chat,at:Date.now()+5000,delay:5000});
    },
    async tick() {
      if (busy) return;
      busy = true;
      try {
        let attempts = 0;
        for (const [id, task] of waiting) {
          if (attempts >= 4) break;
          if (task.at > Date.now()) continue;
          attempts++;
          task.delay = Math.min(task.delay * 2,120000);
          task.at = Date.now() + task.delay;
          try {
            const row = await resolve(id,task.chat);
            if (row && !row.pendingText && waiting.get(id) === task) {
              waiting.delete(id);
              deliver(row);
            }
          } catch { /* The linked device can still be waiting for its key. */ }
        }
      } finally { busy = false; }
    }
  };
};
