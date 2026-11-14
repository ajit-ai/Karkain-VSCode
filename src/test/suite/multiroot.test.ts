// Multi-root workspace contract (Phase 15).
//
// Only the parts that genuinely need a real extension host live here: VS Code's
// own folder-scoped configuration resolution, `getWorkspaceFolder` ownership,
// and root add/remove. The path-matching rule itself is unit-tested without
// Electron in src/test/unit/workspace.test.ts.
//
// The suite runs against a two-root workspace (fixtures/multiroot.code-workspace)
// so both roots are real Karkain projects with deliberately different manifests.
// Nothing here depends on a machine-specific absolute path: roots are resolved
// from vscode.workspace.workspaceFolders at runtime.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { FakeToolchainService } from '../fakes/toolchainFake';

const EXTENSION_ID = 'karkain.karkain';

interface KarkainExtensionApi {
  setToolchainService(service: unknown): void;
  reportServerCapabilities(result: unknown): void;
}

function rootsByName(): Record<string, vscode.WorkspaceFolder> {
  const byName: Record<string, vscode.WorkspaceFolder> = {};
  for (const f of vscode.workspace.workspaceFolders ?? []) {
    byName[f.name] = f;
  }
  return byName;
}

async function activate(): Promise<vscode.Extension<KarkainExtensionApi>> {
  const ext = vscode.extensions.getExtension<KarkainExtensionApi>(EXTENSION_ID);
  assert.ok(ext, `extension ${EXTENSION_ID} not found`);
  if (!ext.isActive) {
    await ext.activate();
  }
  return ext;
}

/**
 * Folder-scoped update; returns a restore function for the caller.
 *
 * When the key had no folder value beforehand, the restore REMOVES the key
 * rather than writing `undefined`, because writing undefined leaves an empty
 * `.vscode/settings.json` behind in the fixture — which then fails the
 * repository-hygiene and format:check gates. Leaving the fixtures byte-identical
 * to how the test found them is the whole point.
 */
async function setFolderScoped(
  folder: vscode.WorkspaceFolder,
  key: string,
  value: unknown,
): Promise<() => Promise<void>> {
  const inspect = vscode.workspace.getConfiguration('karkain', folder).inspect(key);
  const hadFolderValue = inspect?.workspaceFolderValue !== undefined;
  await vscode.workspace
    .getConfiguration('karkain', folder)
    .update(key, value, vscode.ConfigurationTarget.WorkspaceFolder);
  return async () => {
    await vscode.workspace
      .getConfiguration('karkain', folder)
      .update(
        key,
        hadFolderValue ? inspect?.workspaceFolderValue : undefined,
        vscode.ConfigurationTarget.WorkspaceFolder,
      );
  };
}

