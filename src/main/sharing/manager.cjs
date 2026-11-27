const {ShareStore}=require('./store.cjs');
const {ShareHost}=require('./host.cjs');
const {RemoteAccount}=require('./remote.cjs');
class Sharing{
 constructor(desk,dir){this.desk=desk;this.store=new ShareStore(dir);this.host=new ShareHost(desk,this.store);if(Object.keys(this.store.data.tokens).length)void this.host.start().catch(()=>{});}
 remote(account,receive){const descriptor=this.store.remote(account.id);if(!descriptor)throw Error('共享连接资料缺失');return new RemoteAccount(account,descriptor,receive);}
 descriptor(account){return account.shared?this.store.remote(account.id):this.host.descriptor(account.id);}
 receive(session,batch){if(!session.account.shared)this.host.publish(session.account.id,batch);}
 delivered(session,message){if(!session.account.shared)this.host.publish(session.account.id,{...this.host.snapshot(session.account.id),messages:[message]});}
 revoke(id){this.store.revoke(id);}
 close(){this.host.close();}
}
module.exports={Sharing};
