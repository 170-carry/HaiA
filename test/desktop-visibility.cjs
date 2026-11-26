const {app,BrowserWindow}=require('electron');
let completed=false;
app.on('before-quit',()=>{
  if(!completed){console.error('FAIL: desktop smoke exited before all assertions finished');process.exitCode=1;}
});

// Visibility-driven features must be exercised in a visible, focused test window.
async function showTestWindow(contents,selector) {
  const window=BrowserWindow.fromWebContents(contents);
  window.setAlwaysOnTop(true);
  window.show();
  window.focus();
  if(selector)await contents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'center'});true`);
  await contents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
}

function completeTest(){completed=true;}
module.exports={showTestWindow,completeTest};
