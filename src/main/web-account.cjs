const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const { normalizePairingPhone } = require('../shared/phone-number.js');

const WEB = 'https://web.whatsapp.com';
function trusted(url) {
  try { return new URL(url).origin === WEB; } catch { return false; }
}
const pairingScript = fs.readFileSync(path.join(__dirname, '../whatsapp/pairing.js'), 'utf8');
let adapter;
function adapterSource() {
  if (!adapter) {
    const file = app.isPackaged ? path.join(process.resourcesPath, 'wa-js/dist/wppconnect-wa.js') : require.resolve('@wppconnect/wa-js');
    adapter = 'window.WPPConfig = {disableGoogleAnalytics:true,deviceName:false,linkPreviewApiServers:null};\n' +
      fs.readFileSync(file, 'utf8') + '\n;' + fs.readFileSync(path.join(__dirname, '../whatsapp/link-code.js'), 'utf8') + '\n;' + ['../shared/phone-number.js','preview-history.js','chat-index.js','contact-search.js','message-recovery.js','history-transfer.js','profile-photo.js','group-message.js','group-tools.js','system-notices.js','message-extras.js','contact-details.js','history-search.js','backup.js','private-timer.js','more-tools.js','own-profile.js','page.js'].map(name => fs.readFileSync(path.join(__dirname, '../whatsapp', name), 'utf8')).join('\n;') + '\n;true';
  }
  return adapter;
}

