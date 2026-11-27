const crypto=require('node:crypto');
class Journal{
 constructor(snapshot){this.snapshot=snapshot;this.epoch=crypto.randomUUID();this.seq=0;this.rows=[];this.waiters=new Set();}
 publish(batch){this.rows.push({seq:++this.seq,batch:JSON.parse(JSON.stringify(batch))});if(this.rows.length>256)this.rows.shift();for(const wake of [...this.waiters])wake();}
 read(epoch,after){
  if(epoch!==this.epoch||!Number.isSafeInteger(after)||after<0||after>this.seq||after<(this.rows[0]?.seq||1)-1)return {epoch:this.epoch,seq:this.seq,reset:true,batches:[this.snapshot()]};
  return {epoch:this.epoch,seq:this.seq,reset:false,batches:this.rows.filter(r=>r.seq>after).map(r=>r.batch)};
 }
 async poll(epoch,after,closed){
  let value=this.read(epoch,after);if(value.batches.length||closed?.aborted)return value;
  await new Promise(resolve=>{let timer;const wake=()=>{clearTimeout(timer);this.waiters.delete(wake);closed?.removeEventListener('abort',wake);resolve();};this.waiters.add(wake);closed?.addEventListener('abort',wake,{once:true});timer=setTimeout(wake,20000);});
  return this.read(epoch,after);
 }
 close(){for(const wake of [...this.waiters])wake();}
}
module.exports={Journal};
