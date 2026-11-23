const RELEASES = 'https://github.com/170-carry/HaiA/releases';
const ENDPOINT = 'https://api.github.com/repos/170-carry/HaiA/releases/latest';

function parts(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error('无法识别应用版本号');
  return match.slice(1).map(Number);
}

async function checkRelease(current, fetch) {
  const response = await fetch(ENDPOINT, {headers:{Accept:'application/vnd.github+json'}, signal:AbortSignal.timeout(12000)});
  if (!response.ok) throw new Error(response.status === 403 || response.status === 429 ? 'GitHub 请求过于频繁，请稍后重试' : '无法读取 GitHub 发布信息，请稍后重试');
  const release = await response.json();
  if (release.draft || release.prerelease) throw new Error('暂时没有可用的正式版本');
  const latest = parts(release.tag_name), installed = parts(current);
  const index = latest.findIndex((value,i) => value !== installed[i]);
  return {version:latest.join('.'), available:index >= 0 && latest[index] > installed[index],
    url:RELEASES + '/tag/' + encodeURIComponent(release.tag_name)};
}
module.exports = {checkRelease};
