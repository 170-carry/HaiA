const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {execFile,spawn} = require('node:child_process');
const execute = require('node:util').promisify(execFile);
const {verifyFile} = require('./download.cjs');

async function detached(command,args) {
  const child = spawn(command,args,{detached:true,stdio:'ignore',windowsHide:true});
  await new Promise((resolve,reject)=>{child.once('error',reject);child.once('spawn',resolve);});
  child.unref();
}
async function stageMac(file,release,installed,arch) {
  if (path.basename(installed)!=='HaiA.app' || await fs.realpath(installed)!==installed ||
      installed.startsWith('/Volumes/') || installed.includes('/AppTranslocation/')) throw Error('请先将 HaiA 安装到「应用程序」后再更新');
  const parent=path.dirname(installed);
  await fs.access(parent,fs.constants.W_OK).catch(()=>{throw Error('当前用户没有应用目录写权限，请将 HaiA 安装到个人「应用程序」目录');});
  const staging=await fs.mkdtemp(path.join(parent,'.haia-update-'));
  try {
    const mount=await fs.mkdtemp(path.join(os.tmpdir(),'haia-dmg-'));
    let mounted=false;
    try {
      await execute('/usr/bin/hdiutil',['attach','-readonly','-nobrowse','-noautoopen','-verify','-mountpoint',mount,file]);
      mounted=true;
      await execute('/usr/bin/ditto',[path.join(mount,'HaiA.app'),path.join(staging,'HaiA.app')]);
    } finally {
      if(mounted) await execute('/usr/bin/hdiutil',['detach',mount]);
      await fs.rmdir(mount);
    }
    const candidate=path.join(staging,'HaiA.app'), plist=path.join(candidate,'Contents/Info.plist');
    const value=async key=>(await execute('/usr/bin/plutil',['-extract',key,'raw',plist])).stdout.trim();
    if(await value('CFBundleIdentifier')!=='com.relaydesk.desktop' || await value('CFBundleShortVersionString')!==release.version ||
       await value('CFBundleExecutable')!=='HaiA') throw Error('更新包中的应用或版本不匹配');
    const binary=(await execute('/usr/bin/file',['-b',path.join(candidate,'Contents/MacOS/HaiA')])).stdout;
    if(!binary.includes(arch==='arm64'?'arm64':'x86_64')) throw Error('更新包不适用于此芯片');
    await execute('/usr/bin/codesign',['--verify','--deep','--strict',candidate]);
    await fs.writeFile(path.join(staging,'swap.js'),await fs.readFile(path.join(__dirname,'swap-mac.js')));
    await fs.writeFile(path.join(staging,'relaunch.sh'),await fs.readFile(path.join(__dirname,'relaunch-mac.sh')));
    return staging;
  } catch(error) {await fs.rm(staging,{recursive:true,force:true}); throw error;}
}
async function install(file,release) {
  await verifyFile(file,release);
  if(process.platform==='win32') {
    await detached(file,['--updated','/S','--force-run']);
  } else if(process.platform==='darwin') {
    const installed=path.resolve(process.execPath,'../../..');
    const staging=await stageMac(file,release,installed,process.arch);
    try {await detached('/bin/sh',[path.join(staging,'relaunch.sh'),String(process.pid),installed,staging]);}
    catch(error){await fs.rm(staging,{recursive:true,force:true});throw error;}
  } else throw Error('当前平台不支持自动安装');
}
module.exports={install,stageMac};
