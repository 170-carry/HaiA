const fs = require('node:fs');
const {createHash} = require('node:crypto');
const {Readable,Transform} = require('node:stream');
const {pipeline} = require('node:stream/promises');

async function verifyFile(path,release) {
  const hash = createHash('sha256');
  let bytes = 0;
  for await(const chunk of fs.createReadStream(path)) { bytes += chunk.length; hash.update(chunk); }
  if (bytes !== release.size || hash.digest('hex') !== release.sha256) throw Error('安装包校验失败，请重新下载');
}
async function download(fetch,release,path,progress) {
  const response = await fetch(release.url,{signal:AbortSignal.timeout(30*60*1000)});
  if (!response.ok || !response.body) throw Error('下载失败（HTTP '+response.status+'），请重试');
  let received=0, last=-1;
  const hash=createHash('sha256');
  const meter=new Transform({transform(chunk,encoding,done) {
    received+=chunk.length;
    if (received>release.size) return done(Error('下载大小与签名清单不一致'));
    hash.update(chunk);
    const percent=Math.floor(received*100/release.size);
    if (percent!==last) { last=percent; progress(percent); }
    done(null,chunk);
  }});
  await pipeline(Readable.fromWeb(response.body),meter,fs.createWriteStream(path,{flags:'wx',mode:0o600}));
  if (received!==release.size || hash.digest('hex')!==release.sha256) throw Error('安装包校验失败，请重新下载');
}
module.exports={download,verifyFile};
