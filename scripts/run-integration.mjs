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
    // VS Code ≥ 1.146 renamed the macOS main binary Electron → Code inside the
    // same app bundle; accept either, preferring the current name.
    const macos = '/Applications/Visual Studio Code.app/Contents/MacOS';
    return [path.join(macos, 'Code'), path.join(macos, 'Electron')];
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

// The library computes the macOS executable path as Contents/MacOS/Electron,
// which newer (≥ 1.146.0) darwin archives no longer ship: the binary is
// Contents/MacOS/Code. When the pinned/current build is found, prefer the
// real binary; on any doubt return the library's candidate unchanged (the
// runner then errors exactly as before — no silent difference in behavior).
async function downloadWithBinaryFallback() {
  try {
    // Same version-inference the runner uses (latest stable satisfying
    // engines.vscode) and the same on-disk cache, via the library's own
    // downloader — the download is not duplicated and behaviour is identical.
    const { downloadAndUnzipVSCode } = require('@vscode/test-electron/out/download');
    const candidate = await downloadAndUnzipVSCode({ extensionsDevelopmentPath: repoRoot });
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    for (const name of ['Code', 'Electron']) {
      const p = path.join(path.dirname(candidate), name);
      if (fs.existsSync(p)) {
        console.log(
          `[run-integration] VS Code bundle ships '${name}' (not '${path.basename(candidate)}'); using ${p}`,
        );
        return p;
      }
    }
    console.log(
      `[run-integration] downloaded editor binary not found at ${candidate}; passing it through unchanged`,
    );
    return candidate;
  } catch (err) {
    console.warn(
      `[run-integration] pre-download did not complete (${err?.message ?? err}); letting the runner resolve it itself`,
    );
    return undefined; // runner performs the identical download on its own
  }
}

const local = resolveLocalEditor();
let vscodeExecutablePath = local;
if (local) {
  console.log(`[run-integration] using local VS Code: ${local}`);
} else {
  console.log('[run-integration] no local VS Code found; downloading a pinned build');
  vscodeExecutablePath = await downloadWithBinaryFallback();
}

await runTests({
  vscodeExecutablePath,
  extensionDevelopmentPath: repoRoot,
  extensionTestsPath: path.resolve(repoRoot, 'out', 'test', 'suite', 'index.js'),
  // A .code-workspace with two REAL Karkain project roots
  // (fixtures/project and fixtures/project-other). Opening a workspace file
  // rather than a folder is what makes the multi-root suite meaningful: the
  // activation path sees a genuine multi-root window, with two roots that have
  // deliberately different karkain.toml manifests. Single-folder behaviour is
  // still covered — the unit suite and the single-root cases in
  // activation.test.ts run against the same extension, and the multi-root suite
  // asserts the single-root invariants still hold inside a two-root window.
  launchArgs: [path.resolve(repoRoot, 'fixtures', 'multiroot.code-workspace'), '--disable-extensions'],
});
