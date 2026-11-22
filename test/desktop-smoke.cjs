const { app, BrowserWindow, webContents, Notification, session } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const dir = process.argv[2], phase = process.argv[3];
if (!dir || !['first','restart'].includes(phase)) throw new Error('需要临时测试目录和阶段');
app.setPath('userData', dir);
app.on('session-created', ses => {
  if (ses !== session.defaultSession) ses.protocol.handle('https', () => new Response('<html><body>local fixture</body></html>',{ headers:{'Content-Type':'text/html'} }));
});
const realRead = fs.readFileSync, bundle = require.resolve('@wppconnect/wa-js');
fs.readFileSync = function(file,...args) {
  return realRead.call(fs,file === bundle ? path.join(__dirname,'mock-provider.js') : file,...args);
};
const notices = [];
Notification.prototype.show = function() { notices.push(this); };
// Use an isolated vault and deterministic responses so UI tests never transmit messages.
const translation = require('../src/main/translation/service.cjs');
const createRoutes = translation.translationRoutes;
translation.translationRoutes = directory=>createRoutes(directory,{
  isEncryptionAvailable:()=>true,encryptString:v=>Buffer.from(v),decryptString:b=>b.toString()
},async (url,req)=>{
  if (url.includes('deepl')) return new Response('',{status:429});
  const source = JSON.parse(req.body)[0].Text;
  return Response.json([{translations:[{text:source === 'Ready for review' ? '可以开始审核了。' : '测试译文 '+source}]}]);
});
require('../src/main/app.cjs');
const pause = ms => new Promise(r => setTimeout(r,ms));
async function until(fn) {
  for (let i=0;i<120;i++) { const value=await fn(); if (value) return value; await pause(120); }
  throw new Error('Timed out: ' + fn.toString());
}
(async () => {
  await app.whenReady();
  const shell = await until(() => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('file:'))?.webContents);
  await until(() => shell.getURL().startsWith('file:'));
  const call = (name,...args) => shell.executeJavaScript('window.desk.'+name+'(...'+JSON.stringify(args)+')');
  if (phase === 'first') {
    if (process.env.RELAY_UI_CAPTURE) {
      require('electron').nativeTheme.themeSource = 'light';
      await until(()=>shell.executeJavaScript("!document.getElementById('welcome').hidden && document.getElementById('first').checkVisibility()"));
      await pause(550);
      fs.writeFileSync(path.join(process.env.RELAY_UI_CAPTURE,'welcome.png'),(await shell.capturePage()).toPNG());
      await shell.executeJavaScript("document.getElementById('first').click()");
      assert.equal(await shell.executeJavaScript("document.activeElement.id"), 'name');
      await pause(120);
      fs.writeFileSync(path.join(process.env.RELAY_UI_CAPTURE,'account.png'),(await shell.capturePage()).toPNG());
      await shell.executeJavaScript("document.getElementById('cancel').click()");

    }
    await call('add','销售 A'); await call('add','客服 B'); }
  const accounts=(await call('state')).accounts;
  assert.equal(accounts.length,2);
  const [a,b] = accounts.map(item=> webContents.getAllWebContents().find(w=>w.session===session.fromPartition('persist:wa-'+item.id)));
  await until(async ()=>(await a.executeJavaScript('typeof sample'))==='function' && (await b.executeJavaScript('typeof sample'))==='function');
  if (phase==='first') {
    await until(async ()=>(await call('state')).accounts.every(acc=>acc.status==='pair'));
    await until(()=>shell.executeJavaScript("document.querySelector('#code-mode').checkVisibility() && document.querySelector('#reader-title').textContent==='客服 B'"));
    await shell.executeJavaScript("document.querySelector('#code-mode').click();document.querySelector('#phone').value='＋１　２０２\u202f555\u200b0144';document.querySelector('#phone-form').requestSubmit()");
    await until(()=>shell.executeJavaScript("document.querySelector('#link-code').textContent==='ABCD – 1234'"));
    if (process.env.RELAY_UI_CAPTURE) {
      await pause(120);
      fs.writeFileSync(path.join(process.env.RELAY_UI_CAPTURE,'pairing.png'),(await shell.capturePage()).toPNG());
    }
    await call('select',accounts[0].id);
    await until(()=>shell.executeJavaScript("document.querySelector('#link-code').hidden && !document.querySelector('#link-code').textContent"));
    await a.executeJavaScript("localStorage.owner='one';sample('可以发我一份最新的产品目录吗？','same')");
    await b.executeJavaScript("localStorage.owner='two';sample('刚收到包裹了，谢谢你。','same')");
    await call('select',null);
    await until(async ()=>(await call('state')).count===2);
    await until(()=>notices.length===2);
    assert.deepEqual((await call('state')).messages.map(m=>m.unreadCount),[1,1]);
    notices.find(n=>n.title.startsWith('客服 B')).emit('click');
    await until(async ()=>(await call('state')).thread?.chat==='demo@c.us');
    assert.equal((await call('state')).active,accounts[1].id);
    await call('send',accounts[1].id,'demo@c.us','收到，谢谢你的反馈！');
    assert.equal(await b.executeJavaScript("rows.at(-1).body"),'收到，谢谢你的反馈！');
    assert.equal(await a.executeJavaScript('rows.length'),1);
    const ui = code => shell.executeJavaScript(code);
    await b.executeJavaScript("events.get('chat.msg_ack_change')({ids:[rows.at(-1).id],ack:2});true");
    await until(()=>ui("document.querySelector('.outgoing .receipt')?.title==='已送达'"));
    await b.executeJavaScript("events.get('chat.msg_ack_change')({ids:[rows.at(-1).id],ack:3});true");
    await until(()=>ui("document.querySelector('.outgoing .receipt.read')?.title==='已读'"));
    await ui("get('translation-settings').click()");
    await until(()=>ui("get('translation-dialog').open"));
    await ui("get('translation-engine').value='keyed';get('translation-engine').dispatchEvent(new Event('change'));get('key-deepl').value='test:fx'; get('key-azure').value='test';get('auto-translate').checked=true;get('translation-form').requestSubmit()");
    await until(()=>ui("document.querySelector('.incoming .translation-output')?.textContent.startsWith('测试译文')"));
    assert.equal(await ui("document.querySelector('.incoming .message-text').textContent"),'刚收到包裹了，谢谢你。');
    await ui("get('emoji-toggle').click();document.querySelector('.emoji-grid button').click();get('draft-translate').click()");
    await until(()=>ui("!get('draft-proposal').hidden"));
    assert.equal(await ui("get('reply').value"),'😀');
    await ui("get('apply-draft').click()");
    assert.equal(await ui("get('reply').value"),'测试译文 😀');
    assert.equal(await b.executeJavaScript('rows.length'),2);
    await ui("get('reply').value='';get('reply').dispatchEvent(new Event('input'))");
    await call('select',null);
    await until(async ()=>{
      const page=await call('state');
      const first=page.messages.find(m=>m.accountId===accounts[0].id);
      const second=page.messages.find(m=>m.accountId===accounts[1].id);
      return page.count===2 && first?.unreadCount===1 && second?.unreadCount===0 && second?.text==='收到，谢谢你的反馈！';
    });
    await pause(180);
    if (process.env.RELAY_UI_CAPTURE) {
      const capture = async(name) => fs.writeFileSync(path.join(process.env.RELAY_UI_CAPTURE,name+'.png'), (await shell.capturePage()).toPNG());
      const examples = [
        [a, '采购 · Vivian','周三可以安排取样，麻烦确认一下收件地址。','vivian',2],
        [b, '售后协调群','客户已收到新的配件，下午会反馈安装结果。','support',5],
        [a, 'Daniel Tan','Thanks! Please send me the updated quotation.','daniel',9],
        [b, '客服交接','新加坡订单的物流信息已更新。','handover',14],
        [a, '采购 · Vivian','报价收到了，样品预计什么时候到？','vivian',24],
        [b, 'Mei Lin','收件地址已确认，谢谢。','mei',31]
      ];
      for (const [view,title,body,id,mins] of examples) {
        await view.executeJavaScript('window.sample(...' + JSON.stringify([body,'example-'+mins,false,{id:id+'@c.us',formattedTitle:title},mins]) + ');true');
      }
      await until(async ()=>(await call('state')).count===7);
      const { nativeTheme } = require('electron'); nativeTheme.themeSource = 'light';
      const vivian=(await call('state')).messages.find(m=>m.chat==='vivian@c.us');
      assert.equal(vivian.unreadCount,2);
      assert.equal(vivian.id,'example-2');
      await call('open',accounts[0].id,'example-2');
      assert.equal((await call('state')).messages.length,2);
      await call('send',accounts[0].id,'vivian@c.us','好的，地址我已收到。周三取样后会把物流单号发给你。');
      await until(async()=>{
        const feed=(await call('state')).feed;
        return feed?.count===7 && feed.messages.find(m=>m.chat==='vivian@c.us')?.unreadCount===0;
      });
      for (const [mins, text] of [
        [94,'我们确认了打样清单，麻烦核对两种规格。'],
        [89,'外包装沿用上次的尺寸，标签换成新版。'],
        [74,'仓库周三可以收货。需要提前登记车牌吗？'],
        [61,'我把收件人的电话补到采购单里了。']
      ]) {
        await a.executeJavaScript('window.sample(...'+JSON.stringify([text,'history-'+mins,false,{id:'vivian@c.us',formattedTitle:'采购 · Vivian'},mins])+');true');
      }
      await until(() => shell.executeJavaScript("document.querySelectorAll('#bubbles .message').length === 7"));
      const verifyListBounds = () => shell.executeJavaScript(`(() => {
        const rows = Array.from(document.querySelectorAll('#list .row'));
        const row = rows.find(item=>item.querySelector('.conversation-unread'));
        const text = row.querySelector('.snippet'), badge = row.querySelector('.conversation-unread');
        const title = row.querySelector('strong');
        const original = [text.textContent,badge.textContent,title.textContent];
        text.textContent = '测试长消息'.repeat(120);
        badge.textContent = '99+';
        title.textContent = 'LongContactName'.repeat(30);
        const bounded = rows.every(item => {
          const boundary = item.getBoundingClientRect().right - 2;
          return [...item.querySelectorAll('.snippet,time,.conversation-unread,strong,.group-tag,.row-source')].every(n=>n.getBoundingClientRect().right <= boundary);
        }) && text.scrollWidth > text.clientWidth && getComputedStyle(text).textOverflow === 'ellipsis';
        [text.textContent,badge.textContent,title.textContent] = original;
        return bounded;
      })()`);
      await until(()=>shell.executeJavaScript("document.querySelectorAll('.account .photo-face img').length===2 && document.querySelector('#reader-avatar img')?.naturalWidth>0"));
      assert.equal(await shell.executeJavaScript("new Set([...document.querySelectorAll('.account .photo-face img')].map(img=>img.src)).size"),2);
      assert.equal(await shell.executeJavaScript("document.querySelector('#bubbles .outgoing img').src===document.querySelector('.account .photo-face img').src"),true);
      assert.equal(await verifyListBounds(),true);
      await pause(250); await capture('inbox');
      assert.equal(await shell.executeJavaScript("document.querySelector('#all').getAttribute('aria-pressed')"),'true');
      assert.equal(await shell.executeJavaScript("new Set(Array.from(document.querySelectorAll('.account .tile'),e=>getComputedStyle(e).backgroundColor)).size"),2);
      await shell.executeJavaScript("const search=document.querySelector('#query');search.value='Daniel';search.dispatchEvent(new Event('input'));");
      assert.equal(await shell.executeJavaScript("document.querySelectorAll('#list button').length"),1);
      await shell.executeJavaScript("search.value='';search.dispatchEvent(new Event('input'));");
      nativeTheme.themeSource = 'dark';
      assert.equal(await shell.executeJavaScript("document.getElementById('profile-name').textContent"),'采购 · Vivian');
      await shell.executeJavaScript("document.getElementById('profile-toggle').click()");
      assert.equal(await shell.executeJavaScript("document.getElementById('profile').hidden"),false);
      await shell.executeJavaScript("const mq=document.getElementById('message-query');mq.value='周三';mq.dispatchEvent(new Event('input'));");
      assert.equal(await shell.executeJavaScript("document.querySelectorAll('.message.found').length"),3);
      await shell.executeJavaScript("mq.value='';mq.dispatchEvent(new Event('input'));document.getElementById('filter-unread').click()");
      assert.equal(await shell.executeJavaScript("Array.from(document.querySelectorAll('#list .row')).every(row=>row.querySelector('.conversation-unread'))"),true);
      await shell.executeJavaScript("document.getElementById('filter-all').click()");
      await call('open',accounts[0].id,'example-2'); await pause(240);
      await capture('thread');
      const w = BrowserWindow.fromWebContents(shell);
      w.setContentSize(820,520); await pause(200);
      assert.equal(await shell.executeJavaScript('document.documentElement.scrollWidth <= innerWidth'),true);
      await shell.executeJavaScript("document.getElementById('profile-toggle').click()");
      assert.equal(await shell.executeJavaScript("document.getElementById('profile').checkVisibility()"),true);
      await shell.executeJavaScript("document.getElementById('profile-reply').click()");
      assert.equal(await shell.executeJavaScript("document.activeElement.id"),'reply');
      assert.equal(await verifyListBounds(),true);
      await capture('compact');
    }
    await call('select',accounts[0].id);
    await a.executeJavaScript("for(let i=0;i<22;i++){const id=(16505550200+i)+'@c.us';chats.set(id,{id,formattedTitle:'目录 '+i,unreadCount:i===21?7:0,t:now-2000});} window.relayReader.more();true");
    await until(async ()=>(await call('state')).messages.some(m=>m.chat==='16505550221@c.us' && m.unreadCount===7 && !m.id));
    await until(()=>shell.executeJavaScript(`(() => {
      const row = [...document.querySelectorAll('#list .row')].find(r=>r.querySelector('strong').textContent === '目录 21');
      return row?.querySelector('.snippet')?.textContent === '' && row.querySelector('.conversation-unread')?.textContent === '7';
    })()`));
    const late=(await call('state')).messages.find(m=>m.chat==='16505550221@c.us');
    for (const term of ['＋１　(650)\u202f555-0221','16505550221']) {
      await ui("get('query').value="+JSON.stringify(term)+";get('query').dispatchEvent(new Event('input'))");
      await until(()=>ui("get('list').querySelectorAll('.row').length === 1 && get('list').querySelector('strong').textContent === '目录 21'"));
      const found = await call('searchPeople',term);
      assert.deepEqual(found.rows.map(r=>r.chat),[late.chat]);
    }
    await ui("get('query').value='';get('query').dispatchEvent(new Event('input'))");
    await call('openChat',accounts[0].id,late.chat);
    assert.equal((await call('state')).thread.chat,late.chat);
    await shell.executeJavaScript("document.getElementById('find-person').click();const person=document.getElementById('people-query');person.value='+1 (650) 555-0123';person.dispatchEvent(new Event('input'))");
    await until(()=>shell.executeJavaScript("document.querySelectorAll('.person-result').length===1"));
    await shell.executeJavaScript("document.querySelector('.person-result').click()");
    await until(async ()=>(await call('state')).thread?.chat==='16505550123@c.us');
    assert.equal((await call('state')).active,accounts[0].id);
    await call('select',accounts[0].id);
    await a.executeJavaScript(`(() => {
      const group={id:'fixture@g.us',formattedTitle:'交接小组',t:now,groupMetadata:{subject:'交接小组',desc:'值班交接',canSetSubject:()=>true,canSetDescription:()=>false}};
      chats.set(group.id,group);
      const member={_serialized:'16505550102@c.us'};
      for (const [i,data] of [
        {body:'Ready for review',type:'chat',author:member,notifyName:'Maya'},
        {body:'',type:'gp2',subtype:'add',author:member,notifyName:'Maya',recipients:['16505550103@c.us']}
      ].entries()) {
        const msg={...data,id:{_serialized:'group-fixture-'+i,remote:group.id,fromMe:i===1},t:now+i+100};
        rows.push(msg); events.get('chat.new_message')(msg);
      }
    })()`);
    await until(async ()=>(await call('state')).messages.some(m=>m.chat==='fixture@g.us'));
    await call('openChat',accounts[0].id,'fixture@g.us');
    await until(()=>shell.executeJavaScript("!get('group-label').hidden && !!document.querySelector('.message.system time')"));
    assert.equal(await shell.executeJavaScript("document.querySelector('.message-author').textContent"),'Maya');
    assert.equal(await shell.executeJavaScript("document.querySelector('.system .message-text').textContent"),'Maya 邀请 +16505550103 加入群聊');
    assert.equal(await shell.executeJavaScript("document.querySelectorAll('.system .avatar,.system .receipt,.system .message-translate').length"),0);
    assert.ok(await shell.executeJavaScript("document.querySelector('.row.current .snippet').textContent.startsWith('Maya 邀请')"));
    await a.executeJavaScript(`(() => {
      const msg={id:{_serialized:'secure-fixture',fromMe:true,remote:'fixture@g.us'},t:now+102,
        type:'e2e_notification',subtype:'encrypt'};
      rows.push(msg); events.get('chat.new_message')(msg);
    })()`);
    await until(()=>shell.executeJavaScript("document.querySelector('.encryption-notice')?.title==='e2e_notification / encrypt'"));
    assert.equal(await shell.executeJavaScript("document.querySelector('.encryption-notice .message-text').textContent"),'此聊天的消息和通话受端到端加密保护。');
    assert.equal(await shell.executeJavaScript("document.querySelectorAll('.encryption-notice .receipt,.encryption-notice .avatar,.encryption-notice .message-translate').length"),0);
    if (process.env.RELAY_UI_CAPTURE) {
      BrowserWindow.fromWebContents(shell).setContentSize(1260,820);
      await call('send',accounts[0].id,'fixture@g.us','收到，我现在核对。');
      await a.executeJavaScript("events.get('chat.msg_ack_change')({ids:[rows.at(-1).id],ack:3});true");
      await until(()=>ui("!!document.querySelector('.outgoing .receipt.read') && !!document.querySelector('.encryption-notice')"));
      fs.writeFileSync(path.join(process.env.RELAY_UI_CAPTURE,'group-chat.png'),(await shell.capturePage()).toPNG());
    }
    await ui("get('group-directory').click()");
    await until(()=>ui("get('group-dialog').open && !!get('group-panel-body').querySelector('.group-row')"));
    assert.equal(await ui("get('group-panel-body').querySelectorAll('.group-row').length"),1);
    await ui("document.querySelector('[data-group-tab=members]').click()");
    await until(()=>ui("get('group-panel-body').textContent.includes('管理员')"));
    await ui("document.querySelector('[data-group-tab=settings]').click()");
    await until(()=>ui("!!get('edit-group-subject')"));
    assert.equal(await ui("get('edit-group-description').readOnly"),true);
    await ui("get('edit-group-subject').value='值班小组';get('edit-group-subject').dispatchEvent(new Event('input')); get('edit-group-subject').form.requestSubmit()");
    await until(()=>ui("get('group-status').textContent.includes('已保存') && get('reader-title').textContent==='值班小组'"));
    if(process.env.RELAY_UI_CAPTURE) fs.writeFileSync(path.join(process.env.RELAY_UI_CAPTURE,'group-settings.png'),(await shell.capturePage()).toPNG());
    await ui("get('group-close').click();document.querySelectorAll('.account')[1].dispatchEvent(new MouseEvent('contextmenu',{bubbles:true}));");
    await pause(180);
    assert.equal(await ui("get('menu').matches(':popover-open') && get('menu').getBoundingClientRect().left>=document.querySelector('.account').getBoundingClientRect().right && get('menu').getBoundingClientRect().bottom<=innerHeight"),true);
    await ui("get('remove').click()");
    assert.equal(await ui("get('confirm-remove').open && get('remove-detail').textContent.includes('客服 B') && !get('actions').querySelector('#profile-toggle,#back,#options')"),true);
    assert.equal((await call('state')).active,accounts[0].id);
    await ui("get('remove-cancel').click()");
    assert.equal((await call('state')).accounts.length,2);
    await a.executeJavaScript(`(() => {
      const group=chats.get('fixture@g.us'); group.endOfHistoryTransferType=0;
      for (let i=0;i<2;i++) {
        const msg={id:{_serialized:'late-text-'+i,fromMe:false,remote:group.id},type:'ciphertext',t:now-3600};
        rows.push(msg); events.get('chat.new_message')(msg);
      }
    })()`);
    await call('openChat',accounts[0].id,'fixture@g.us');
    await until(()=>call('state').then(s=>s.thread && s.missingCount === 2));
    assert.equal(await ui("document.body.innerText.includes('历史记录尚未取得正文')"),false);
    assert.equal(await a.executeJavaScript("window.testTransfer"),'fixture@g.us');
    assert.equal(await ui("get('bubbles').textContent.includes('等待 WhatsApp 解密')"),false);
    await a.executeJavaScript(`(() => {
      const late=rows.filter(r=>r.id._serialized.startsWith('late-text-'));
      late[0].type='chat'; events.get('model:change:type')(late[0]); late[0].body='恢复的第一条'; events.get('model:change:body')(late[0]);
      window.restoredRows=[{...late[1],type:'chat',body:'恢复的第二条'}];
    })()`);
    await until(()=>ui("get('bubbles').textContent.includes('恢复的第二条')"));
    assert.deepEqual(await ui("[...get('bubbles').querySelectorAll('.message-text')].filter(n=>n.textContent.startsWith('恢复的')).map(n=>n.textContent)"),['恢复的第一条','恢复的第二条']);
    const G='fixture@g.us', me=accounts[0].id, pixel='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    await call('sendFile',me,G,{name:'样品.png',data:pixel,caption:'样品照片'});
    await until(()=>ui("(()=>{const img=document.querySelector('.media-picture img');return !!img && img.naturalWidth===1 && !img.classList.contains('preview');})()"));
    const photo=(await call('state')).messages.find(m=>m.media?.kind==='image');
    assert.equal(photo.text,'样品照片');
    assert.equal(await ui("[...document.querySelectorAll('.message')].find(n=>n.querySelector('.media-picture')).querySelector('.message-text').hidden"),false);
    await call('react',me,G,photo.id,'👍');
    await until(()=>ui("document.querySelector('.reactions button.mine')?.textContent==='👍'"));
    await call('send',me,G,'引用回复',photo.id);
    await until(()=>ui("document.querySelector('.quote span')?.textContent==='样品照片'"));
    const answer=(await call('state')).messages.find(m=>m.text==='引用回复');
    assert.equal(answer.quote.id,photo.id.split('_')[2]);
    await ui("document.querySelector('.quote').click()");
    await until(()=>ui("document.querySelector('.message.found .media-picture') !== null"));
    await call('edit',me,G,answer.id,'改过的回复');
    await until(()=>ui("[...document.querySelectorAll('.message')].some(n=>n.querySelector('.message-text').textContent==='改过的回复' && n.querySelector('.edited'))"));
    await ui("[...document.querySelectorAll('.message')].find(n=>n.dataset.id==="+JSON.stringify(answer.id)+").querySelector('[data-act=more]').click()");
    assert.deepEqual(await ui("get('message-menu').matches(':popover-open') && [...get('message-menu').querySelectorAll('button')].map(b=>b.textContent)"),['回复','转发','星标','复制文字','编辑','撤回','为我删除']);
    if (process.env.RELAY_UI_CAPTURE) { await pause(1200); fs.writeFileSync(path.join(process.env.RELAY_UI_CAPTURE,'message-actions.png'),(await shell.capturePage()).toPNG()); }
    await ui("get('message-menu').querySelector('button').click()");
    assert.equal(await ui("!get('reply-context').hidden && get('context-text').textContent"),'改过的回复');
    if (process.env.RELAY_UI_CAPTURE) { await pause(1200); fs.writeFileSync(path.join(process.env.RELAY_UI_CAPTURE,'reply-context.png'),(await shell.capturePage()).toPNG()); }
    await ui("get('context-close').click()");
    await call('removeMessage',me,G,answer.id,true);
    await until(()=>ui("document.querySelector('.message.revoked .message-text')?.textContent==='消息已撤回'"));
    assert.equal(await ui("document.querySelector('.message.revoked .message-tools')"),null);
    await call('removeMessage',me,G,photo.id,false);
    await until(()=>ui("!document.querySelector('.media-picture')"));
    await a.executeJavaScript("events.get('chat.presence_change')({id:{_serialized:'fixture@g.us'},participants:[{id:'m',state:'composing',shortName:'Maya'}]});true");
    await until(()=>ui("get('presence').textContent==='Maya 正在输入…' && !get('presence').hidden"));
    await ui("get('reply').value='在';get('reply').dispatchEvent(new Event('input'))");
    await until(()=>a.executeJavaScript("window.composing==='fixture@g.us'"));
    console.log('PASS: attachments, inline pictures, reactions, quoted replies, edits, revoke, local delete and typing state');
    await call('openChat',me,'demo@c.us');
    await ui("if(get('profile').hidden) get('profile-toggle').click()");
    await until(()=>ui("get('profile-details').querySelector('.detail-value')?.textContent==='未设置' && get('profile-kind').textContent==='+6581234567 · 商业账号'"));
    assert.equal(await ui("get('reader-phone').hidden && !get('remark-edit').hidden"),true);
    await ui("get('remark-edit').click();get('remark-name').value='老客户 · 林';get('remark-form').requestSubmit()");
    await until(()=>ui("!get('remark-dialog').open && get('reader-title').textContent==='老客户 · 林' && !get('reader-phone').hidden && get('reader-phone').textContent==='+6581234567'"));
    assert.equal(await ui("document.querySelector('.row.current strong').textContent"),'老客户 · 林');
    assert.equal(await ui("get('profile-details').querySelector('.detail-value').textContent"),'老客户 · 林');
    assert.ok(await ui("['个性签名','商家简介','共同群组 · 1','~Jiamin'].every(t=>get('profile-details').textContent.includes(t))"));
    await ui("get('profile-details').querySelector('.switch-row').click()");
    await until(()=>ui("get('profile-details').querySelector('.switch-row').getAttribute('aria-checked')==='true'"));
    assert.equal((await call('contactInfo',me,'demo@c.us')).muted,true);
    if (process.env.RELAY_UI_CAPTURE) { await pause(1200); fs.writeFileSync(path.join(process.env.RELAY_UI_CAPTURE,'contact-info.png'),(await shell.capturePage()).toPNG()); }
    await call('saveRemark',me,'demo@c.us','');
    await until(()=>ui("get('reader-title').textContent==='+65 8123 4567' && get('reader-phone').hidden"));
    console.log('PASS: contact info, remark editing, renamed conversation rows and chat switches');
    await call('openChat',me,'demo@c.us');
    const first=(await call('state')).messages[0];
    assert.ok((await call('conversations',me)).some(c=>c.chat===G));
    await call('forward',me,'demo@c.us',first.id,G);
    assert.deepEqual(await a.executeJavaScript('window.forwarded'),[G,first.id]);
    await ui("document.querySelector('.message [data-act=more]').click();[...get('message-menu').querySelectorAll('button')].find(b=>b.textContent==='转发').click()");
    await until(()=>ui("get('forward-dialog').open && get('forward-results').querySelectorAll('.person-result').length>1"));
    await ui("get('forward-close').click()");
    await ui("get('new-group').click();get('group-name').value='华东代理群';get('group-members').value='+65 8123 4567\\n+86 138 0013 8000';get('create-group-form').requestSubmit()");
    await until(async()=>(await call('state')).thread?.chat==='new-group@g.us');
    await until(()=>ui("get('reader-title').textContent==='华东代理群'"));
    await until(()=>ui("get('warning').textContent.includes('+8613800138000')"));
    assert.equal(await ui("!get('record').hidden && get('recording').hidden"),true);
    assert.equal(await ui("!get('health').hidden && get('health-count').hidden"),true);
    assert.equal((await call('translationSettings')).voice,'en');
    await ui("get('dictation-language').click()");
    await until(()=>ui("get('voice-settings').open && get('voice-language').value==='en'"));
    await ui("get('voice-language').value='none';get('voice-form').requestSubmit()");
    await until(async()=>(await call('translationSettings')).voice==='none' && await ui("!get('voice-settings').open && get('dictation-target').textContent==='不翻译'"));
    await call('saveVoiceLanguage','en');
    assert.equal(await ui("!get('dictate').hidden && get('dictation').hidden"),true);
    await b.executeJavaScript("localStorage.removeItem('owner');true");
    await until(async()=>!!(await call('state')).accounts[1].dropped);
    await ui("get('health').click()");
    await until(()=>ui("get('health-dialog').open && get('health-count').textContent==='1' && !!get('health-list').querySelector('.health-row.bad') && get('health-list').querySelectorAll('.health-row.ok').length===1"));
    assert.ok(await ui("get('health-list').querySelector('.health-row.bad').textContent.includes('异常退出') && get('health-list').querySelector('.health-row.bad .health-action').textContent==='重新关联'"));
    await ui("get('health-list').querySelector('.health-row.bad .health-action').click()");
    await until(()=>ui("!get('health-dialog').open && document.body.classList.contains('unlinked') && !get('list').checkVisibility() && !get('query').checkVisibility() && get('dock-avatar').checkVisibility()"));
    assert.equal(await ui("document.querySelector('.reader').getBoundingClientRect().left - document.querySelector('.account-rail').getBoundingClientRect().right < 2"),true);
    if (process.env.RELAY_UI_CAPTURE) { await pause(1200); fs.writeFileSync(path.join(process.env.RELAY_UI_CAPTURE,'unlinked.png'),(await shell.capturePage()).toPNG()); }
    await ui("get('health').click()");
    await until(()=>ui("get('health-dialog').open"));
    if (process.env.RELAY_UI_CAPTURE) { await pause(1200); fs.writeFileSync(path.join(process.env.RELAY_UI_CAPTURE,'account-health.png'),(await shell.capturePage()).toPNG()); }
    await b.executeJavaScript("localStorage.owner='two';true");
    await until(async()=>{const acc=(await call('state')).accounts[1];return acc.status==='online' && !acc.dropped;});
    await until(()=>ui("get('health-count').hidden && get('health-list').querySelectorAll('.health-row.ok').length===2"));
    await ui("get('health-close').click()");
    await call('select',me);
    await until(()=>ui("!document.body.classList.contains('unlinked') && get('query').checkVisibility()"));
    console.log('PASS: forwarding, new groups, account health dialog and unexpected logout tracking');
    console.log('PASS: native history request, two hidden ciphertext records, recovery by model event and bounded reread');
    console.log('PASS: group authors, group activity, read receipts, emoji, bilingual fallback and draft preview');
    console.log('PASS: late directory rows without previews, unread counts and private number search');
    console.log('PASS: two isolated accounts, unified feed, notification routing, own UI reply');
  } else {
    assert.equal(await a.executeJavaScript('localStorage.owner'),'one');
    assert.equal(await b.executeJavaScript('localStorage.owner'),'two');
    console.log('PASS: persisted partitions reopened independently after process restart');
  }
  await Promise.all([a.session.flushStorageData(),b.session.flushStorageData()]);
  BrowserWindow.fromWebContents(shell).close();
})().catch(err=>{console.error(err);app.exit(1);});
