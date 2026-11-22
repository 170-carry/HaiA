const fs = require('node:fs/promises');
const path = require('node:path');

// A DMG is the deliverable. Its unpacked app is only staging for that architecture.
const stagingDirectories = { x64: 'mac', arm64: 'mac-arm64', universal: 'mac-universal' };

async function afterAllArtifactBuild({ outDir, artifactPaths }) {
  const output = await fs.realpath(outDir);
  for (const artifact of artifactPaths) {
    const match = /^HaiA-.+-(x64|arm64|universal)\.dmg$/.exec(path.basename(artifact));
    if (!match || path.dirname(await fs.realpath(artifact)) !== output) continue;

    const bundle = path.join(output, stagingDirectories[match[1]], 'HaiA.app');
    // A linked staging directory could point outside the build output.
    const resolved = await fs.realpath(bundle).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (resolved === bundle) await fs.rm(bundle, { recursive: true });
  }
  return [];
}

module.exports = { afterAllArtifactBuild };
