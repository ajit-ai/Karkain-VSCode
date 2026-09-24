// Karkain for Visual Studio Code — extension entry point.
//
// Phase 1 foundation: activation, Karkain toolchain probing, shell-out
// commands (check / build / run / format) wired to the real `karkain` CLI,
// Problems-panel diagnostics from `karkain check --format=json` (Karkain
// >= 1.1.0, with an honest fallback for older toolchains), and a guarded
// `karkain lsp` language client. The extension never re-implements compiler
// work: every semantic result comes from the toolchain.
import * as vscode from 'vscode';
import { execFile, spawn } from 'child_process';
import {
  buildArgs,
  checkArgs,
  configArgs,
  fmtArgs,
  isKarkFile,
  parseVersionString,
  runArgs,
  supportsStructuredDiagnostics,
  targetArgs,
  versionArgs,
} from './toolchain';
import { KarkainDiagnostic, KarkainSeverity, tryParseCheckJson } from './diagnostics';
import { getCompilerPath, getFormatOnSave } from './config';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LanguageClientType = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let client: LanguageClientType | null = null;
let detectedVersion: string | undefined;
let channel: vscode.OutputChannel | undefined;
let problems: vscode.DiagnosticCollection | undefined;

function log(msg: string): void {
  channel?.appendLine(msg);
}

function quoteArg(a: string): string {
  return '"' + a.replace(/"/g, '\\"') + '"';
}

function execTool(args: string[], cwd?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(getCompilerPath(), args, { encoding: 'utf8', cwd, timeout: 120000 }, (err, stdout, stderr) => {
      const execErr = err as { code?: unknown };
      const code = err && typeof execErr.code === 'number' ? (execErr.code as number) : -1;
      resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
    });
  });
}

async function probeToolchain(): Promise<void> {
  detectedVersion = undefined;
  try {
    const r = await execTool(versionArgs());
    const parsed = parseVersionString(r.stdout);
    if (parsed) {
      detectedVersion = parsed.version;
      log(
        `Karkain toolchain: ${parsed.raw} (structured diagnostics: ${supportsStructuredDiagnostics(parsed.version) ? 'yes' : 'requires >= 1.1.0'})`,
      );
    } else if (r.code === 0) {
      log(`Karkain toolchain responded with unrecognized version output: ${r.stdout.trim()}`);
    } else {
      log(`Karkain toolchain probe failed (exit ${r.code}): ${r.stderr.trim() || r.stdout.trim()}`);
    }
  } catch (e) {
    log(
      `Karkain executable not found: ${(e as Error).message}. Set karkain.compilerPath or add karkain to PATH.`,
    );
  }
}

function startLanguageClient(context: vscode.ExtensionContext): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  let lc: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    lc = require('vscode-languageclient/node');
  } catch {
    log(
      'vscode-languageclient is unavailable; language intelligence is disabled (check/build/run still work).',
    );
    return;
  }
  const serverOptions = { command: getCompilerPath(), args: ['lsp'], options: {} };
  const clientOptions = { documentSelector: [{ scheme: 'file', language: 'karkain' }] };
  client = new lc.LanguageClient('karkain-lsp', 'Karkain Language Server', serverOptions, clientOptions);
  context.subscriptions.push(client.start());
  log('Karkain language client started (`karkain lsp` over stdio).');
}

async function restartLanguageClient(): Promise<void> {
  if (client) {
    try {
      await client.stop();
    } catch (e) {
      log(`Language client stop reported: ${(e as Error).message}`);
    }
    client = null;
  }
}

function toVscodeSeverity(s: KarkainSeverity): vscode.DiagnosticSeverity {
  switch (s) {
    case 'warning':
      return vscode.DiagnosticSeverity.Warning;
    case 'info':
      return vscode.DiagnosticSeverity.Information;
    case 'hint':
      return vscode.DiagnosticSeverity.Hint;
    default:
      return vscode.DiagnosticSeverity.Error;
  }
}

function activeKarkainDocument(): vscode.TextDocument | null {
  const doc = vscode.window.activeTextEditor?.document;
  if (!doc) {
    void vscode.window.showWarningMessage('Karkain: open a .kark file first.');
    return null;
  }
  if (doc.languageId !== 'karkain' && !isKarkFile(doc.uri.fsPath)) {
    void vscode.window.showWarningMessage('Karkain: the active file is not a .kark file.');
    return null;
  }
  return doc;
}

