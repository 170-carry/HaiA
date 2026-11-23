// Executed by macOS JavaScript for Automation. RENAME_SWAP exchanges both directories atomically.
function run(paths) {
  ObjC.bindFunction('renamex_np',['int',['string','string','unsigned int']]);
  if ($.renamex_np(paths[0],paths[1],2)!==0) throw Error('无法替换 HaiA，请检查应用目录的写权限');
}
