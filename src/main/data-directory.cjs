const path=require('node:path');
const fs=require('node:fs');
function configureDataDirectory(app) {
  const base=app.getPath('appData'), legacy=path.join(base,'Relay Desk');
  const override=process.env.HAIA_DATA_DIR;
  if (override && !path.isAbsolute(override)) throw Error('HAIA_DATA_DIR 需要填写绝对路径');
  const selected=override || (app.getPath('userData')===path.join(base,'HaiA') && fs.existsSync(path.join(legacy,'accounts.json')) ? legacy : null);
  if (selected) {
    fs.mkdirSync(selected,{recursive:true,mode:0o700});
    app.setPath('userData',selected);
    app.setPath('sessionData',selected);
  }
}
async function openDataDirectory(app,shell) {
  const error=await shell.openPath(app.getPath('userData'));
  if (error) throw Error('无法打开本机数据目录');
}
module.exports={configureDataDirectory,openDataDirectory};
