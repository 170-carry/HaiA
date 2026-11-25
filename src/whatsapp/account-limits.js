// Restrictions WhatsApp has placed on this number, read from WhatsApp Web's own records. Nothing here changes or avoids them.
window.relayLimits = (() => {
  const key = 'WAReachoutTimelockState', every = 600000;
  let asked = 0;
  const part = name => { try { return window.require(name); } catch { return null; } };
  // WhatsApp pushes changes itself; asking now and then covers a change that happened while this computer was off.
  function refresh() {
    if (Date.now() - asked < every) return;
    asked = Date.now();
    try { void part('WAWebGetReachoutTimelockJob')?.fetchReachoutTimelock?.().catch(() => {}); } catch { /* Not available on this build. */ }
  }
  // "Reachout timelock": the number may not start chats with people it has not talked to, until the given time.
  function take() {
    refresh();
    let record = null;
    try { record = part('WAWebUserPrefsIndexedDBStorage')?.userPrefsIdb?.get(key) || null; } catch { /* Not available on this build. */ }
    const until = Number(record?.time_enforcement_ends) || 0;
    if (!record || record.is_active === false) return null;
    return {kind:'new-chats', until:until || null, type:String(record.enforcement_type ?? '').slice(0,60)};
  }
  return {take};
})();
