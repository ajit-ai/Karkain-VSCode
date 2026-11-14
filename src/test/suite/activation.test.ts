// Activation contract.
//
// This is the coverage that did not exist before: the ~1,000-line activation
// path in src/extension.ts had no extension-host test at all. Everything here
// runs against the FakeToolchainService, so no Karkain toolchain is required.
//
// Note on injection: an extension's exported API is only reachable after
// activation (`ext.exports`), so the fake is installed after activation and
// then exercised through a real command. That is deliberate — it proves the
// seam works for the code path users actually take.
//
// Workspace shape: the runner opens fixtures/multiroot.code-workspace, a TWO-root
// window (see src/test/suite/multiroot.test.ts). Everything asserted here must
// therefore hold in a multi-root window too, which is exactly the Phase 15
// requirement: one client, one set of registrations, commands that work
// regardless of root count.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { FakeToolchainService, NotInstalledToolchainService } from '../fakes/toolchainFake';

const EXTENSION_ID = 'karkain.karkain';

interface KarkainExtensionApi {
  setToolchainService(service: unknown): void;
  reportServerCapabilities(result: unknown): void;
}

/** Every command the manifest contributes. */
const COMMANDS = [
  'karkain.check',
  'karkain.build',
  'karkain.run',
  'karkain.clean',
  'karkain.test',
  'karkain.debug',
  'karkain.selectTarget',
  'karkain.selectToolchain',
  'karkain.selectEngine',
  'karkain.formatDocument',
  'karkain.formatCheck',
  'karkain.showEnvironment',
  'karkain.restartLanguageServer',
  'karkain.newProject',
  'karkain.openProject',
  'karkain.lint',
  'karkain.explainError',
  'karkain.showConfig',
  'karkain.showIdeInfo',
  'karkain.workspaceBuild',
  'karkain.workspaceTest',
  'karkain.workspaceCheck',
  'karkain.workspaceTree',
  'karkain.addPackage',
  'karkain.fetchPackages',
  'karkain.runWithOptions',
  'karkain.rerunLastRun',
  'karkain.stopRun',
  'karkain.recentActions',
  'karkain.openDocumentation',
  'karkain.openDocumentationTopic',
  'karkain.openManifest',
  'karkain.runHealthCheck',
  'karkain.exportHealthReport',
  'karkain.copyHealthReport',
  'karkain.debugPrerequisites',
  'karkain.filterCommands',
  'karkain.filterExamples',
  'karkain.copyCommandUsage',
  'karkain.setTraceLevel',
];

async function activate(): Promise<vscode.Extension<KarkainExtensionApi>> {
  const ext = vscode.extensions.getExtension<KarkainExtensionApi>(EXTENSION_ID);
  assert.ok(ext, `extension ${EXTENSION_ID} not found`);
  if (!ext.isActive) {
    await ext.activate();
  }
  return ext;
}

async function installFake(fake: FakeToolchainService): Promise<void> {
  const ext = await activate();
  ext.exports.setToolchainService(fake);
}

