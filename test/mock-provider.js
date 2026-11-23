// Test-only in-page provider. The test process blocks all WhatsApp network requests.
const events = new Map(), rows = [], blobs = new Map(), reacted = new Map();
const now = Math.floor(Date.now()/1000);
const chat = { id:'demo@c.us', formattedTitle:'林嘉敏', t:now };
const chats = new Map([[chat.id,chat]]);
window.sample = (body, id, fromMe = false, contact = chat, minutesAgo = 0, extra = {}) => {
  contact.unreadCount = (chats.get(contact.id)?.unreadCount || 0) + (fromMe ? 0 : 1);
  chats.set(contact.id, contact);
  events.get('chat.unread_count_changed')?.({chat:contact,unreadCount:contact.unreadCount});
  const msg = {body, id:{_serialized:id,remote:contact.id,fromMe}, type:'chat',t:now-minutesAgo*60+rows.length,...extra};
  rows.push(msg); events.get('chat.new_message')?.(msg); return msg;
};
const timerModules = {
  JSResourceForInteraction:()=>({load:async()=>true}),
  WAWebChangeEphemeralDurationChatAction:{changeEphemeralDuration:async(chat,seconds,entry,trigger)=>{
    if (entry!==1 || trigger!=='chat_settings') throw Error('bad timer arguments');
    chat.ephemeralDuration=seconds;
  }},
  WAWebEphemeralityTypes:{DisappearingModeTrigger:{ChatSettings:'chat_settings'}},
  WAWebWamEnumEphemeralSettingEntryPointType:{EPHEMERAL_SETTING_ENTRY_POINT_TYPE:{CHAT_INFO:1}}
};
window.require = name => timerModules[name] || (name === 'WAWebSendNonMessageDataRequest' ? {sendPeerDataOperationRequest:async(_kind,{chatId})=>{window.testTransfer=chatId;}} : null);
window.tags = [{id:'1',name:'新客户',hexColor:'#407776'}];
window.statuses = [{id:'vivian@c.us',contact:{name:'采购 · Vivian'},totalCount:1,unreadCount:1,t:now,msgs:{getModelsArray:()=>[{id:{_serialized:'false_status@broadcast_S1_vivian@c.us'},t:now,type:'chat',body:'本周新品到货',backgroundColor:0xff145347}]}}];
window.WPP = {
  whatsapp:{msgFindSearch:async({searchTerm,count})=>({messages:rows.filter(m=>m.body?.includes(searchTerm)).slice(-count),eof:true}),StatusV3Store:{getModelsArray:()=>window.statuses},MsgStore:{getMessagesById:async ids=>({messages:(window.restoredRows || []).filter(m=>ids.includes(m.id._serialized))}),on:(name,fn)=>events.set('model:'+name,fn)}},
  on: (name, cb) => events.set(name,cb),
  loader: {isReady:true,onReady:cb=>cb()},
  conn: {
    async startLinkDeviceCodeForPhoneNumber(phone, push) {
      if (phone!=='12025550144' || push!==false) throw new Error('invalid test inputs');
      events.get('conn.link_code_change')('ABCD1234');
      return 'ABCD1234';
    },
    cancelLinkDeviceCode(){},isAuthenticated:()=>!!localStorage.owner,isMainReady:()=>!!localStorage.owner,getMyUserId:()=>localStorage.owner},
  group:{create:async(name,members)=>{const id='new-group@g.us';chats.set(id,{id,formattedTitle:name,t:now,groupMetadata:{subject:name}});
      return {gid:{_serialized:id},participants:Object.fromEntries(members.map((m,i)=>[m,{wid:m,code:i ? 403 : 200}]))};},ensureGroup:async id=>chats.get(id), getParticipants:async()=>[{id:'16505550102@c.us',isAdmin:true},{id:localStorage.owner,isAdmin:true},...(window.added || []).map(id=>({id}))],
    setProperty:async(id,_name,value)=>{chats.get(id).groupMetadata.ephemeralDuration=value;return true;},
    addParticipants:async(_g,ids)=>{window.added=ids.slice(0,1);return Object.fromEntries(ids.map((m,i)=>[m,{wid:m,code:i ? 403 : 200}]));},removeParticipants:async(_g,ids)=>{window.added=(window.added || []).filter(id=>!ids.includes(id));},promoteParticipants:async()=>{},demoteParticipants:async()=>{},
    setSubject:async(id,name)=>{chats.get(id).groupMetadata.subject=name;return true;},setDescription:async()=>false},
  contact: {getProfilePictureUrl: async id => {
    if (id !== localStorage.owner && id !== 'vivian@c.us') return null;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 48;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = localStorage.owner === 'one' ? '#575399' : '#a06448';
    ctx.fillRect(0,0,48,48);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 24px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(id === 'vivian@c.us' ? 'V' : localStorage.owner === 'one' ? 'A' : 'B',24,32);
    return canvas.toDataURL();
  },list:async()=>[{id:'16505550123@c.us',name:'目录联系人'}],subscribePresence:async id=>{window.watched=id;return [];},
    get:async id=>({pushname:'Jiamin',isBusiness:true,isMyContact:!!chats.get(id)?.saved,name:chats.get(id)?.saved,phoneNumber:{_serialized:'6581234567@c.us'}}),
    getStatus:async()=>'工作日 9:00–18:00 在线',getCommonGroups:async()=>['fixture@g.us'],
    getBusinessProfile:async()=>({description:'精密五金配件采购',categories:[{localized_display_name:'批发'}],email:'buyer@example.test',website:['https://example.test']}),
    save:async(id,name)=>{const c=chats.get(id);c.saved=name;c.formattedTitle=name;},remove:async id=>{const c=chats.get(id);delete c.saved;c.formattedTitle='+65 8123 4567';}},
  profile:{isBusiness:()=>localStorage.owner==='one'},
  labels:{getAllLabels:async()=>window.tags,addNewLabel:async name=>{const tag={id:String(window.tags.length+1),name,hexColor:'#4e729a'};window.tags.push(tag);return tag;},
    addOrRemoveLabels:async(id,o)=>{const c=chats.get(id);c.labels=(c.labels || []).filter(l=>l!==o.labelId);if(o.type==='add')c.labels.push(o.labelId);}},
  status:{get:id=>window.statuses.find(s=>s.id===id),sendTextStatus:async text=>{window.posted=text;}},
  call:{enableCallInterface:async()=>{},offer:async(to,o)=>{events.get('call.outgoing_call')({id:'out-1',peerJid:to,isVideo:!!o.isVideo});},
    accept:async id=>{events.get('call.accepted')({id});},end:async id=>{events.get('call.ended')({id});},reject:async id=>{window.rejected=id;events.get('call.ended')({id});},setMute:async()=>true},
  blocklist:{isBlocked:id=>!!chats.get(id)?.blocked,blockContact:async id=>{chats.get(id).blocked=true;},unblockContact:async id=>{chats.get(id).blocked=false;}},
  chat: {
    getMessageById:async id=>rows.find(row=>row.id._serialized===id),
    markIsRead:async id=>{
      const c=chats.get(id); c.unreadCount=0;events.get('chat.unread_count_changed')?.({chat:c,unreadCount:0});return true;
    }, get:id=>chats.get(id), list:async()=>[...chats.values()],getMessages:async id=>rows.filter(r=>r.id.remote===id),
    sendTextMessage:async(chatId,text,options)=>{
      window.sentMention={text,ids:options.mentionedList};
      const origin=options?.quotedMsg && rows.find(r=>r.id._serialized===options.quotedMsg);
      const extra=origin ? {quotedMsg:origin,quotedStanzaID:origin.id._serialized.split('_')[2],quotedParticipant:'16505550102@c.us'} : {};
      return {id:window.sample(text,'true_'+chatId+'_SENT'+rows.length,true,chats.get(chatId),0,extra).id._serialized};
    },
    sendFileMessage:async(chatId,data,options)=>{
      // Test hook: record how many bytes arrived, whether as a data URL or as a Blob.
      window.lastFileBytes=typeof data==='string' ? Math.floor((data.length-data.indexOf(',')-1)*3/4) : data.size;
      const mimetype=typeof data==='string' ? /^data:([^;]+)/.exec(data)[1] : data.type || options.mimetype || 'application/octet-stream', id='true_'+chatId+'_FILE'+rows.length;
      blobs.set(id,typeof data==='string' && data.length<200000 ? data : 'big:'+window.lastFileBytes);
      if (window.lastFileBytes < 1024) window.lastUpload={name:options.filename,caption:options.caption,chat:chatId,
        base64:typeof data==='string' ? data.split(',')[1] : btoa(String.fromCharCode(...new Uint8Array(await data.arrayBuffer())))};
      const type=mimetype.startsWith('image/') ? 'image' : mimetype.startsWith('audio/') ? 'audio' : 'document';
      window.sample('',id,true,chats.get(chatId),0,{type,mimetype,filename:options.filename,caption:options.caption,size:data.length});
      return {id};
    },
    downloadMedia:async id=>String(blobs.get(id)).startsWith('big:') ? new Blob([new Uint8Array(Number(blobs.get(id).slice(4)))],{type:'video/mp4'}) : (await fetch(blobs.get(id))).blob(),
    sendReactionToMessage:async(id,emoji)=>{ if(emoji) reacted.set(id,emoji); else reacted.delete(id); },
    getReactions:async id=>({reactions:reacted.has(id) ? [{aggregateEmoji:reacted.get(id),hasReactionByMe:true,senders:[{}]}] : []}),
    deleteMessage:async(_chat,id,_media,revoke)=>({id,isRevoked:!!revoke,isDeleted:!revoke}),
    editMessage:async(id,text)=>{ rows.find(r=>r.id._serialized===id).body=text; return {id}; },
    sendLocationMessage:async(chatId,o)=>({id:window.sample('',  'true_'+chatId+'_LOC'+rows.length,true,chats.get(chatId),0,{type:'location',lat:Number(o.lat),lng:Number(o.lng),loc:o.name}).id._serialized}),
    sendVCardContactMessage:async(chatId,c)=>({id:window.sample('BEGIN:VCARD\nFN:'+c.name+'\nTEL;waid='+c.id.split('@')[0]+':+'+c.id.split('@')[0]+'\nEND:VCARD','true_'+chatId+'_VC'+rows.length,true,chats.get(chatId),0,{type:'vcard',vcardFormattedName:c.name}).id._serialized}),
    sendCreatePollMessage:async(chatId,name,options)=>({id:window.sample('','true_'+chatId+'_POLL'+rows.length,true,chats.get(chatId),0,{type:'poll_creation',pollName:name,pollOptions:options.map(o=>({name:o}))}).id._serialized}),
    getMessageACK:async()=>({deliveryRemaining:1,participants:[{wid:'16505550102@c.us',readAt:now,deliveredAt:now-5}]}),
    getVotes:async()=>({votes:[{selectedOptions:[1]},{selectedOptions:[1]},{selectedOptions:[0]}]}),
    starMessage:async(id,star)=>({id,star}), markIsUnread:async id=>{const c=chats.get(id);c.unreadCount=-1;events.get('chat.unread_count_changed')?.({chat:c,unreadCount:-1});},
    forwardMessage:async(to,id)=>{ window.forwarded=[to,id]; return true; },
    markIsComposing:async id=>{ window.composing=id; }, markIsPaused:async()=>{},
    mute:async id=>{chats.get(id).isMuted=true;},unmute:async id=>{chats.get(id).isMuted=false;},pin:async(id,on)=>{chats.get(id).pin=on?1:0;},archive:async(id,on)=>{chats.get(id).archive=on;}
  }
};
