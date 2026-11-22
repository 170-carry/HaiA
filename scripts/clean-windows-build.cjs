const fs = require('node:fs/promises');
const path = require('node:path');

async function cleanWindowsStaging({ outDir, artifactPaths }) {
  const output = await fs.realpath(outDir);
  for (const file of artifactPaths) {
    if (!/^HaiA-.+-x64\.exe$/.test(path.basename(file))) continue;
    if (path.dirname(await fs.realpath(file)) !== output) continue;
    const staged = path.join(output, 'win-unpacked');
    const executable = path.join(staged, 'HaiA.exe');
    const resolved = await fs.realpath(executable).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (resolved === executable) await fs.rm(staged, { recursive: true, force: true });
  }
}

module.exports = { cleanWindowsStaging };
