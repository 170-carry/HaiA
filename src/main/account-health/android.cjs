const {execFile}=require('node:child_process');
const execute=require('node:util').promisify(execFile);
const path=require('node:path');
const os=require('node:os');
const fs=require('node:fs');

function androidBridge() {
  const sdk=process.env.ANDROID_HOME || path.join(os.homedir(),'Library/Android/sdk');
  const candidate=path.join(sdk,'platform-tools',process.platform==='win32'?'adb.exe':'adb');
  const adb=fs.existsSync(candidate)?candidate:'adb';
  async function run(args) {
    try {return (await execute(adb,args,{timeout:20000,maxBuffer:2*1024*1024,windowsHide:true})).stdout;}
    catch(error) {
      if(error.code==='ENOENT') throw Error('需要安装 Android Platform Tools 后才能连接手机');
      throw error;
    }
  }
  async function device() {
    const devices=(await run(['devices'])).split('\n').map(s=>s.trim().split(/\s+/)).filter(s=>s[1]==='device');
    if(devices.length!==1) throw Error('请通过 USB 连接并授权一台 Android 手机后重试');
    return devices[0][0];
  }
  return {run,device};
}
module.exports={androidBridge};
