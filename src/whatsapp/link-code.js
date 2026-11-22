// Lifecycle is owned by WhatsApp in this account's isolated page.
(() => {
  let state = 'idle', code = '', epoch = 0;
  function clear(next = 'idle') { epoch++; state = next; code = ''; }
  function update(value) {
    const normalized = String(value || '').replace(/[\s-]/g,'').toUpperCase();
    if (/^[A-Z0-9]{8}$/.test(normalized)) { state = 'code'; code = normalized; }
    else clear('failed');
  }
  window.relayPairing = {
    listen() {
      WPP.on('conn.link_code_change', update);
      WPP.on('conn.link_code_expired', () => clear('expired'));
      WPP.on('conn.link_code_error', () => clear('failed'));
      WPP.on('conn.authenticated', () => clear());
      WPP.on('conn.logout', () => clear());
    },
    status() { return {state, code}; },
    async request(phone) {
      if (!WPP.loader.isReady || WPP.conn.isAuthenticated()) throw new Error('配对服务尚未就绪');
      clear('pending');
      const requestEpoch = epoch;
      try {
        const value = await WPP.conn.startLinkDeviceCodeForPhoneNumber(phone, false);
        if (epoch !== requestEpoch) return;
        if (state === 'pending') update(value);
        if (state !== 'code') throw new Error();
      } catch { if (epoch === requestEpoch) clear('failed'); throw new Error('无法获取关联码，请检查号码后重试'); }
    },
    cancel() { WPP.conn.cancelLinkDeviceCode(); clear(); }
  };
})();
