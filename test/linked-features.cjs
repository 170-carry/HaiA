const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function readOnArrival({window, page, ui, call, until, Notification, pause}) {
  const isFocused = window.isFocused, show = Notification.prototype.show, shown = [];
  let foreground = true;
  window.isFocused = () => foreground;
  Notification.prototype.show = function () { shown.push(this.title); };
  try {
    await page.executeJavaScript("sample('正在看的会话里的新消息','focus-read-1');true");
    await until(()=>ui("get('bubbles').textContent.includes('正在看的会话里的新消息')"));
    await until(()=>page.executeJavaScript("chats.get('demo@c.us').unreadCount===0"));
    await until(async()=>(await call('state')).feed.messages.find(m=>m.chat==='demo@c.us').unreadCount===0);
    assert.deepEqual(shown,[]);
    foreground = false;
    await page.executeJavaScript("sample('后台收到','focus-read-2');true");
    await until(async()=>(await call('state')).feed.messages.find(m=>m.chat==='demo@c.us').unreadCount>0);
    await pause(650);
    assert.ok(await page.executeJavaScript("chats.get('demo@c.us').unreadCount>0"));
    foreground = true;
    window.emit('focus');
    await until(()=>page.executeJavaScript("chats.get('demo@c.us').unreadCount===0"));
    console.log('PASS: foreground arrival marks read, background arrival stays unread until focus returns');
  } finally { window.isFocused = isFocused; Notification.prototype.show = show; }
}
async function captureStatus(shell, dir) {
  if (!dir) return;
  fs.mkdirSync(dir,{recursive:true});
  const bounds = await shell.executeJavaScript("(() => {const r=document.getElementById('status-dialog').getBoundingClientRect();return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(r.height)}})()");
  fs.writeFileSync(path.join(dir,'status.png'),(await shell.capturePage(bounds)).toPNG());
}

async function crossAccount({call,a,b,me,other,chat,pixel}) {
  for (const [name,data,caption] of [['样品.png',pixel,'原图说明'],['报价.pdf','data:application/pdf;base64,JVBERi0xLjQK','文档说明']]) {
    await call('sendFile',me,chat,{name,data,caption});
    const id = await a.executeJavaScript('rows.findLast(m=>m.filename==='+JSON.stringify(name)+' && m.caption==='+JSON.stringify(caption)+').id._serialized');
    await call('forward',me,chat,id,'demo@c.us',other);
    const file = await b.executeJavaScript('window.lastUpload');
    assert.equal(file.name,name); assert.equal(file.caption,caption);
    assert.equal(file.base64,data.split(',')[1]);
    assert.equal(file.chat,'demo@c.us');
  }
}
module.exports={readOnArrival,captureStatus,crossAccount};