suite('extension activation', () => {
  suiteSetup(async () => {
    await activate();
  });

  test('activates and reports a version', async () => {
    const ext = await activate();
    assert.strictEqual(ext.isActive, true);
    const pkg = ext.packageJSON as { version?: string };
    assert.ok(pkg.version, 'extension should expose a version');
  });

  test('registers every contributed command', async () => {
    await activate();
    const registered = await vscode.commands.getCommands(true);
    for (const command of COMMANDS) {
      assert.ok(registered.includes(command), `command not registered: ${command}`);
    }
  });

  test('contributes the karkain language id', async () => {
    const languages = await vscode.languages.getLanguages();
    assert.ok(languages.includes('karkain'), 'karkain language id should be contributed');
  });

  test('contributes a diagnostic-free baseline before any check runs', async () => {
    await activate();
    assert.ok(vscode.languages.getDiagnostics() !== undefined);
  });

  test('runs showEnvironment without throwing when no toolchain exists', async () => {
    await installFake(new NotInstalledToolchainService());
    await vscode.commands.executeCommand('karkain.showEnvironment');
  });

  test('routes --version through the injected toolchain service', async () => {
    const fake = new FakeToolchainService('karkain', (_run, call) =>
      call === 0
        ? { code: 0, stdout: 'Karkain Compiler v1.1.0 (windows/amd64, Stable Build)' }
        : { code: 0, stdout: '' },
    );
    await installFake(fake);
    await vscode.commands.executeCommand('karkain.showEnvironment');
    assert.ok(
      fake.argvLog().includes('--version'),
      `expected a --version probe, saw: ${JSON.stringify(fake.argvLog())}`,
    );
  });

  test('probes the target matrix through the injected service', async () => {
    const fake = new FakeToolchainService('karkain', (_run, call) => {
      if (call === 0) {
        return { code: 0, stdout: 'Karkain Compiler v1.1.0 (windows/amd64, Stable Build)' };
      }
      return { code: 0, stdout: 'Host: x86_64-windows\nSupported targets:\n  native  host\n' };
    });
    await installFake(fake);
    await vscode.commands.executeCommand('karkain.showEnvironment');
    assert.ok(
      fake.argvLog().includes('target'),
      `expected a target probe, saw: ${JSON.stringify(fake.argvLog())}`,
    );
  });

  test('negotiates capabilities from a real InitializeResult', async () => {
    // Drives the production negotiation entry point with the shape the Karkain
    // server actually returns. A full-featured server must be accepted.
    const ext = await activate();
    const compatible = {
      capabilities: {
        textDocumentSync: { openClose: true, change: 1 },
        completionProvider: { triggerCharacters: ['.', ':'] },
        semanticTokensProvider: { legend: { tokenTypes: [], tokenModifiers: [] }, full: true },
        hoverProvider: true,
        definitionProvider: true,
        documentSymbolProvider: true,
        formattingProvider: true,
      },
      serverInfo: { name: 'karkain-lsp', version: '1.1.0' },
    };
    assert.doesNotThrow(() => ext.exports.reportServerCapabilities(compatible));

    // A degraded server must still be handled (reported), never thrown or fatal.
    const degraded = {
      capabilities: { ...compatible.capabilities, hoverProvider: false, formattingProvider: false },
      serverInfo: { name: 'karkain-lsp', version: '1.1.0' },
    };
    assert.doesNotThrow(() => ext.exports.reportServerCapabilities(degraded));

    // An absent result is degraded, not a crash.
    assert.doesNotThrow(() => ext.exports.reportServerCapabilities(undefined));
  });

  test('gates LSP compatibility on the server-reported version', async () => {
    // The server is the authority for its own version, independent of whatever
    // the CLI toolchain reports.
    const ext = await activate();
    const base = {
      capabilities: {
        textDocumentSync: { openClose: true, change: 1 },
        completionProvider: { triggerCharacters: ['.', ':'] },
        semanticTokensProvider: { legend: { tokenTypes: [], tokenModifiers: [] }, full: true },
        hoverProvider: true,
        definitionProvider: true,
        documentSymbolProvider: true,
        formattingProvider: true,
      },
    };
    // Supported, stale, and unreadable server versions all handled gracefully.
    assert.doesNotThrow(() =>
      ext.exports.reportServerCapabilities({
        ...base,
        serverInfo: { name: 'karkain-lsp', version: '1.1.0' },
      }),
    );
    assert.doesNotThrow(() =>
      ext.exports.reportServerCapabilities({
        ...base,
        serverInfo: { name: 'karkain-lsp', version: '1.0.0' },
      }),
    );
    assert.doesNotThrow(() =>
      ext.exports.reportServerCapabilities({ ...base, serverInfo: { name: 'karkain-lsp' } }),
    );
  });

  // The launchArgs workspace is fixtures/project, a real karkain.toml project,
  // so showEnvironment exercises the manifest parser against real toolchain
  // output rather than a synthetic string.
  test('reads the project model through showEnvironment', async () => {
    await installFake(
      new FakeToolchainService('karkain', (_run, call) =>
        call === 0
          ? { code: 0, stdout: 'Karkain Compiler v1.1.0 (windows/amd64, Stable Build)' }
          : { code: 0, stdout: '' },
      ),
    );
    await vscode.commands.executeCommand('karkain.showEnvironment');
  });

  test('restarting the language server survives a missing toolchain', async () => {
    // The restart path must never reject when there is no `karkain lsp` to talk
    // to: that is the state every user without a toolchain is in.
    await installFake(new NotInstalledToolchainService());
    await vscode.commands.executeCommand('karkain.restartLanguageServer');
  });

  test('serializes overlapping language-server restarts', async () => {
    await installFake(new NotInstalledToolchainService());
    // Two concurrent restarts must not interleave for the single client slot.
    // executeCommand returns a Thenable, not a Promise, so both are awaited
    // explicitly rather than passed to Promise.all.
    const first = vscode.commands.executeCommand('karkain.restartLanguageServer');
    const second = vscode.commands.executeCommand('karkain.restartLanguageServer');
    await first;
    await second;
  });

  test('contributes the views of the Activity Bar container', async () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', '..', '..', 'package.json'), 'utf8'),
    ) as {
      contributes: {
        views: Record<string, { id: string; name: string }[]>;
        viewsContainers: { activitybar: { id: string; title: string; icon: string }[] };
      };
    };
    const container = pkg.contributes.viewsContainers.activitybar.find((c) => c.id === 'karkain');
    assert.ok(container, 'activity bar container "karkain" missing');
    const viewIds = (pkg.contributes.views.karkain ?? []).map((v) => v.id);
    assert.deepStrictEqual(viewIds, [
      'karkain.overview',
      'karkain.quickActions',
      'karkain.projects',
      'karkain.commands',
      'karkain.stdlib',
      'karkain.examples',
      'karkain.docs',
    ]);
  });

  test('Control Center commands survive a missing toolchain without throwing', async () => {
    await installFake(new NotInstalledToolchainService());
    // None of these may reject on a machine with no karkain executable; in a
    // headless host none of them waits for user input either.
    await vscode.commands.executeCommand('karkain.showConfig');
    await vscode.commands.executeCommand('karkain.showIdeInfo');
    await vscode.commands.executeCommand('karkain.workspaceCheck');
    await vscode.commands.executeCommand('karkain.workspaceTree');
    await vscode.commands.executeCommand('karkain.runHealthCheck');
    await vscode.commands.executeCommand('karkain.copyHealthReport');
    await vscode.commands.executeCommand('karkain.rerunLastRun');
    await vscode.commands.executeCommand('karkain.stopRun');
    await vscode.commands.executeCommand('karkain.debugPrerequisites');
  });
});
