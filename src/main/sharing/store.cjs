const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
class ShareStore{
 constructor(dir){this.file=path.join(dir,'shared-connections.json');this.data=fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):{tokens:{},remotes:{}};}
 save(){fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.writeFileSync(this.file+'.tmp',JSON.stringify(this.data),{mode:0o600,flush:true});fs.renameSync(this.file+'.tmp',this.file);}
 token(id){if(!this.data.tokens[id]){this.data.tokens[id]=crypto.randomBytes(32).toString('hex');this.save();}return this.data.tokens[id];}
 remote(id,value){if(value){this.data.remotes[id]=validateDescriptor(value);this.save();}return this.data.remotes[id];}
 revoke(id){delete this.data.tokens[id];delete this.data.remotes[id];this.save();}
}
function validateDescriptor(d){
 if(!d||d.version!==1||typeof d.token!=='string'||!/^[a-f0-9]{64}$/.test(d.token)||typeof d.cert!=='string'||d.cert.length>10000||!Array.isArray(d.urls)||!d.urls.length||d.urls.length>16)throw Error('共享连接资料无效');
 const cert=new crypto.X509Certificate(d.cert);
 if(!cert.verify(cert.publicKey))throw Error('共享连接证书无效');
 const urls=d.urls.map(value=>{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/'||value.length>500)throw Error('共享连接地址无效');return u.origin;});
 return {version:1,token:d.token,cert:d.cert,urls,fingerprint:cert.fingerprint256};
}
module.exports={ShareStore,validateDescriptor};
