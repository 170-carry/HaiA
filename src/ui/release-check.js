(() => {
  const check=get('check-update'), status=get('update-status'), action=get('update-download');
  let stage='idle', pending=false;
  function render(state) {
    stage=state.stage;
    check.disabled=pending || ['downloading','installing'].includes(stage);
    action.hidden=!['available','ready'].includes(stage);
    action.disabled=pending;
    action.textContent=stage==='ready'?'重启并更新':'下载更新';
    const labels={idle:'',available:'发现新版本 '+state.version,latest:'当前已是最新版本',
      downloading:'正在下载 '+state.version+' · '+state.percent+'%',ready:'更新已下载并通过校验',
      installing:'正在准备安装，HaiA 将自动重启…'};
    status.textContent=labels[stage] || '';
  }
  async function perform(method,label) {
    if(pending) return;
    pending=true;check.disabled=true;action.disabled=true;status.textContent=label;
    let failure;
    try {await method();} catch(e){failure=readable(e);}
    finally {
      pending=false;render(await api.updateState());
      if(failure) status.textContent=failure;
    }
  }
  check.onclick=()=>perform(api.checkUpdate,'正在检查更新…');
  action.onclick=()=>stage==='ready'?perform(api.installUpdate,'正在准备安装…'):perform(api.downloadUpdate,'正在连接下载服务器…');
  api.onUpdateProgress(render);
  run(async()=>render(await api.updateState()));
})();
