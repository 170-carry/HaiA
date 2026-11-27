const https=require('node:https'),crypto=require('node:crypto');
function request(descriptor,base,route,body,signal){
 return new Promise((resolve,reject)=>{
  const data=body===undefined?null:Buffer.from(JSON.stringify(body));
  const req=https.request(new URL(route,base),{method:data?'POST':'GET',ca:descriptor.cert,minVersion:'TLSv1.2',
   checkServerIdentity:(_host,cert)=>cert.fingerprint256===descriptor.fingerprint?undefined:Error('共享主机证书不匹配'),
   headers:{Authorization:'Bearer '+descriptor.token,...(data?{'Content-Type':'application/json','Content-Length':data.length}:{})},signal},res=>{
    let size=0;const chunks=[];
    res.on('data',chunk=>{size+=chunk.length;if(size>64*1048576){res.destroy();reject(Error('共享响应超过限制'));}else chunks.push(chunk);});
    res.on('end',()=>{try{const value=JSON.parse(Buffer.concat(chunks));if(res.statusCode!==200)throw Error(value.error||'共享主机暂不可用');resolve(value);}catch(e){reject(e);}});
    res.on('error',reject);
   });
  req.setTimeout(30000,()=>req.destroy(Error('连接共享主机超时')));req.on('error',reject);if(data)req.write(data);req.end();
 });
}
const requestId=()=>crypto.randomUUID();
module.exports={request,requestId};
