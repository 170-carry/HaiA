const crypto=require('node:crypto');
// A private, pinned TLS identity. RSA/SHA-256 signing is performed by Node/OpenSSL.
const der=(tag,...parts)=>{const data=Buffer.concat(parts.map(p=>Buffer.from(p)));let n=data.length;const bytes=[];do{bytes.unshift(n&255);n>>>=8;}while(n);return Buffer.concat([Buffer.from([tag,...(data.length<128?[data.length]:[128|bytes.length,...bytes])]),data]);};
const seq=(...v)=>der(48,...v), integer=v=>der(2,Buffer.from([v])), oid=hex=>der(6,Buffer.from(hex,'hex'));
const algorithm=()=>seq(oid('2a864886f70d01010b'),der(5));
function makeIdentity(){
 const keys=crypto.generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'der'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
 const name=seq(der(49,seq(oid('550403'),der(12,Buffer.from('HaiA private sharing')))));
 const time=date=>der(23,Buffer.from(date.toISOString().replace(/\D/g,'').slice(2,14)+'Z'));
 const now=new Date(Date.now()-86400000),end=new Date(Date.now()+5*365*86400000);
 const ext=der(163,seq(seq(oid('551d13'),der(1,[255]),der(4,seq(der(1,[255])))),seq(oid('551d0f'),der(1,[255]),der(4,der(3,[2,164])))));
 const tbs=seq(der(160,integer(2)),der(2,Buffer.concat([Buffer.from([0]),crypto.randomBytes(16)])),algorithm(),name,seq(time(now),time(end)),name,keys.publicKey,ext);
 const certificate=seq(tbs,algorithm(),der(3,Buffer.concat([Buffer.from([0]),crypto.sign('sha256',tbs,keys.privateKey)])));
 const cert='-----BEGIN CERTIFICATE-----\n'+certificate.toString('base64').match(/.{1,64}/g).join('\n')+'\n-----END CERTIFICATE-----\n';
 const parsed=new crypto.X509Certificate(cert);
 if(!parsed.verify(parsed.publicKey))throw Error('共享连接证书生成失败');
 return {key:keys.privateKey,cert,fingerprint:parsed.fingerprint256};
}
module.exports={makeIdentity};
