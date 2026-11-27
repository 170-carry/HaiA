const https=require('node:https'),crypto=require('node:crypto'),os=require('node:os');
const {makeIdentity}=require('./identity.cjs');
const {Journal}=require('./journal.cjs');
const methods=new Set(('thread markRead watch typing mediaOpen mediaPiece mediaClose uploadOpen uploadPiece uploadClose uploadSend react remove edit sendSpecial star messageInfo setEphemeral profileInfo profileSave chatLabels setLabel groupMembers statusList statusItems statusPost statusMedia searchPeople contactInfo renameContact chatSetting requestReview photo listGroups groupInfo saveGroup groupInvite send forward createGroup sendFile more backupChats backupMessages searchHistory historyHit').split(' '));
const outgoing=new Set(['send','sendFile','sendSpecial','uploadSend']);
class ShareHost{
 constructor(desk,store){this.desk=desk;this.store=store;this.journals=new Map();this.commands=new Map();this.pending=new Set();}
 snapshot(id){
  const s=this.desk.sessions.get(id),dir=this.desk.inbox.conversations;
  return {status:s?.status||'offline',identity:s?.identity||'',messages:[...(this.desk.inbox.byAccount.get(id)?.values()||[])].slice(-1000),
   directory:dir.page(5000,id).messages,chatUnread:[...(dir.unread.get(id)||[])],unread:s?.unread||0,more:!!s?.more};
 }
 journal(id){if(!this.journals.has(id))this.journals.set(id,new Journal(()=>this.snapshot(id)));return this.journals.get(id);}
 publish(id,batch){if(this.store.data.tokens[id])this.journal(id).publish(batch);}
 async start(){
  if(this.server)return this.port;if(this.starting)return this.starting;
  this.starting=(async()=>{
   if(!this.store.data.identity){this.store.data.identity=makeIdentity();this.store.save();}
   this.server=https.createServer({...this.store.data.identity,minVersion:'TLSv1.2'},(req,res)=>void this.handle(req,res));
   this.server.headersTimeout=15000;this.server.requestTimeout=45000;
   await new Promise((resolve,reject)=>{this.server.once('error',reject);this.server.listen(this.store.data.port||0,'0.0.0.0',resolve);});
   this.port=this.server.address().port;this.store.data.port=this.port;this.store.save();return this.port;
  })();return this.starting;
 }
 async descriptor(id){
  const port=await this.start(),hosts=[];
  if(process.env.HAIA_SHARE_HOST)hosts.push(process.env.HAIA_SHARE_HOST);
  for(const list of Object.values(os.networkInterfaces()))for(const net of list||[])if(net.family==='IPv4'&&!net.internal&&!net.address.startsWith('169.254.'))hosts.push(net.address);
  if(!hosts.length)hosts.push('127.0.0.1');
  return {version:1,token:this.store.token(id),cert:this.store.data.identity.cert,urls:[...new Set(hosts)].slice(0,16).map(host=>'https://'+host+':'+port)};
 }
 owner(req){
  const raw=req.headers.authorization||'',token=raw.startsWith('Bearer ')?raw.slice(7):'';
  if(!/^[a-f0-9]{64}$/.test(token))return null;
  return Object.keys(this.store.data.tokens).find(id=>crypto.timingSafeEqual(Buffer.from(this.store.data.tokens[id]),Buffer.from(token)))||null;
 }
 async handle(req,res){
  const send=(code,value)=>{if(!res.destroyed){res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));}};
  const owner=this.owner(req);if(!owner)return send(401,{error:'共享连接未授权'});
  const controller=new AbortController();this.pending.add(controller);res.on('close',()=>controller.abort());
  try{
   const url=new URL(req.url,'https://localhost'),journal=this.journal(owner);
   if(req.method==='GET'&&url.pathname==='/v1/events')return send(200,await journal.poll(url.searchParams.get('epoch'),Number(url.searchParams.get('after')),controller.signal));
   if(req.method!=='POST'||url.pathname!=='/v1/call')return send(404,{error:'未知请求'});
   let length=0;const parts=[];for await(const chunk of req){length+=chunk.length;if(length>32*1048576)throw Error('共享请求过大');parts.push(chunk);}
   const call=JSON.parse(Buffer.concat(parts));
   if(!call||!methods.has(call.method)||!Array.isArray(call.args)||call.args.length>8||!/^[a-f0-9-]{36}$/.test(call.id))throw Error('共享请求无效');
   if(call.epoch!==journal.epoch)return send(409,{error:'共享主机已重启，请确认上次操作结果后重试'});
   const key=owner+'/'+call.id;
   if(!this.commands.has(key)){
    const task=this.invoke(owner,call.method,call.args).then(value=>({value}),error=>({error:error.message}));this.commands.set(key,task);
    if(this.commands.size>1000)this.commands.delete(this.commands.keys().next().value);
   }
   send(200,await this.commands.get(key));
  }catch(error){send(400,{error:error.message||'共享操作失败'});}finally{this.pending.delete(controller);}
 }
 async invoke(id,method,args){
  const s=this.desk.sessions.get(id);if(!s||s.account.shared)throw Error('共享账号已移除');
  if(s.status!=='online')throw Error('共享主机上的账号尚未连接');
  const result=method==='photo'?await require('../profile-photo.cjs').readPhoto(s,args[0]):await s.call(method,...args);
  if(outgoing.has(method)&&result?.id){this.desk.inbox.add(id,[result]);this.desk.publish();this.publish(id,{...this.snapshot(id),messages:[result]});}
  return result;
 }
 close(){for(const controller of this.pending)controller.abort();for(const j of this.journals.values())j.close();this.server?.closeAllConnections();this.server?.close();}
}
module.exports={ShareHost,methods};
