const {ipcRenderer}=require('electron');
ipcRenderer.on('haia-snapshot-port',event=>{
  window.postMessage('haia-snapshot-port','*',event.ports);
});
