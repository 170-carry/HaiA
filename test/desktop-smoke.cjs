process.env.HAIA_TEST = '1';
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
    await until(()=>ui("get('settings-dialog').open && get('incoming-language').options.length>1 && !!get('key-deepl')"));
    await ui("get('translation-engine').value='keyed';get('translation-engine').dispatchEvent(new Event('change'));get('key-deepl').value='test:fx'; get('key-azure').value='test';get('auto-translate').checked=true;get('translation-form').requestSubmit()");
    await until(()=>ui("get('translation-saved').textContent==='已保存'"));
    await ui("get('settings-close').click()");
    await until(()=>ui("document.querySelector('.incoming .translation-output')?.textContent.startsWith('测试译文')"));
    assert.equal(await ui("document.querySelector('.incoming .message-text').textContent"),'刚收到包裹了，谢谢你。');
    await ui("localStorage.setItem('translate-mode','preview');get('emoji-toggle').click();document.querySelector('.emoji-grid button').click();get('draft-translate').click()");
    await until(()=>ui("!get('draft-proposal').hidden"));
    assert.equal(await ui("get('reply').value"),'😀');
    await ui("get('apply-draft').click()");
    await ui("localStorage.removeItem('translate-mode')");
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
    await until(()=>ui("document.querySelector('.message.flash .media-picture') !== null"));
    await call('edit',me,G,answer.id,'改过的回复');
    await until(()=>ui("[...document.querySelectorAll('.message')].some(n=>n.querySelector('.message-text').textContent==='改过的回复' && n.querySelector('.edited'))"));
    await ui("[...document.querySelectorAll('.message')].find(n=>n.dataset.id==="+JSON.stringify(answer.id)+").querySelector('[data-act=more]').click()");
    assert.deepEqual(await ui("get('message-menu').matches(':popover-open') && [...get('message-menu').querySelectorAll('button')].map(b=>b.textContent)"),['回复','转发','星标','复制文字','多选','消息详情','编辑','撤回','为我删除']);
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
    await ui("get('new-group').click();get('group-name').value='华东代理群'");
    await until(()=>ui("get('create-group').open && get('group-candidates').querySelectorAll('.person-result').length>0 && get('group-candidates-note').textContent==='最近联系人'"));
    const typeMember=text=>ui("get('group-search').value="+JSON.stringify(text)+";get('group-search').dispatchEvent(new Event('input'))");
    await typeMember('+65 8123 4567');
    await until(()=>ui("get('group-candidates').querySelector('.add-number')?.textContent==='添加号码 +6581234567'"));
    await ui("get('group-candidates').querySelector('.add-number').click()");
    await typeMember('目录联系人');
    await until(()=>ui("[...get('group-candidates').querySelectorAll('.person-result strong')].some(n=>n.textContent==='目录联系人')"));
    await ui("[...get('group-candidates').querySelectorAll('.person-result')].find(b=>b.textContent.includes('目录联系人')).click()");
    await until(()=>ui("get('group-chosen').querySelectorAll('.member-chip').length===2 && get('group-chosen-label').textContent==='已选 2 人'"));
    if (process.env.RELAY_UI_CAPTURE) { await pause(1200); fs.writeFileSync(path.join(process.env.RELAY_UI_CAPTURE,'new-group.png'),(await shell.capturePage()).toPNG()); }
    await ui("get('create-group-form').requestSubmit()");
    await until(async()=>(await call('state')).thread?.chat==='new-group@g.us');
    await until(()=>ui("get('reader-title').textContent==='华东代理群'"));
    await until(()=>ui("get('warning').textContent.includes('未能添加：+16505550123')"));
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
    await call('openChat',me,'demo@c.us');
    await call('sendSpecial',me,'demo@c.us','location',{lat:'1.29027',lng:'103.851959',name:'滨海湾仓库'});
    await call('sendSpecial',me,'demo@c.us','contact',{name:'王经理',phone:'+65 8123 4567'});
    await call('sendSpecial',me,'demo@c.us','poll',{name:'周几方便收货？',options:['周三','周四','周五'],multiple:false});
    await assert.rejects(()=>call('sendSpecial',me,'demo@c.us','location',{lat:'200',lng:'1'}));
    await call('openChat',me,'demo@c.us');
    await until(()=>ui("[...document.querySelectorAll('.poll-option b')].map(b=>b.textContent).join()==='1,2,0' && get('bubbles').textContent.includes('联系人 · 王经理 · +6581234567') && get('bubbles').textContent.includes('位置 · 滨海湾仓库 · 1.29027, 103.85196')"));
    await call('send',me,'demo@c.us','报价单见 https://example.test/quote?id=7，请查收。');
    await until(()=>ui("document.querySelector('.message-text .text-link')?.dataset.url==='https://example.test/quote?id=7'"));
    const linked=(await call('state')).messages.find(m=>m.text.startsWith('报价单'));
    await call('star',me,'demo@c.us',linked.id,true);
    await until(()=>ui("!!document.querySelector('.message .starred')"));
    await assert.rejects(()=>call('openExternal','file:///etc/passwd'));
    await ui("get('attach').click()");
    assert.deepEqual(await ui("get('attach-menu').matches(':popover-open') && [...get('attach-menu').querySelectorAll('button')].map(b=>b.textContent)"),['图片或文件','位置','联系人名片','投票','快捷回复']);
    await ui("get('attach-menu').querySelectorAll('button')[3].click()");
    assert.equal(await ui("get('special-dialog').open && get('special-title').textContent"),'发起投票');
    await ui("get('special-cancel').click()");
    await until(()=>ui("[...document.querySelectorAll('.label-chip')].map(c=>c.textContent+c.getAttribute('aria-pressed')).join()==='新客户false'"));
    await ui("document.querySelector('.label-chip').click()");
    await until(()=>ui("document.querySelector('.label-chip')?.getAttribute('aria-pressed')==='true'"));
    await ui("const tag=document.querySelector('.label-new');tag.value='重点';tag.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))");
    await until(()=>ui("[...document.querySelectorAll('.label-chip')].map(c=>c.textContent+c.getAttribute('aria-pressed')).join()==='新客户true,重点true'"));
    if (process.env.RELAY_UI_CAPTURE) { await ui("get('scroll').scrollTop=get('scroll').scrollHeight"); await pause(1200); fs.writeFileSync(path.join(process.env.RELAY_UI_CAPTURE,'rich-messages.png'),(await shell.capturePage()).toPNG()); }
    assert.equal(await ui("!get('call-voice').hidden && !get('call-video').hidden && get('call-bar').hidden"),true);
    await a.executeJavaScript("events.get('call.incoming_call')({id:'in-1',peerJid:{_serialized:'demo@c.us'},isVideo:false});true");
    await until(()=>ui("!get('call-bar').hidden && get('call-bar').textContent.includes('语音来电') && [...get('call-bar').querySelectorAll('button')].map(b=>b.textContent).join()==='接听,拒绝' && get('call-voice').disabled"));
    if (process.env.RELAY_UI_CAPTURE) { await pause(1200); fs.writeFileSync(path.join(process.env.RELAY_UI_CAPTURE,'incoming-call.png'),(await shell.capturePage()).toPNG()); }
    await ui("get('call-bar').querySelector('.hangup').click()");
    await until(()=>ui("get('call-bar').hidden"));
    assert.equal(await a.executeJavaScript('window.rejected'),'in-1');
    await ui("get('open-status').click()");
    await until(()=>ui("get('status-dialog').open && get('status-list').querySelectorAll('.status-row.unseen').length===1"));
    await pause(250); await require('./linked-features.cjs').captureStatus(shell,process.env.HAIA_VERIFY_SCREENS);
    await ui("get('status-list').querySelector('.status-row').click()");
    await until(()=>ui("get('status-list').querySelector('.status-text.plain')?.textContent==='本周新品到货'"));
    await ui("get('status-text').value='周末正常发货';get('status-form').requestSubmit()");
    await until(()=>a.executeJavaScript("window.posted==='周末正常发货'"));
    if (process.env.RELAY_UI_CAPTURE) { await pause(1200); fs.writeFileSync(path.join(process.env.RELAY_UI_CAPTURE,'status.png'),(await shell.capturePage()).toPNG()); }
    await ui("get('status-close').click()");
    await call('openChat',me,G);
    await until(()=>ui("state.thread?.chat==='fixture@g.us' && !get('group-settings').hidden"));
    await ui("get('group-settings').click();document.querySelector('[data-group-tab=members]').click()");
    await until(()=>ui("!!get('group-panel-body').querySelector('.member-add') && get('group-panel-body').querySelectorAll('.member-tools').length===1"));
    await ui("const add=get('group-panel-body').querySelector('.member-add');add.querySelector('input').value='+65 8123 4567, +86 138 0013 8000';add.requestSubmit()");
    await until(()=>ui("get('group-status').textContent.includes('+8613800138000') && get('group-panel-body').querySelectorAll('.group-row').length===3"));
    await ui("[...get('group-panel-body').querySelectorAll('.member-tools .danger-item')].at(-1).click()");
    await until(()=>ui("get('group-status').textContent==='成员已更新' && get('group-panel-body').querySelectorAll('.group-row').length===2"));
    await ui("get('group-close').click()");
    const rowOf=chat=>"[...document.querySelectorAll('#list .row')].find(r=>JSON.parse(r.dataset.message)[1]==="+JSON.stringify(chat)+")";
    await ui(rowOf('demo@c.us')+".dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:200,clientY:300}))");
    assert.deepEqual(await ui("get('chat-menu').matches(':popover-open') && [...get('chat-menu').querySelectorAll('button')].map(b=>b.textContent)"),['置顶','取消静音','归档','标为未读']);
    await ui("get('chat-menu').querySelector('button').click()");
    await until(()=>ui("JSON.parse(document.querySelector('#list .row').dataset.message)[1]==='demo@c.us' && !!document.querySelector('#list .row .row-flag')"));
    if (process.env.RELAY_UI_CAPTURE) { await ui(rowOf('demo@c.us')+".dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:200,clientY:300}))"); await pause(1200); fs.writeFileSync(path.join(process.env.RELAY_UI_CAPTURE,'chat-menu.png'),(await shell.capturePage()).toPNG()); await ui("get('chat-menu').hidePopover()"); }
    await call('chatSetting',me,'demo@c.us','archived',true);
    await until(()=>ui("!"+rowOf('demo@c.us')+" && get('archived-count').textContent==='1' && !get('archived-count').hidden"));
    await ui("get('filter-archived').click()");
    await until(()=>ui("document.querySelectorAll('#list .row').length===1 && !!"+rowOf('demo@c.us')));
    await call('chatSetting',me,'demo@c.us','archived',false);
    await until(()=>ui("get('feed-empty').textContent==='没有已归档的会话' && !get('feed-empty').hidden && get('archived-count').hidden"));
    await ui("get('filter-all').click()");
    await until(()=>ui("!!"+rowOf('demo@c.us')));
    await call('chatSetting',me,'demo@c.us','pinned',false);
    await call('chatSetting',me,'demo@c.us','unread',true);
    await until(async()=>(await call('state')).feed.messages.find(m=>m.chat==='demo@c.us').unreadCount===1);
    await call('openChat',me,'demo@c.us');
    await until(()=>ui("state.thread?.chat==='demo@c.us' && state.active==="+JSON.stringify(me)+" && get('reply-account').title.includes('销售 A') && get('replyLabel').hidden"));
    await ui("get('reply-account').click()");
    assert.deepEqual(await ui("get('attach-menu').matches(':popover-open') && [...get('attach-menu').querySelectorAll('.reply-option')].map(b=>b.querySelector('strong').textContent+b.getAttribute('aria-checked'))"),['销售 Atrue','客服 Bfalse']);
    if (process.env.RELAY_UI_CAPTURE) { await pause(1200); fs.writeFileSync(path.join(process.env.RELAY_UI_CAPTURE,'reply-account.png'),(await shell.capturePage()).toPNG()); }
    await ui("get('attach-menu').querySelectorAll('.reply-option')[1].click()");
    await until(async()=>{const st=await call('state');return st.active===accounts[1].id && st.thread?.chat==='demo@c.us';});
    await until(()=>ui("get('reply-account').title.includes('客服 B')"));
    await call('send',accounts[1].id,'demo@c.us','这边用客服号跟进。');
    assert.equal(await call('chatLabels',accounts[1].id,'demo@c.us'),null);
    await until(()=>ui("get('profile-details').querySelector('.switches') && !document.querySelector('.label-chips')"));
    await until(()=>b.executeJavaScript("rows.at(-1).body==='这边用客服号跟进。' && rows.at(-1).id.remote==='demo@c.us'"));
    await assert.rejects(()=>call('replyAs',me,'new-group@g.us'));
    await call('select',me);
    await call('openChat',me,G);
    await until(()=>ui("!get('composer').hidden && !get('composer').classList.contains('locked') && get('chat-limit').hidden"));
    await a.executeJavaScript(`(() => {
      const meta=chats.get('fixture@g.us').groupMetadata; meta.announce=true; meta.suspended=true;
      const msg={body:'',type:'gp2',subtype:'suspend',id:{_serialized:'limit-fixture',remote:'fixture@g.us',fromMe:false},t:now+500};
      rows.push(msg); events.get('chat.new_message')(msg);
    })()`);
    await until(()=>ui("get('composer').classList.contains('locked') && get('chat-notice').textContent.includes('已被 WhatsApp 停用') && get('chat-limit').textContent==='已停用' && !get('reply').checkVisibility()"));
    await until(()=>ui("[...document.querySelectorAll('.limit-list li')].map(li=>li.textContent).join('|').includes('已被 WhatsApp 停用|全员禁言 · 仅管理员可发言') && get('bubbles').textContent.includes('此群已被 WhatsApp 停用')"));
    if (process.env.RELAY_UI_CAPTURE) { await pause(1200); fs.writeFileSync(path.join(process.env.RELAY_UI_CAPTURE,'group-limits.png'),(await shell.capturePage()).toPNG()); }
    await a.executeJavaScript(`(() => {
      const meta=chats.get('fixture@g.us').groupMetadata; meta.announce=false; meta.suspended=false;
      const msg={body:'',type:'gp2',subtype:'unsuspend',id:{_serialized:'limit-fixture-2',remote:'fixture@g.us',fromMe:false},t:now+501};
      rows.push(msg); events.get('chat.new_message')(msg);
    })()`);
    await until(()=>ui("!get('composer').classList.contains('locked') && get('chat-notice').hidden && get('chat-limit').hidden && get('reply').checkVisibility()"));
    await call('openChat',me,'demo@c.us');
    for (const name of ['一.png','二.png','三.png']) await call('sendFile',me,'demo@c.us',{name,data:pixel});
    await until(()=>ui("document.querySelectorAll('#bubbles .album').length===1 && document.querySelectorAll('.album .album-item .media-picture').length===3"));
    await ui("document.querySelectorAll('.album-item')[1].dispatchEvent(new MouseEvent('contextmenu',{bubbles:true}))");
    assert.equal(await ui("get('message-menu').matches(':popover-open') && get('message-menu').querySelectorAll('button').length>4"),true);
    await ui("get('message-menu').querySelector('button').click()");
    assert.equal(await ui("!get('reply-context').hidden && get('context-text').textContent"),'二.png');
    await ui("get('context-close').click()");
    if (process.env.RELAY_UI_CAPTURE) { await pause(1200); fs.writeFileSync(path.join(process.env.RELAY_UI_CAPTURE,'album.png'),(await shell.capturePage()).toPNG()); }
    await call('openChat',me,'demo@c.us');
    const press=init=>ui("get('reply').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true,..."+JSON.stringify(init)+"}))");
    await ui("get('reply').value='回车发送';get('reply').dispatchEvent(new Event('input'))");
    assert.equal(await press({shiftKey:true}),true);
    assert.equal(await press({}),false);
    await until(()=>a.executeJavaScript("rows.at(-1).body==='回车发送'"));
    await until(()=>ui("get('reply').value===''"));
    await ui("get('send').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));get('attach-menu').querySelectorAll('.reply-option')[1].click()");
    await ui("get('reply').value='组合键发送';get('reply').dispatchEvent(new Event('input'))");
    assert.equal(await press({}),true);
    assert.equal(await press({ctrlKey:true}),false);
    await until(()=>a.executeJavaScript("rows.at(-1).body==='组合键发送'"));
    await ui("localStorage.removeItem('send-key')");
    await ui("get('reply').value='周三发货';get('reply').dispatchEvent(new Event('input'))");
    assert.equal(await ui("get('reply').dispatchEvent(new KeyboardEvent('keydown',{key:'w',ctrlKey:true,bubbles:true,cancelable:true}))"),false);
    await until(()=>ui("get('reply').value==='测试译文 周三发货' && get('draft-proposal').hidden"));
    await ui("get('draft-translate').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))");
    assert.deepEqual(await ui("[...get('attach-menu').querySelectorAll('button')].map(b=>b.textContent)"),['直接替换输入框原文','先预览，确认后替换','快捷键：Ctrl + W · 点击更改']);
    await ui("get('attach-menu').querySelectorAll('button')[1].click();get('reply').value='再发一箱';get('reply').dispatchEvent(new Event('input'));get('draft-translate').click()");
    await until(()=>ui("!get('draft-proposal').hidden && get('draft-result').textContent==='测试译文 再发一箱' && get('reply').value==='再发一箱'"));
    await ui("localStorage.removeItem('translate-mode');get('reply').value='';get('reply').dispatchEvent(new Event('input'))");
    await ui("get('open-settings').click()");
    await until(()=>ui("get('settings-dialog').open && document.querySelector('input[name=send-key]:checked').value==='enter' && document.querySelector('input[name=translate-mode]:checked').value==='replace' && get('settings-translate-key').textContent==='Ctrl + W' && get('settings-voice').options.length>2"));
    if (process.env.RELAY_UI_CAPTURE) { await pause(1200); fs.writeFileSync(path.join(process.env.RELAY_UI_CAPTURE,'settings.png'),(await shell.capturePage()).toPNG()); }
    await ui("const pick=document.querySelector('input[name=send-key][value=mod]');pick.checked=true;pick.dispatchEvent(new Event('change',{bubbles:true}))");
    assert.equal(await ui("localStorage.getItem('send-key')==='mod' && get('send').title.includes('Enter 换行')"),true);
    await ui("get('settings-voice').value='none';get('settings-voice').dispatchEvent(new Event('change',{bubbles:true}))");
    await until(async()=>(await call('translationSettings')).voice==='none');
    await call('saveVoiceLanguage','en');
    await ui("localStorage.removeItem('send-key');get('settings-accounts').click()");
    await until(()=>ui("!get('settings-dialog').open && get('health-dialog').open"));
    await ui("get('health-close').click()");
    // Regression checks for the review findings.
    await call('openChat',me,'demo@c.us');
    await until(()=>ui("state.thread?.chat==='demo@c.us' && document.querySelectorAll('#bubbles .message').length>3"));
    await ui("window.keptRow=document.querySelector('#bubbles .message.incoming');const range=document.createRange();range.selectNodeContents(keptRow.querySelector('.message-text'));getSelection().removeAllRanges();getSelection().addRange(range);window.keptText=getSelection().toString();true");
    await a.executeJavaScript("events.get('chat.presence_change')({id:{_serialized:'demo@c.us'},state:'composing',isOnline:true});true");
    await until(()=>ui("!get('presence').hidden && get('presence').textContent==='正在输入…'"));
    assert.equal(await ui("keptRow.isConnected && keptText.length>0 && getSelection().toString()===keptText"),true);
    await a.executeJavaScript("events.get('chat.presence_change')({id:{_serialized:'demo@c.us'},state:'available',isOnline:true});true");
    await ui("getSelection().removeAllRanges()");
    const own=(await call('state')).messages.find(m=>m.outgoing && !m.media && m.text && m.type!=='revoked');
    await ui("composerExtras.edit(state.messages.find(m=>m.id==="+JSON.stringify(own.id)+"))");
    assert.equal(await ui("get('reply').value"),own.text);
    await call('openChat',me,G);
    await until(()=>ui("state.thread?.chat==="+JSON.stringify(G)+" && get('reply').value!=="+JSON.stringify(own.text)+" && get('reply-context').hidden"));
    await call('openChat',me,'demo@c.us');
    await until(()=>ui("state.thread?.chat==='demo@c.us'"));
    assert.equal(await ui("get('reply').value==='' && get('reply-context').hidden"),true);
    await ui("composerExtras.reply(state.messages.find(m=>m.id==="+JSON.stringify(own.id)+"))");
    await call('openChat',me,G);
    await until(()=>ui("state.thread?.chat==="+JSON.stringify(G)+" && get('reply-context').hidden"));
    await call('openChat',me,'demo@c.us');
    await until(()=>ui("state.thread?.chat==='demo@c.us' && !get('reply-context').hidden && get('context-text').textContent==="+JSON.stringify(own.text)));
    await ui("get('context-close').click()");
    const mainWindow=BrowserWindow.fromWebContents(shell);
    await require('./linked-features.cjs').readOnArrival({window:mainWindow,page:a,ui,call,until,Notification,pause});
    await assert.rejects(()=>call('send',me,'missing@c.us','x'),/会话不存在/);
    await ui("get('reply').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
    // Daily-use features.
    await call('openChat',me,G);
    await until(()=>ui("state.thread?.chat==="+JSON.stringify(G)));
    await ui("get('reply').value='草稿内容待发';get('reply').dispatchEvent(new Event('input'))");
    await a.executeJavaScript("for(let i=0;i<3;i++) sample('未读消息 '+i,'unread-probe-'+i);true");
    await until(async()=>(await call('state')).feed.messages.find(m=>m.chat==='demo@c.us')?.unreadCount>=3);
    await until(()=>ui("[...document.querySelectorAll('#list .row')].some(r=>r.querySelector('.draft-mark'))===false"));
    await call('openChat',me,'demo@c.us');
    await until(()=>ui("state.thread?.chat==='demo@c.us' && !!document.querySelector('.unread-divider') && /未读消息 0|正在看的会话里的新消息/.test(document.querySelector('.unread-divider').nextElementSibling.textContent)"));
    await until(()=>ui("[...document.querySelectorAll('#list .row')].find(r=>JSON.parse(r.dataset.message)[1]==="+JSON.stringify(G)+")?.querySelector('.snippet').textContent==='草稿：草稿内容待发'"));
    assert.equal(await ui("JSON.parse(localStorage.getItem('drafts')).some(([key,text])=>text==='草稿内容待发')"),true);
    await ui("get('scroll').scrollTop=0;get('scroll').dispatchEvent(new Event('scroll'))");
    await a.executeJavaScript("sample('滚动时到达的消息','jump-probe');true");
    await until(()=>ui("!get('jump-bottom').hidden && get('jump-count').textContent==='1'"));
    await ui("get('jump-bottom').click()");
    await until(()=>ui("get('jump-bottom').hidden"));
    await call('savePreferences',{templates:[{title:'发货说明',text:'您好，货物将在周三发出。'}]});
    await ui("preferences.save({})");
    await ui("get('reply').value='/发货';get('reply').dispatchEvent(new Event('input'))");
    await until(()=>ui("get('attach-menu').matches(':popover-open') && get('attach-menu').querySelector('.template-option strong')?.textContent==='发货说明'"));
    await ui("get('reply').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))");
    assert.equal(await ui("get('reply').value"),'您好，货物将在周三发出。');
    await ui("get('reply').value='';get('reply').dispatchEvent(new Event('input'))");
    const found=await call('searchMessages',null,'未读消息',false);
    assert.equal(found.length,3);
    await ui("get('open-search').click();get('search-query').value='未读消息 2';get('search-query').dispatchEvent(new Event('input'))");
    await until(()=>ui("get('search-results').querySelectorAll('.search-row').length===1"));
    await ui("get('search-results').querySelector('.search-row').click()");
    await until(()=>ui("!get('search-dialog').open && !!document.querySelector('.message.flash')?.textContent.includes('未读消息 2')"));
    const probe=(await call('state')).messages.find(m=>m.text==='未读消息 1');
    await call('star',me,'demo@c.us',probe.id,true);
    await until(async()=>(await call('searchMessages',me,'',true)).some(m=>m.id===probe.id));
    await ui("messageSelect.start(state.messages.find(m=>m.id==="+JSON.stringify(probe.id)+"))");
    await ui("[...document.querySelectorAll('#bubbles .message')].find(n=>n.textContent.includes('未读消息 2')).querySelector('.message-text').click()");
    assert.equal(await ui("!get('select-bar').hidden && get('select-count').textContent==='已选 2 条' && document.querySelectorAll('.message.picked').length===2 && !get('reply').checkVisibility()"),true);
    if (process.env.RELAY_UI_CAPTURE) { await pause(1200); fs.writeFileSync(path.join(process.env.RELAY_UI_CAPTURE,'multi-select.png'),(await shell.capturePage()).toPNG()); }
    await ui("get('select-forward').click()");
    await until(()=>ui("get('forward-dialog').open && get('forward-status').textContent.startsWith('转发 2 条消息') && get('forward-owner').options.length===2"));
    await ui("[...get('forward-results').querySelectorAll('.person-result')].find(b=>b.textContent.includes('华东代理群')).click()");
    await until(()=>ui("get('warning').textContent.startsWith('已转发 2 条给 华东代理群') && get('select-bar').hidden"));
    await call('openChat',me,G);
    await until(()=>ui("state.thread?.chat==="+JSON.stringify(G)+" && get('reply').value==='草稿内容待发'"));
    await a.executeJavaScript(`(() => {
      const msg={body:'@16505550102 请确认，@one 也看一下',type:'chat',author:{_serialized:'16505550103@c.us'},notifyName:'Leo',mentionedJidList:['16505550102@c.us','one'],
        id:{_serialized:'false_fixture@g.us_MENTION1',remote:'fixture@g.us',fromMe:false},t:now+700};
      rows.push(msg); events.get('chat.new_message')(msg);
    })()`);
    await until(()=>ui("[...document.querySelectorAll('.message.mentions-me .mention')].map(n=>n.textContent).join()==='@+16505550102,@你'"));
    await ui("get('reply').value='@';get('reply').setSelectionRange(1,1);get('reply').dispatchEvent(new Event('input'))");
    await until(()=>ui("get('attach-menu').matches(':popover-open') && get('attach-menu').dataset.kind==='mentions' && get('attach-menu').querySelectorAll('.reply-option').length>0"));
    await ui("get('attach-menu').querySelector('.reply-option').click()");
    assert.equal(await ui("get('reply').value"),'@+16505550102 ');
    await ui("get('composer').requestSubmit()");
    await until(()=>a.executeJavaScript("window.sentMention?.ids?.[0]==='16505550102@c.us' && window.sentMention.text==='@16505550102 '"));
    await ui("get('reply').value='';get('reply').dispatchEvent(new Event('input'))");
    const ownGroup=(await call('state')).messages.find(m=>m.outgoing && !m.system && m.text && m.type!=='revoked');
    await until(()=>ui('state.messages.some(m=>m.id==='+JSON.stringify(ownGroup.id)+')'));
    const details=await call('messageInfo',me,G,ownGroup.id);
    assert.equal(details.readers.length===1 && details.waiting===1,true);
    await ui("messageDetails.open(state.messages.find(m=>m.id==="+JSON.stringify(ownGroup.id)+"))");
    assert.equal(await ui("get('info-dialog').open"),true);
    const infoText = await ui("get('info-body').textContent");
    assert.match(infoText,/已读 · 1/);
    assert.match(infoText,/1 位成员尚未收到/);
    await ui("get('info-close').click()");
    await call('setEphemeral',me,G,604800);
    assert.equal((await call('contactInfo',me,G)).ephemeral,604800);
    await assert.rejects(()=>call('setEphemeral',me,'demo@c.us',604800));
    await require('./linked-features.cjs').crossAccount({call,a,b,me,other:accounts[1].id,chat:G,pixel});
    await call('openChat',me,'demo@c.us');
    for (const seconds of [86400,604800,7776000,0]) {
      await call('setEphemeral',me,'demo@c.us',seconds);
      assert.equal((await call('contactInfo',me,'demo@c.us')).ephemeral,seconds);
    }
    await a.executeJavaScript("rows.push({id:{_serialized:'archived-fixture-1',remote:'demo@c.us',fromMe:false},t:now-99000,type:'chat',body:'仅关联设备索引保存的旧消息'});true");
    assert.equal((await call('searchMessages',me,'仅关联设备索引',false)).length,0);
    const history = await call('searchHistory',me,'仅关联设备索引');
    assert.equal(history.unavailable,0); assert.equal(history.rows.length,1);
    await until(()=>ui("state.thread?.chat==='demo@c.us' && !get('thread-search').hidden"));
    await ui("get('message-query').value='仅关联设备索引';get('message-query').dispatchEvent(new Event('input'))");
    try { await until(()=>ui("get('bubbles').textContent.includes('仅关联设备索引保存的旧消息')")); }
    catch (error) {
      const result = await ui("({route,query:get('message-query').value,matches:get('match-status').textContent,warning:get('warning').textContent,loaded:state.messages.some(m=>m.id==='archived-fixture-1')})");
      throw new Error(error.message+' '+JSON.stringify(result));
    }
    await call('reorder',[accounts[1].id,me]);
    await until(()=>ui("[...document.querySelectorAll('#accounts .account')].map(b=>b.dataset.account).join()==="+JSON.stringify(accounts[1].id+','+me)));
    await call('reorder',[me,accounts[1].id]);
    await ui("get('open-settings').click()");
    await until(()=>ui("get('settings-dialog').open && get('template-list').textContent.includes('发货说明') && document.querySelector('[data-pref=notify]').checked && get('settings-version').textContent.startsWith('HaiA ')"));
    const releases = require('../src/main/release-check.cjs'), checkRelease = releases.checkRelease;
    try {
      releases.checkRelease = current => checkRelease(current,async () => Response.json({tag_name:'v0.10.0'}));
      await ui("get('check-update').click()");
      await until(()=>ui("get('update-status').textContent.includes('0.10.0') && !get('update-download').hidden"));
    } finally { releases.checkRelease = checkRelease; }
    await ui("const box=document.querySelector('[data-pref=sound]');box.checked=false;box.dispatchEvent(new Event('change',{bubbles:true}))");
    await until(async()=>(await call('preferences')).sound===false);
    await call('savePreferences',{sound:true,templates:[]});
    await ui("get('settings-close').click()");
    console.log('PASS: unread divider, jump button, drafts, quick replies, search, starred, multi-select, mentions, message info, timer, reorder and preferences');
    console.log('PASS: location, contact card, poll votes, links, stars, labels, calls, status, group members, chat menu and archive');
    if (process.env.RELAY_PERF) {
      // Performance probe: the same steps are run before and after an optimisation and the printed numbers compared.
      const perfChat='perf@c.us', MB=1048576;
      const memory=()=>app.getAppMetrics().reduce((sum,p)=>sum+p.memory.workingSetSize,0)/1024;
      const measure=async work=>{
        const base=memory(); let peak=base; const timer=setInterval(()=>{peak=Math.max(peak,memory());},40); const start=Date.now();
        try { const value=await work(); return {ms:Date.now()-start,peakMB:Math.round(peak-base),value}; } finally { clearInterval(timer); }
      };
      await a.executeJavaScript(`(() => {
        const contact={id:'${perfChat}',formattedTitle:'性能测试'}; chats.set(contact.id,contact);
        const thumb='A'.repeat(30000);
        for (let i=0;i<140;i++) {
          const picture=i%2===0;
          const msg={body:picture ? thumb : '第 '+i+' 条消息，用于测量渲染耗时。',id:{_serialized:'false_${perfChat}_P'+i,remote:contact.id,fromMe:false},type:picture ? 'image' : 'chat',
            caption:picture ? '图 '+i : undefined,mimetype:'image/jpeg',t:now-5000+i*70};
          rows.push(msg); events.get('chat.new_message')(msg);
        }
        blobs.set('false_${perfChat}_VIDEO','big:'+40*1048576);
        const video={body:'',id:{_serialized:'false_${perfChat}_VIDEO',remote:contact.id,fromMe:false},type:'video',mimetype:'video/mp4',caption:'大视频',size:40*1048576,t:now+900};
        rows.push(video); events.get('chat.new_message')(video);
      })()`);
      await until(async()=>(await call('state')).feed?.messages.some(m=>m.chat===perfChat) || (await call('state')).messages.some(m=>m.chat===perfChat));
      await call('openChat',me,perfChat);
      await until(()=>ui("document.querySelectorAll('#bubbles .message').length>=140"));
      await pause(1500);
      const renderPerf=await ui(`(async()=>{
        let added=0; const watch=new MutationObserver(list=>{for(const m of list) added+=m.addedNodes.length;});
        watch.observe(get('bubbles'),{childList:true,subtree:true});
        const rounds=40, start=performance.now();
        for (let i=0;i<rounds;i++) render({...state,thread:{...state.thread,presence:{state:i%2 ? 'composing' : 'available',who:''}}});
        const ms=(performance.now()-start)/rounds;
        await new Promise(r=>setTimeout(r,50)); watch.disconnect();
        return {renderMs:+ms.toFixed(2),nodesAddedPerUpdate:Math.round(added/rounds),bubbles:document.querySelectorAll('#bubbles .message').length};
      })()`);
      // Bytes sent to the window for one update, measured on the channel itself.
      const sent=[]; const original=shell.send.bind(shell);
      shell.send=(channel,...args)=>{ if (channel==='desk:update') sent.push(JSON.stringify(args[0]).length); return original(channel,...args); };
      for (let i=0;i<8;i++) { await a.executeJavaScript("events.get('chat.presence_change')({id:{_serialized:'perf@c.us'},state:"+JSON.stringify(i%2 ? 'composing' : 'available')+",isOnline:true});true"); await pause(1400); }
      shell.send=original;
      const updateKB=sent.length ? Math.round(sent.reduce((x,y)=>x+y,0)/sent.length/1024) : null;
      const view=await measure(()=>ui("window.desk.media("+JSON.stringify(me)+",'perf@c.us','false_perf@c.us_VIDEO').then(v=>v.length)"));
      // After the fix the window receives an address; the bytes are checked through the same protocol the window uses.
      const address=await ui("window.desk.media("+JSON.stringify(me)+",'perf@c.us','false_perf@c.us_VIDEO')");
      const served=address.startsWith('haia-media:') ? {bytes:(await (await shell.session.fetch(address)).arrayBuffer()).byteLength,
        range:await shell.session.fetch(address,{headers:{Range:'bytes=100-199'}}).then(async r=>[r.status,(await r.arrayBuffer()).byteLength,r.headers.get('content-range')])} : null;
      const big=path.join(dir,'perf-upload.bin'); fs.writeFileSync(big,Buffer.alloc(40*MB,7));
      shell.debugger.attach('1.3');
      const {root}=await shell.debugger.sendCommand('DOM.getDocument');
      const {nodeId}=await shell.debugger.sendCommand('DOM.querySelector',{nodeId:root.nodeId,selector:'#attach-input'});
      await a.executeJavaScript('window.lastFileBytes=0;true');
      const send=await measure(async()=>{
        await shell.debugger.sendCommand('DOM.setFileInputFiles',{nodeId,files:[big]});
        await until(()=>ui("document.querySelectorAll('.attachment').length===1 && !get('send').disabled"));
        await ui("get('composer').requestSubmit()");
        for (let i=0;i<600;i++) { if (await a.executeJavaScript('window.lastFileBytes')>0) break; await pause(100); }
        return a.executeJavaScript('window.lastFileBytes');
      });
      shell.debugger.detach();
      console.log('PERF '+JSON.stringify({render:renderPerf,updateKB,updates:sent.length,viewVideo40MB:{ms:view.ms,peakMB:view.peakMB,resultChars:view.value,served},sendFile40MB:{ms:send.ms,peakMB:send.peakMB,bytesReceived:send.value}}));
    }
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
