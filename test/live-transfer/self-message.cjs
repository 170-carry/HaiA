// Invoked only by an explicitly authorized self-message test, never by ordinary import checks.
async function sendSelfMessage(text) {
  const own=WPP.conn.getMyUserWid()?.toString();
  if(!own||!WPP.conn.isAuthenticated()||WPP.conn.getStreamData()?.mode!=='MAIN')throw Error('Self-test account is not connected');
  const result=await WPP.chat.sendTextMessage(own,text,{createChat:true,waitForAck:false});
  window.relayReader?.more();
  return {id:result.id?._serialized||String(result.id),ack:result.ack};
}
async function readSelfMessages(texts) {
  const ids=[WPP.conn.getMyUserWid(),WPP.conn.getMyUserLid?.()].filter(Boolean);
  for(const id of ids){try{await WPP.chat.getMessages(id,{count:30})}catch{}}
  const rows=WPP.whatsapp.MsgStore.getModelsArray();
  return texts.map(text=>{const matches=rows.filter(m=>m.body===text);return {seen:matches.length>0,count:matches.length,ack:matches.at(-1)?.ack??null};});
}
async function selfChat(texts){return WPP.whatsapp.MsgStore.getModelsArray().find(m=>texts.includes(m.body))?.id?.remote?.toString()||null;}
async function resumeSelfMessage(id){
 const m=WPP.whatsapp.MsgStore.getModelsArray().find(m=>m.id?._serialized===id);
 if(!m)return {found:false};
 if(m.isSendFailure)await window.require('WAWebResendMsgAction').resendMsg(m);
 return {found:true,ack:m.ack,failed:!!m.isSendFailure};
}
module.exports={sendSelfMessage,readSelfMessages,selfChat,resumeSelfMessage};
