// Launches VS Code with the extension loaded and runs out/test/suite.
//
// Kept out of `npm run test:unit` on purpose: the unit suite needs no editor
// process and stays fast. This gate needs a real extension host.
//
// Resolution order for the editor:
//   1. $KARKAIN_VSCODE_PATH        - explicit override
//   2. a locally installed VS Code - fast, and avoids a ~340 MB download
//   3. download a pinned build     - the portable path used by CI
//
// Override with KARKAIN_VSCODE_DOWNLOAD=1 to force step 3.
import { createRequire } from 'module';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { runTests } = require('@vscode/test-electron');

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

function localCandidates() {
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA;
    const programFiles = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean);
    return [
      ...(localAppData ? [path.join(localAppData, 'Programs', 'Microsoft VS Code', 'Code.exe')] : []),
      ...programFiles.map((root) => path.join(root, 'Microsoft VS Code', 'Code.exe')),
    ];
  }
  if (process.platform === 'darwin') {
    return ['/Applications/Visual Studio Code.app/Contents/MacOS/Electron'];
  }
  return ['/usr/bin/code', '/usr/share/code/code', '/snap/bin/code'];
}

function resolveLocalEditor() {
  const override = process.env.KARKAIN_VSCODE_PATH;
  if (override) {
    if (!fs.existsSync(override)) {
      throw new Error(`KARKAIN_VSCODE_PATH does not exist: ${override}`);
    }
    return override;
  }
  if (process.env.KARKAIN_VSCODE_DOWNLOAD === '1') {
    return undefined;
  }
  return localCandidates().find((candidate) => fs.existsSync(candidate));
}

const vscodeExecutablePath = resolveLocalEditor();
if (vscodeExecutablePath) {
  console.log(`[run-integration] using local VS Code: ${vscodeExecutablePath}`);
} else {
  console.log('[run-integration] no local VS Code found; downloading a pinned build');
}

await runTests({
  vscodeExecutablePath,
  extensionDevelopmentPath: repoRoot,
  extensionTestsPath: path.resolve(repoRoot, 'out', 'test', 'suite', 'index.js'),
  // fixtures/project is a real karkain.toml project, so activation sees the
  // same shape it will see in a user's workspace.
  launchArgs: [path.resolve(repoRoot, 'fixtures', 'project'), '--disable-extensions'],
});