class WebAccount {
  constructor(account, onBatch) {
    this.account = account;
    this.status = 'loading';
    this.more = false;
    this.historyError = false;
    this.ready = false;
    this.disposed = false;
    this.generation = 0;
    this.ses = session.fromPartition('persist:wa-' + account.id);
    // Calls run inside WhatsApp's own page, which needs the microphone and camera. Everything else stays denied.
    this.ses.setPermissionCheckHandler((_contents, permission, origin) => permission === 'media' && trusted(origin));
    this.ses.setPermissionRequestHandler((contents, permission, done) => done(permission === 'media' && trusted(contents.getURL())));
    this.view = new BrowserWindow({ show: false, width: 1100, height: 780, skipTaskbar: true, paintWhenInitiallyHidden: true, webPreferences: {
      session: this.ses, sandbox: true, nodeIntegration: false, contextIsolation: true, backgroundThrottling: false
    }});
    this.view.on('close', event => { if (!this.disposed) { event.preventDefault(); this.view.hide(); } });
    const wc = this.view.webContents;
    // WhatsApp's browser selector expects the standard UA of the underlying Chromium engine.
    const platform = process.platform === 'win32' ? 'Windows NT 10.0; Win64; x64' : 'Macintosh; Intel Mac OS X 10_15_7';
    const ua = 'Mozilla/5.0 (' + platform + ') AppleWebKit/537.36 (KHTML, like Gecko) Chrome/' +
      process.versions.chrome.split('.')[0] + '.0.0.0 Safari/537.36';
    this.ses.setUserAgent(ua);
    wc.setUserAgent(ua);
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    for (const event of ['will-navigate', 'will-redirect']) wc.on(event, (ev, url) => {
      if (!trusted(typeof url === 'string' ? url : url?.url)) ev.preventDefault();
    });
    const update = status => { this.watch(status); onBatch(this, { status, messages: [] }); };
    wc.on('did-start-navigation', (_ev, details, isInPlace, isMainFrame) => {
      // Current Electron passes details alongside the legacy positional args.
      if (typeof details === 'object' ? (!details.isMainFrame || details.isSameDocument) : (!isMainFrame || isInPlace)) return;
      this.generation++;
      this.ready = false;
      update('loading');
    });
    wc.on('dom-ready', async () => {
      const generation = this.generation;
      if (!trusted(wc.getURL())) return;
      try {
        await wc.executeJavaScript(adapterSource());
        if (generation === this.generation) this.ready = true;
      } catch {
        if (!this.disposed && generation === this.generation) update('adapter-error');
      }
    });
    wc.on('did-fail-load', (_ev, code, _msg, _url, main) => {
      if (main && code !== -3) update('offline');
    });
    wc.on('render-process-gone', () => { this.ready = false; update('offline'); });
    this.poll = setInterval(async () => {
      if (this.busy || this.disposed || wc.isDestroyed() || !trusted(wc.getURL())) return;
      const generation = this.generation;
      this.busy = true;
      try {
        const batch = this.ready ? await wc.executeJavaScript('window.relayReader.take()') : {status:this.status, messages:[]};
        if (['loading', 'pair', 'adapter-error'].includes(batch.status)) {
          batch.qr = await wc.executeJavaScript(pairingScript);
          if (batch.qr) batch.status = 'pair';
        }
        if (!this.disposed && generation === this.generation) { this.watch(batch.status); onBatch(this, batch); }
      } catch {
        if (!this.disposed && generation === this.generation) update('adapter-error');
      } finally { this.busy = false; }
    }, 1200);
    this.load();
  }
  // A failed connection is retried on its own: after 5 s, then 15 s, 30 s, 1 min and every 2 min.
  watch(status) {
    if (['offline','adapter-error'].includes(status)) {
      if (this.retry || this.disposed) return;
      const delay = [5,15,30,60,120][Math.min(this.attempts || 0,4)] * 1000;
      this.retry = setTimeout(() => { this.retry = null; this.attempts = (this.attempts || 0) + 1; if (!this.disposed) this.load(); }, delay);
    } else if (status === 'online' || status === 'pair') {
      this.attempts = 0;
      clearTimeout(this.retry); this.retry = null;
    }
  }
  load() {
    this.view.webContents.loadURL(WEB + '/').catch(() => {});
  }
  async pair(phone) {
    const wc = this.view.webContents;
    if (!this.ready || this.status !== 'pair' || this.disposed || !trusted(wc.getURL())) throw new Error('请等待配对页面就绪');
    if (phone === null) {
      await wc.executeJavaScript('window.relayPairing.cancel()');
      this.load();
      return;
    }
    const digits = normalizePairingPhone(phone);
    if (!digits) throw new Error('请输入包含国家区号的手机号');
    if (this.requestingCode) throw new Error('正在获取关联码');
    this.requestingCode = true;
    try {
      await wc.executeJavaScript('window.relayPairing.request(' + JSON.stringify(digits) + ')');
    } catch { throw new Error('未能获取关联码，请确认手机号并重试'); }
    finally { this.requestingCode = false; }
  }
  async moreHistory() {
    if (this.ready && this.more) await this.view.webContents.executeJavaScript('window.relayReader.more()');
  }
  async call(method, ...args) {
    if (!this.ready || this.status !== 'online' || !trusted(this.view.webContents.getURL())) throw new Error('账号尚未连接');
    try {
      return await this.view.webContents.executeJavaScript('window.relayReader.' + method + '(...' + JSON.stringify(args) + ')');
    } catch (error) {
      // The adapter throws Chinese messages on purpose. Anything else comes from WhatsApp's own code and is explained instead of shown raw.
      const text = String(error?.message || '').replace(/^.*?Error: /,'');
      if (/[\u4e00-\u9fff]/.test(text)) throw new Error(text);
      const known = [[/not a business/i,'此功能仅支持 WhatsApp Business 账号'],[/not.*(participant|member)|forbidden|not.?authorized|403/i,'当前账号没有执行此操作的权限'],
        [/not.?found|does not exist|404/i,'没有找到对应的会话或消息，可能已被删除'],[/time.?out/i,'WhatsApp 响应超时，请稍后重试'],[/rate|too many|429/i,'操作过于频繁，请稍后再试']]
        .find(([pattern]) => pattern.test(text));
      throw new Error(known ? known[1] : 'WhatsApp 未能完成此操作，请稍后重试' + (text ? '（' + text.slice(0,80) + '）' : ''));
    }
  }
  // Video is drawn by WhatsApp's own call screen, so the hidden page is shown for it.
  reveal() {
    this.view.setTitle('WhatsApp · ' + this.account.name);
    this.view.show();
    this.view.focus();
  }
  close() {
    this.disposed = true;
    clearTimeout(this.retry);
    clearInterval(this.poll);
    this.view.destroy();
  }
}
module.exports = { WebAccount };
