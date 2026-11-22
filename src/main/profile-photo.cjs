const { nativeImage } = require('electron');

async function readPhoto(account, who) {
  if (account?.status !== 'online' || typeof who !== 'string' || who.length > 180) return null;
  const owner = account.identity;
  const source = await account.call('photo',who);
  if (typeof source !== 'string' || source.length > 4200000) return null;
  let image;
  if (/^data:image\/(?:jpeg|png|webp);base64,/i.test(source)) {
    image = nativeImage.createFromDataURL(source);
  } else {
    const url = new URL(source);
    if (url.protocol !== 'https:' || !/(^|\.)(whatsapp\.net|whatsapp\.com|fbcdn\.net|fbsbx\.com)$/.test(url.hostname)) return null;
    const response = await account.ses.fetch(source,{redirect:'error',signal:AbortSignal.timeout(10000)});
    if (!response.ok || !response.body) return null;
    const parts = [];
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > 3000000) return null;
      parts.push(chunk);
    }
    image = nativeImage.createFromBuffer(Buffer.concat(parts));
  }
  if (image.isEmpty() || account.disposed || account.identity !== owner || account.status !== 'online') return null;
  return image.resize({width:128}).toDataURL();
}
module.exports = { readPhoto };
