const {net}=require('electron');
const {request,requestId}=require('./transport.cjs');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
class RemoteAccount{
 constructor(account,descriptor,onBatch){
  this.account=account;this.descriptor=descriptor;this.onBatch=onBatch;this.status='loading';this.identity='';this.disposed=false;this.ses={fetch:(...args)=>net.fetch(...args)};this.load();
 }
 load(){this.controller?.abort();this.controller=new AbortController();void this.poll(this.controller.signal);}
 async poll(signal){
  let epoch='',after=-1;
  while(!this.disposed&&!signal.aborted){
   try{
    let data,problem;const urls=this.base?[this.base,...this.descriptor.urls.filter(u=>u!==this.base)]:this.descriptor.urls;
    for(const base of urls){try{data=await request(this.descriptor,base,'/v1/events?epoch='+encodeURIComponent(epoch)+'&after='+after,undefined,signal);this.base=base;break;}catch(e){problem=e;if(signal.aborted)return;}}
    if(!data)throw problem||Error('无法连接共享主机');
    epoch=this.epoch=data.epoch;after=data.seq;
    for(const batch of data.batches){if(this.disposed||signal.aborted)return;this.status=batch.status;this.identity=batch.identity||this.identity;this.onBatch(this,{...batch,sharedReset:data.reset});}
   }catch(error){
    if(signal.aborted||this.disposed)return;this.status='offline';this.onBatch(this,{status:'offline',messages:[],sharedError:error.message});await delay(3000);
   }
  }
 }
 async call(method,...args){
  if(this.disposed||!this.base||!this.epoch)throw Error('共享主机尚未连接');
  const data={id:requestId(),epoch:this.epoch,method,args};let result;
  for(let attempt=0;attempt<2;attempt++){try{result=await request(this.descriptor,this.base,'/v1/call',data,this.controller.signal);break;}catch(e){if(attempt)throw e;}}
  if(result.error)throw Error(result.error);return result.value;
 }
 moreHistory(){return this.call('more');}
 pair(){throw Error('请在共享主机上关联此账号');}
 reveal(){this.onBatch(this,{status:this.status,identity:this.identity,messages:[],sharedError:'此账号通过共享主机连接'});}
 close(){this.disposed=true;this.controller?.abort();}
}
module.exports={RemoteAccount};
