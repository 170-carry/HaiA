const fs = require('node:fs/promises');
const path = require('node:path');
const semver = require('semver');

function installer(file) {
  const match = /^(?:HaiA|RelayDesk)-(.+)-(x64\.exe|x64\.dmg|arm64\.dmg)$/.exec(path.basename(file));
  if (!match || !semver.valid(match[1])) return null;
  return { file, version: match[1], target: match[2] };
}

async function nonemptyFile(file) {
  const stat = await fs.lstat(file).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  return stat?.isFile() && stat.size > 0;
}

async function pruneInstallers(root, { outDir, artifactPaths }) {
  const output = path.resolve(outDir);
  // Manage only the project's dist and its immediate release directories.
  if (output !== root && !(path.dirname(output) === root && semver.valid(path.basename(output)))) return;
  if (!(await fs.lstat(root)).isDirectory() || !(await fs.lstat(output)).isDirectory()) return;

  const keep = new Map();
  for (const file of artifactPaths) {
    const item = installer(path.resolve(file));
    if (item && path.dirname(item.file) === output && await nonemptyFile(item.file)) {
      keep.set(item.target, item);
    }
  }
  if (!keep.size) return;

  const directories = [root];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (entry.isDirectory() && semver.valid(entry.name)) directories.push(path.join(root, entry.name));
  }
  const candidates = [];
  for (const directory of directories) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const item = installer(path.join(directory, entry.name));
      if (!entry.isFile() || !item || !keep.has(item.target)) continue;
      candidates.push(item);
      // An older release can be rebuilt after a newer one. Only prefer an
      // existing newer package when it has a completed differential blockmap.
      if (semver.gt(item.version, keep.get(item.target).version)
          && await nonemptyFile(item.file) && await nonemptyFile(item.file + '.blockmap')) {
        keep.set(item.target, item);
      }
    }
  }
  for (const item of candidates) {
    const latest = keep.get(item.target);
    if (item.file === latest.file || semver.gt(item.version, latest.version)) continue;
    await fs.rm(item.file + '.blockmap', { force: true });
    await fs.rm(item.file, { force: true });
  }
}

module.exports = { pruneInstallers };