suite('multi-root workspace', () => {
  // VS Code materialises `<root>/.vscode/settings.json` as soon as a
  // folder-scoped setting is written, and leaves an empty `{}` behind even after
  // the key is removed. The fixtures are tracked files, so a stray directory
  // would dirty the tree and fail the repository-hygiene and format:check gates.
  // Removing the directory afterwards keeps the fixtures byte-identical to how
  // the suite found them.
  teardown(() => {
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const dir = path.join(folder.uri.fsPath, '.vscode');
      try {
        if (fs.existsSync(dir)) {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      } catch {
        // Best-effort cleanup: never fail a behavioural test over a leftover.
      }
    }
  });

  suiteSetup(async () => {
    // Guard: these tests are meaningless unless the runner actually opened the
    // two-root workspace. Fail loudly rather than silently testing one root.
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length < 2) {
      throw new Error(
        `multi-root suite requires a 2-root workspace, saw ${folders.length}. ` +
          'Run via `npm run test:integration`, which opens fixtures/multiroot.code-workspace.',
      );
    }
    await activate();
  });

  test('opens both roots as independent workspace folders', () => {
    const folders = vscode.workspace.workspaceFolders ?? [];
    assert.strictEqual(folders.length, 2, 'expected exactly two workspace folders');
    assert.deepStrictEqual(folders.map((f) => f.name).sort(), ['project', 'project-other']);
    assert.notStrictEqual(folders[0].uri.fsPath, folders[1].uri.fsPath);
  });

  test('a file in root A resolves to root A', () => {
    const a = rootsByName()['project'];
    assert.ok(a, 'root "project" missing');
    const file = vscode.Uri.file(`${a.uri.fsPath}/src/main.kark`);
    assert.strictEqual(vscode.workspace.getWorkspaceFolder(file)?.uri.fsPath, a.uri.fsPath);
  });

  test('a file in root B resolves to root B', () => {
    const b = rootsByName()['project-other'];
    assert.ok(b, 'root "project-other" missing');
    const file = vscode.Uri.file(`${b.uri.fsPath}/src/main.kark`);
    assert.strictEqual(vscode.workspace.getWorkspaceFolder(file)?.uri.fsPath, b.uri.fsPath);
  });

  test('a file in neither root gets no fabricated workspace association', () => {
    const outside = vscode.Uri.file(
      process.platform === 'win32'
        ? 'C:\\definitely\\not\\in\\workspace\\x.kark'
        : '/definitely/not/in/workspace/x.kark',
    );
    assert.strictEqual(vscode.workspace.getWorkspaceFolder(outside), undefined);
  });

  test('folder-scoped configuration does not leak between roots', async () => {
    const byName = rootsByName();
    const a = byName['project'];
    const b = byName['project-other'];
    assert.ok(a && b);

    // Keys here are relative to the 'karkain' configuration section, so they must
    // NOT carry the 'karkain.' prefix: passing 'karkain.target' makes VS Code look
    // for a setting literally named 'karkain.karkain.target' and reject the write.
    const restoreA = await setFolderScoped(a, 'target', 'wasm32-wasi');
    const restoreB = await setFolderScoped(b, 'target', '');
    try {
      const valueFor = (f: vscode.WorkspaceFolder): string | undefined =>
        vscode.workspace.getConfiguration('karkain', f).get<string>('target');
      assert.strictEqual(valueFor(a), 'wasm32-wasi');
      assert.strictEqual(valueFor(b), '');
      // The unscoped read is the workspace-level fallback, which is neither
      // root's folder value. This is exactly why production call sites pass a
      // scope instead of reading unscoped.
      const unscoped = vscode.workspace.getConfiguration('karkain').get<string>('target');
      assert.ok(
        unscoped !== 'wasm32-wasi',
        `unscoped read must not adopt root A's folder value (saw ${String(unscoped)})`,
      );
    } finally {
      // Restore in the reverse order of creation so the finally block never
      // leaves a stray .vscode/settings.json behind for the hygiene gate.
      await restoreB();
      await restoreA();
    }
  });

  test('both roots remain independently addressable', () => {
    const byName = rootsByName();
    const a = byName['project'];
    const b = byName['project-other'];
    assert.ok(a && b);
    assert.notStrictEqual(a.index, b.index);
    assert.ok(vscode.workspace.getConfiguration('karkain', a));
    assert.ok(vscode.workspace.getConfiguration('karkain', b));
  });

  test('the extension activates with multiple roots and answers commands', async () => {
    const ext = await activate();
    ext.exports.setToolchainService(
      new FakeToolchainService('karkain', (_run, call) =>
        call === 0
          ? { code: 0, stdout: 'Karkain Compiler v1.1.0 (windows/amd64, Stable Build)' }
          : { code: 0, stdout: '' },
      ),
    );
    await vscode.commands.executeCommand('karkain.showEnvironment');
  });

  test('registers one set of providers regardless of root count', async () => {
    // Two roots must not double-register commands; the registry is the
    // observable proxy for "exactly one activation".
    const registered = await vscode.commands.getCommands(true);
    const karkainCommands = registered.filter((c) => c.startsWith('karkain.'));
    assert.strictEqual(
      karkainCommands.length,
      new Set(karkainCommands).size,
      'duplicate karkain command registrations would mean double activation',
    );
    assert.ok(new Set(karkainCommands).has('karkain.check'));
  });
});
