(() => {
  const check = get('check-update'), status = get('update-status'), download = get('update-download');
  check.onclick = async () => {
    check.disabled = true; download.hidden = true; status.textContent = '正在检查…';
    try {
      const release = await api.checkUpdate();
      status.textContent = release.available ? '发现新版本 ' + release.version : '当前已是最新版本';
      download.hidden = !release.available;
      download.onclick = () => run(() => api.openExternal(release.url));
    } catch (error) { status.textContent = readable(error); }
    finally { check.disabled = false; }
  };
})();
