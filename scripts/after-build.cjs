const path = require('node:path');
const { afterAllArtifactBuild: cleanMacStaging } = require('./clean-mac-build.cjs');
const { cleanWindowsStaging } = require('./clean-windows-build.cjs');
const { pruneInstallers } = require('./installer-retention.cjs');

async function afterAllArtifactBuild(result) {
  await cleanMacStaging(result);
  await cleanWindowsStaging(result);
  await pruneInstallers(path.resolve(__dirname, '../dist'), result);
  return [];
}

module.exports = { afterAllArtifactBuild };
