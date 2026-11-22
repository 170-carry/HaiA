const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pruneInstallers } = require('../scripts/installer-retention.cjs');

test('keeps one completed release per target across flat and versioned output', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'relay-retention-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  async function build(dir, version, target) {
    const out = path.join(root, dir);
    await fs.mkdir(out, { recursive: true });
    const file = path.join(out, (version === '0.9.0' ? 'RelayDesk-' : 'HaiA-') + version + '-' + target);
    await fs.writeFile(file, 'installer');
    await fs.writeFile(file + '.blockmap', 'map');
    return file;
  }

  const oldMac = await build('', '0.9.0', 'arm64.dmg');
  const intel = await build('', '0.9.0', 'x64.dmg');
  const win = await build('', '0.9.0', 'x64.exe');
  const duplicate = await build('', '0.10.0', 'arm64.dmg');
  const current = await build('0.10.0', '0.10.0', 'arm64.dmg');
  const outDir = path.dirname(current);
  await pruneInstallers(root, { outDir, artifactPaths: [] });
  await fs.access(oldMac);
  await pruneInstallers(root, { outDir, artifactPaths: [current] });
  for (const file of [oldMac, duplicate]) {
    await assert.rejects(fs.access(file), { code: 'ENOENT' });
    await assert.rejects(fs.access(file + '.blockmap'), { code: 'ENOENT' });
  }
  const rebuilt = await build('0.9.0', '0.9.0', 'arm64.dmg');
  await pruneInstallers(root, { outDir: path.dirname(rebuilt), artifactPaths: [rebuilt] });
  await assert.rejects(fs.access(rebuilt), { code: 'ENOENT' });
  for (const file of [intel, win, current]) {
    await fs.access(file);
    await fs.access(file + '.blockmap');
  }
});
