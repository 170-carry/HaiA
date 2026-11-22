// Opens the real pairing screen in a disposable profile. No account is linked.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-pair-'));
app.setPath('userData', dir);
require('../src/main/app.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  await app.whenReady();
  await delay(1100);
  const shell = BrowserWindow.getAllWindows()[0].webContents;
  await shell.executeJavaScript("window.desk.add('配对测试')");
  for (let i=0; i<50; i++) {
    await delay(1500);
    const status = await shell.executeJavaScript("window.desk.state().then(s=>({status:s.accounts[0].status,qr:s.qr.startsWith('data:image/png'),visible:!document.querySelector('#qr').hidden}))");
    if (status.qr && status.visible) {
      console.log('PASS: QR rendered in custom account screen');
      if (process.env.RELAY_LIVE_CODE === '1') {
        // NANPA reserves 555-0100 through 0199 as non-working numbers. Push is disabled.
        await shell.executeJavaScript("document.getElementById('code-mode').click();document.getElementById('phone').value='+1 202 555 0144';document.getElementById('phone-form').requestSubmit()");
        for (let attempt=0; attempt<30; attempt++) {
          await delay(1000);
          const result=await shell.executeJavaScript("({shown:!document.getElementById('link-code').hidden && /^[A-Z0-9]{4} – [A-Z0-9]{4}$/.test(document.getElementById('link-code').textContent), failed:document.getElementById('link-status').textContent.includes('失败') || document.getElementById('link-status').textContent.includes('无法获取')})");
          if (result.shown) {console.log('PASS: live eight-character code shown for reserved test number; no phone linked');app.exit(0);return;}
          if (result.failed) throw new Error('Live provider rejected code request');
        }
        throw new Error('No live pairing code before timeout');
      }
      app.exit(0); return;
    }
    if (i % 10 === 0) console.log('Pairing state', status.status);
  }
  throw new Error('No QR before timeout');
})().catch(err => { console.error(err.message); app.exit(1); });