function runInTerminal(label: string, args: string[]): void {
  const term = vscode.window.createTerminal({ name: label });
  term.show(true);
  term.sendText(`${getCompilerPath()} ${args.map(quoteArg).join(' ')}`);
}

interface CheckSpawn {
  code: number | null;
  stdout: string;
  stderr: string;
  spawnError?: string;
}

function spawnCheck(
  file: string,
  folder: string | undefined,
  extraEnv: NodeJS.ProcessEnv,
): Promise<CheckSpawn> {
  return new Promise<CheckSpawn>((resolve) => {
    const proc = spawn(getCompilerPath(), checkArgs(file, true), {
      cwd: folder,
      env: { ...process.env, ...extraEnv },
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => {
      stdout += String(d);
    });
    proc.stderr.on('data', (d) => {
      stderr += String(d);
    });
    proc.on('error', (err) => resolve({ code: null, stdout, stderr, spawnError: err.message }));
    proc.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function runCheck(doc: vscode.TextDocument): Promise<void> {
  const file = doc.uri.fsPath;
  const folder = vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.fsPath;
  const useJson =
    detectedVersion === undefined || detectedVersion === '' || supportsStructuredDiagnostics(detectedVersion);
  if (!useJson) {
    void vscode.window.showWarningMessage(
      'Karkain: structured diagnostics require Karkain 1.1.0+. Raw compiler output was written to the Karkain channel.',
    );
  }
  // Attempt 1: default engine. Attempt 2 (verified contract): the Go engine,
  // which is the only path emitting schema-v1 JSON today.
  const attempts: { label: string; env: NodeJS.ProcessEnv }[] = useJson
    ? [
        { label: 'default', env: {} },
        { label: 'go', env: { KARKAIN_ENGINE: 'go' } },
      ]
    : [{ label: 'default', env: {} }];
  let result: CheckSpawn | undefined;
  let usedEngine = 'default';
  for (const attempt of attempts) {
    const r = await spawnCheck(file, folder, attempt.env);
    if (r.spawnError !== undefined) {
      log(`Karkain check failed to start: ${r.spawnError}`);
      void vscode.window.showErrorMessage(
        'Karkain: could not start the karkain executable. Configure `karkain.compilerPath` or add karkain to PATH.',
      );
      return;
    }
    const parsed = tryParseCheckJson(r.stdout);
    if (parsed !== null) {
      result = r;
      usedEngine = attempt.label;
      reportCheck(doc, file, r, parsed);
      return;
    }
    result = r;
    usedEngine = attempt.label;
  }
  const last = result as CheckSpawn;
  log(
    `check ${file} (engine ${usedEngine}, exit ${last.code})\n--- stdout ---\n${last.stdout}\n--- stderr ---\n${last.stderr}`,
  );
  if (last.code === 2 && /unknown flag/i.test(last.stderr)) {
    void vscode.window.showWarningMessage(
      'Karkain: structured diagnostics require Karkain 1.1.0+. Raw compiler output was written to the Karkain channel.',
    );
  } else if (last.code !== 0) {
    void vscode.window.showErrorMessage(
      `Karkain: check failed (exit ${last.code}). See the Karkain output channel.`,
    );
  } else {
    vscode.window.setStatusBarMessage('Karkain: check passed', 3000);
  }
}

function reportCheck(
  doc: vscode.TextDocument,
  file: string,
  result: CheckSpawn,
  parsed: KarkainDiagnostic[],
): void {
  const uri = doc.uri;
  if (parsed.length === 0) {
    problems?.delete(uri);
    if (result.code === 0) {
      vscode.window.setStatusBarMessage('Karkain: check passed', 3000);
    } else {
      log(`check ${file} reported no structured diagnostics but exited ${result.code}.\n${result.stderr}`);
      void vscode.window.showErrorMessage(
        `Karkain: check failed (exit ${result.code}). See the Karkain output channel.`,
      );
    }
    return;
  }
  const diags = parsed.map((d) => {
    const range = new vscode.Range(
      Math.max(0, d.line - 1),
      Math.max(0, d.column - 1),
      Math.max(0, d.line - 1),
      Math.max(0, d.column - 1),
    );
    const diag = new vscode.Diagnostic(range, d.message, toVscodeSeverity(d.severity));
    diag.source = 'karkain';
    if (d.code) {
      diag.code = d.code;
    }
    return diag;
  });
  problems?.set(uri, diags);
  vscode.window.setStatusBarMessage(`Karkain: ${diags.length} problem(s)`, 5000);
}

export function activate(context: vscode.ExtensionContext): void {
  channel = vscode.window.createOutputChannel('Karkain');
  context.subscriptions.push(channel);
  problems = vscode.languages.createDiagnosticCollection('karkain');
  context.subscriptions.push(problems);
  log('Karkain for Visual Studio Code 0.2.0 activated.');
  void probeToolchain();
  startLanguageClient(context);

  context.subscriptions.push(
    vscode.commands.registerCommand('karkain.check', () => {
      const doc = activeKarkainDocument();
      if (doc) {
        void runCheck(doc);
      }
    }),
    vscode.commands.registerCommand('karkain.build', () => {
      const doc = activeKarkainDocument();
      if (doc) {
        runInTerminal('karkain build', buildArgs(doc.uri.fsPath));
      }
    }),
    vscode.commands.registerCommand('karkain.run', () => {
      const doc = activeKarkainDocument();
      if (doc) {
        runInTerminal('karkain run', runArgs(doc.uri.fsPath));
      }
    }),
    vscode.commands.registerCommand('karkain.formatDocument', () => {
      if (vscode.window.activeTextEditor) {
        void vscode.commands.executeCommand('editor.action.formatDocument');
      }
    }),
    vscode.commands.registerCommand('karkain.showEnvironment', async () => {
      channel?.show(true);
      for (const args of [versionArgs(), targetArgs(), configArgs()]) {
        const r = await execTool(args, vscode.workspace.workspaceFolders?.[0]?.uri.fsPath);
        log(`$ karkain ${args.join(' ')} (exit ${r.code})\n${r.stdout}${r.stderr}`);
      }
    }),
    vscode.commands.registerCommand('karkain.restartLanguageServer', async () => {
      await restartLanguageClient();
      startLanguageClient(context);
      vscode.window.setStatusBarMessage('Karkain: language server restarted', 3000);
    }),
    vscode.languages.registerDocumentFormattingEditProvider('karkain', {
      // `karkain fmt` rewrites the file in place (verified on 1.1.0) and only
      // prints a status line, so the provider saves the buffer, formats, then
      // reloads the disk content as the edit. A dirty buffer that cannot be
      // saved is refused rather than formatted against stale disk content.
      provideDocumentFormattingEdits(document) {
        return (async (): Promise<vscode.TextEdit[] | null> => {
          if (document.isDirty) {
            const saved = await document.save();
            if (!saved) {
              void vscode.window.showErrorMessage('Karkain: save the file before formatting.');
              return null;
            }
          }
          const r = await new Promise<{ code: number; stderr: string }>((resolve) => {
            execFile(
              getCompilerPath(),
              fmtArgs(document.uri.fsPath),
              { encoding: 'utf8' },
              (err, _out, errText) => {
                const execErr = err as { code?: unknown };
                resolve({
                  code: err && typeof execErr.code === 'number' ? (execErr.code as number) : -1,
                  stderr: String(errText ?? ''),
                });
              },
            );
          });
          if (r.code !== 0) {
            log(`karkain fmt failed for ${document.uri.fsPath} (exit ${r.code}):\n${r.stderr}`);
            void vscode.window.showErrorMessage(
              'Karkain: formatter failed (requires Karkain 1.1.0+). See the Karkain output channel.',
            );
            return null;
          }
          const disk = Buffer.from(await vscode.workspace.fs.readFile(document.uri)).toString('utf8');
          if (disk === document.getText()) {
            return [];
          }
          return [
            vscode.TextEdit.replace(
              new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
              disk,
            ),
          ];
        })();
      },
    }),
  );

  // Guarded so the post-format save below cannot re-enter the handler.
  let formattingOnSave = false;
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (formattingOnSave) {
        return;
      }
      if ((doc.languageId === 'karkain' || isKarkFile(doc.uri.fsPath)) && getFormatOnSave()) {
        formattingOnSave = true;
        void (async () => {
          try {
            await vscode.commands.executeCommand('editor.action.formatDocument');
            await doc.save();
          } finally {
            formattingOnSave = false;
          }
        })();
      }
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('karkain')) {
        void probeToolchain();
      }
    }),
  );
}

export function deactivate(): Thenable<void> | undefined {
  if (client) {
    return client.stop();
  }
  return undefined;
}
