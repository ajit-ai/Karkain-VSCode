// Karkain for Visual Studio Code — extension entry point.
//
// Activation, Karkain toolchain probing, shell-out commands (check / build /
// run / format) wired to the real `karkain` CLI, Problems-panel diagnostics
// from `karkain check --format=json` (Karkain >= 1.1.0, with an honest fallback
// for older toolchains), and a hardened `karkain lsp` language client with a
// dedicated output channel, version gate and failure surfacing. The extension
// never re-implements compiler work: every semantic result comes from the
// toolchain.
import * as vscode from 'vscode';
import { execFile, spawn } from 'child_process';
import * as fs from 'fs';
import {
  buildArgs,
  candidateExecutableNames,
  checkArgs,
  cleanArgs,
  compareVersions,
  configArgs,
  fmtArgs,
  isKarkFile,
  listOnPath,
  parseVersionString,
  quoteTerminalArg,
  resolveOnPath,
  runArgs,
  splitPathEnv,
  supportsStructuredDiagnostics,
  targetArgs,
  versionArgs,
} from './toolchain';
import { KarkainDiagnostic, KarkainSeverity, tryParseCheckJson } from './diagnostics';
import { KARKAIN_LANGUAGE_SERVER_ID, MIN_LANGUAGE_SERVER_VERSION } from './lsp';
import { findProjectRoot } from './project';
import { KarkainTaskKind, isFileScoped, taskArgs, taskGroup, taskLabel } from './tasks';
import {
  parseTestResults,
  parseTestSummary,
  testFileArgs,
  testNamesFromSymbols,
  testNamesFromText,
} from './testing';
import { getCompilerPath, getDebuggerPath, getFormatOnSave, getTarget } from './config';
import { cppdbgLaunchConfig, debugBinaryPath, debugBuildArgs } from './debug';
import { applyTarget, parseTargetOutput } from './targets';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LanguageClientType = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let client: LanguageClientType | null = null;
let detectedVersion: string | undefined;
let channel: vscode.OutputChannel | undefined;
let lspChannel: vscode.OutputChannel | undefined;
let testChannel: vscode.OutputChannel | undefined;
let problems: vscode.DiagnosticCollection | undefined;
let testController: vscode.TestController | undefined;
let testRunProfile: vscode.TestRunProfile | undefined;
let debugChannel: vscode.OutputChannel | undefined;
let targetStatus: vscode.StatusBarItem | undefined;
// `${uri}#${testName}` -> declaration range for failure navigation.
const testRanges = new Map<string, vscode.Range>();

function log(msg: string): void {
  channel?.appendLine(msg);
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
      const lspOk = compareVersions(parsed.version, MIN_LANGUAGE_SERVER_VERSION) >= 0;
      log(
        `Karkain toolchain: ${parsed.raw} (structured diagnostics: ${supportsStructuredDiagnostics(parsed.version) ? 'yes' : 'requires >= 1.1.0'}; language server: ${lspOk ? 'supported' : `expects >= ${MIN_LANGUAGE_SERVER_VERSION}`})`,
      );
      if (!lspOk) {
        void vscode.window.showWarningMessage(
          `Karkain: language intelligence is verified against ${MIN_LANGUAGE_SERVER_VERSION}+ (detected ${parsed.version}).`,
        );
      }
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
  const clientOptions = {
    documentSelector: [{ scheme: 'file', language: 'karkain' }],
    outputChannel: lspChannel,
    traceOutputChannel: lspChannel,
    initializationFailedHandler: (error: Error) => {
      log(`Language server initialization failed: ${error.message}`);
      void vscode.window.showErrorMessage(
        'Karkain: the language server failed to start. See the Karkain Language Server output channel.',
      );
      return false;
    },
  };
  client = new lc.LanguageClient(
    KARKAIN_LANGUAGE_SERVER_ID,
    'Karkain Language Server',
    serverOptions,
    clientOptions,
  );
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

function runInTerminal(label: string, args: string[], cwd?: string): void {
  const term = vscode.window.createTerminal({ name: label, cwd });
  term.show(true);
  term.sendText(`${getCompilerPath()} ${args.map(quoteTerminalArg).join(' ')}`);
}

// Working directory for file commands: the karkain.toml project root when the
// file lives in a project, else the workspace folder, else undefined.
function effectiveCwd(file: string): string | undefined {
  const root = findProjectRoot(file);
  if (root) {
    return root;
  }
  return vscode.workspace.getWorkspaceFolder(vscode.Uri.file(file))?.uri.fsPath;
}

function pathDirectories(): string[] {
  return splitPathEnv(process.env.PATH, process.platform);
}

function toolchainNames(): string[] {
  return candidateExecutableNames(process.platform);
}

// Every karkain executable found via PATH (de-duplicated), configured path first.
function discoverToolchains(): string[] {
  const found = listOnPath(pathDirectories(), toolchainNames(), (p) => fs.existsSync(p));
  const configured = getCompilerPath();
  const configuredIsPath = configured.includes('/') || configured.includes('\\');
  if (configuredIsPath && fs.existsSync(configured) && !found.includes(configured)) {
    return [configured, ...found];
  }
  return found;
}

function updateTargetStatus(): void {
  const t = getTarget();
  if (targetStatus) {
    targetStatus.text = `Karkain: ${t === '' ? 'native' : t}`;
    targetStatus.tooltip = 'Karkain target (click to select)';
    targetStatus.command = 'karkain.selectTarget';
    targetStatus.show();
  }
}

function resolvedCompilerPath(): string {
  const configured = getCompilerPath();
  if (configured.includes('/') || configured.includes('\\')) {
    return configured;
  }
  return resolveOnPath(pathDirectories(), toolchainNames(), (p) => fs.existsSync(p)) ?? configured;
}

function resolveTaskDefinition(
  definition: { type: 'karkain'; task: KarkainTaskKind; file?: string },
  folder: vscode.WorkspaceFolder | undefined,
  cwdOverride?: string,
): vscode.Task | undefined {
  const kind = definition.task;
  let args: string[];
  try {
    args = taskArgs({ kind, file: definition.file });
  } catch {
    return undefined;
  }
  const cwd =
    cwdOverride ?? (definition.file ? effectiveCwd(definition.file) : undefined) ?? folder?.uri.fsPath;
  const execution = new vscode.ShellExecution(getCompilerPath(), args, { cwd });
  const task = new vscode.Task(
    definition,
    folder ?? vscode.TaskScope.Workspace,
    taskLabel({ kind, file: definition.file }),
    'karkain',
    execution,
    kind === 'build' ? '$gcc' : [],
  );
  if (taskGroup(kind) === 'build') {
    task.group = vscode.TaskGroup.Build;
  }
  return task;
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

function testItemId(uri: vscode.Uri, name: string): string {
  return `${uri.toString()}#${name}`;
}

function isTestFileUri(uri: vscode.Uri): boolean {
  return isKarkFile(uri.fsPath) && uri.fsPath.toLowerCase().endsWith('_test.kark');
}

interface DiscoveredTests {
  names: string[];
  ranges: Map<string, vscode.Range>;
}

// Semantic discovery via the language server first, textual fallback (logged)
// when symbols are unavailable.
async function discoverTestNames(uri: vscode.Uri): Promise<DiscoveredTests> {
  try {
    const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
      'vscode.executeDocumentSymbolProvider',
      uri,
    );
    if (symbols && symbols.length > 0) {
      const flat: { name: string; kind: number }[] = [];
      const ranges = new Map<string, vscode.Range>();
      const walk = (list: vscode.DocumentSymbol[]): void => {
        for (const s of list) {
          flat.push({ name: s.name, kind: s.kind as number });
          if (s.kind === vscode.SymbolKind.Function && s.name.startsWith('test_') && !ranges.has(s.name)) {
            ranges.set(s.name, s.selectionRange ?? s.range);
          }
          if (s.children) {
            walk(s.children as vscode.DocumentSymbol[]);
          }
        }
      };
      walk(symbols);
      return { names: testNamesFromSymbols(flat), ranges };
    }
  } catch (e) {
    log(`document symbols unavailable for ${uri.fsPath}, textual fallback: ${(e as Error).message}`);
  }
  let text: string;
  try {
    text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
  } catch {
    return { names: [], ranges: new Map() };
  }
  log(`test discovery for ${uri.fsPath} used textual fallback (LSP symbols unavailable)`);
  const ranges = new Map<string, vscode.Range>();
  text.split('\n').forEach((line, i) => {
    const m = /^\s*func\s+(test_[A-Za-z0-9_]*)\s*\(/.exec(line);
    if (m && !ranges.has(m[1])) {
      ranges.set(m[1], new vscode.Range(i, 0, i, line.length));
    }
  });
  return { names: testNamesFromText(text), ranges };
}

async function refreshTestFile(uri: vscode.Uri): Promise<void> {
  if (!testController) {
    return;
  }
  const { names, ranges } = await discoverTestNames(uri);
  const fileId = uri.toString();
  let fileItem = testController.items.get(fileId);
  if (names.length === 0) {
    if (fileItem) {
      testController.items.delete(fileId);
    }
    return;
  }
  if (!fileItem) {
    const base = fileId.split(/[\\/]/).pop() ?? fileId;
    fileItem = testController.createTestItem(fileId, base, uri);
    testController.items.add(fileItem);
  }
  const keep = new Set(names.map((n) => testItemId(uri, n)));
  const stale: string[] = [];
  fileItem.children.forEach((child) => {
    if (!keep.has(child.id)) {
      stale.push(child.id);
    }
  });
  stale.forEach((id) => fileItem?.children.delete(id));
  for (const name of names) {
    const id = testItemId(uri, name);
    if (!fileItem.children.get(id)) {
      fileItem.children.add(testController.createTestItem(id, name, uri));
    }
    testRanges.set(id, ranges.get(name) ?? new vscode.Range(0, 0, 0, 0));
  }
}

async function refreshAllTests(): Promise<void> {
  if (!testController) {
    return;
  }
  let files: vscode.Uri[];
  try {
    files = await vscode.workspace.findFiles('**/*_test.kark');
  } catch (e) {
    log(`test discovery failed: ${(e as Error).message}`);
    return;
  }
  const keep = new Set(files.map((f) => f.toString()));
  const stale: string[] = [];
  testController.items.forEach((item) => {
    if (!keep.has(item.id)) {
      stale.push(item.id);
    }
  });
  stale.forEach((id) => testController?.items.delete(id));
  for (const file of files) {
    await refreshTestFile(file);
  }
}

interface TestFileRun {
  uri: vscode.Uri;
  /** Null = whole file; otherwise the exact test names to mark. */
  only: Set<string> | null;
}

function collectTestRuns(request: vscode.TestRunRequest): TestFileRun[] {
  const excluded = new Set((request.exclude ?? []).map((item) => item.id));
  const files = new Map<string, TestFileRun>();
  const visitItem = (item: vscode.TestItem): void => {
    if (excluded.has(item.id)) {
      return;
    }
    if (item.children.size > 0 || !item.id.includes('#')) {
      if (item.uri) {
        files.set(item.id, { uri: item.uri, only: null });
      }
      return;
    }
    if (!item.uri) {
      return;
    }
    const hash = item.id.lastIndexOf('#');
    const fileId = item.id.slice(0, hash);
    const entry = files.get(fileId) ?? { uri: item.uri, only: new Set<string>() };
    if (entry.only) {
      entry.only.add(item.label);
    }
    files.set(fileId, entry);
  };
  if (request.include && request.include.length > 0) {
    request.include.forEach(visitItem);
  } else {
    testController?.items.forEach(visitItem);
  }
  // Exclusions inside whole-file runs become an explicit keep-set.
  for (const [fileId, entry] of files) {
    if (entry.only !== null) {
      continue;
    }
    const hasExcludedTests = [...excluded].some((id) => id.startsWith(`${fileId}#`));
    if (!hasExcludedTests) {
      continue;
    }
    const keep = new Set<string>();
    testController?.items.get(fileId)?.children.forEach((child) => {
      if (!excluded.has(child.id)) {
        keep.add(child.label);
      }
    });
    entry.only = keep;
  }
  return [...files.values()];
}

async function executeTestRun(
  request: vscode.TestRunRequest,
  token: vscode.CancellationToken,
): Promise<void> {
  if (!testController) {
    return;
  }
  const run = testController.createTestRun(request);
  const targets = collectTestRuns(request);
  for (const target of targets) {
    if (token.isCancellationRequested) {
      break;
    }
    const fileItem = testController.items.get(target.uri.toString());
    const tests = target.only ?? new Set((await discoverTestNames(target.uri)).names);
    const children = [...tests]
      .map((name) => fileItem?.children.get(testItemId(target.uri, name)))
      .filter((c): c is vscode.TestItem => !!c);
    children.forEach((c) => run.started(c));
    testChannel?.show(true);
    testChannel?.appendLine(`$ karkain test ${target.uri.fsPath}`);
    const folder = vscode.workspace.getWorkspaceFolder(target.uri)?.uri.fsPath;
    const cwd = findProjectRoot(target.uri.fsPath) ?? folder;
    const outcome = await new Promise<{ code: number | null; out: string; spawnError?: string }>(
      (resolve) => {
        const proc = spawn(getCompilerPath(), testFileArgs(target.uri.fsPath), { cwd });
        let out = '';
        proc.stdout.on('data', (d) => {
          out += String(d);
        });
        proc.stderr.on('data', (d) => {
          out += String(d);
        });
        const subscription = token.onCancellationRequested(() => proc.kill());
        proc.on('error', (err) => {
          subscription.dispose();
          resolve({ code: null, out, spawnError: err.message });
        });
        proc.on('close', (code) => {
          subscription.dispose();
          resolve({ code, out });
        });
      },
    );
    if (outcome.spawnError !== undefined) {
      testChannel?.appendLine(`failed to start: ${outcome.spawnError}`);
      children.forEach((c) =>
        run.errored(c, new vscode.TestMessage('Could not start the karkain executable.')),
      );
      continue;
    }
    testChannel?.append(outcome.out);
    testChannel?.appendLine(`(exit ${outcome.code})`);
    const byName = new Map(parseTestResults(outcome.out).map((r) => [r.name, r]));
    if (byName.size === 0) {
      const excerpt = outcome.out.trim().split('\n').slice(-5).join('\n') || `exit ${outcome.code}`;
      children.forEach((c) => run.errored(c, new vscode.TestMessage(`No test results parsed:\n${excerpt}`)));
      continue;
    }
    for (const child of children) {
      const name = child.label;
      const result = byName.get(name);
      if (!result) {
        run.skipped(child);
        continue;
      }
      if (result.status === 'passed') {
        run.passed(child, 0);
        continue;
      }
      const message = new vscode.TestMessage(result.detail || `test ${name} failed`);
      const range = testRanges.get(child.id);
      if (range) {
        message.location = new vscode.Location(target.uri, range);
      }
      run.failed(child, message, 0);
    }
    const summary = parseTestSummary(outcome.out);
    if (summary) {
      testChannel?.appendLine(
        `${summary.passed} passed; ${summary.failed} failed; ${summary.skipped} skipped`,
      );
    }
  }
  run.end();
}

// Builds the active file with debug symbols, then launches it under GDB via
// cppdbg. The build must succeed first: launching on a stale or missing
// binary would debug the wrong program, so any build failure is reported and
// the debugger never starts.
async function runDebug(): Promise<void> {
  const doc = activeKarkainDocument();
  if (!doc) {
    return;
  }
  const file = doc.uri.fsPath;
  const program = debugBinaryPath(file, process.platform);
  const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
  const cwd = effectiveCwd(file);
  debugChannel?.show(true);
  if (getTarget() !== '') {
    debugChannel?.appendLine(`note: karkain.target is '${getTarget()}'; debugging always uses a host build`);
  }
  debugChannel?.appendLine(`$ karkain build -g ${file} -o ${program}`);
  const build = await new Promise<{ code: number | null; out: string }>((resolve) => {
    const proc = spawn(getCompilerPath(), debugBuildArgs(file, program), { cwd });
    let out = '';
    proc.stdout.on('data', (d) => {
      out += String(d);
    });
    proc.stderr.on('data', (d) => {
      out += String(d);
    });
    proc.on('error', (err) => resolve({ code: null, out: out + err.message }));
    proc.on('close', (code) => resolve({ code, out }));
  });
  debugChannel?.append(build.out);
  if (build.code !== 0) {
    debugChannel?.appendLine(`(debug build failed, exit ${build.code})`);
    void vscode.window.showErrorMessage('Karkain: debug build failed. See the Karkain Debug channel.');
    return;
  }
  if (!fs.existsSync(program)) {
    debugChannel?.appendLine(`expected binary missing: ${program}`);
    void vscode.window.showErrorMessage(
      'Karkain: debug build produced no binary. See the Karkain Debug channel.',
    );
    return;
  }
  const config = cppdbgLaunchConfig(program, getDebuggerPath());
  debugChannel?.appendLine(`launching ${program} under GDB`);
  const started = await vscode.debug.startDebugging(folder, config);
  if (!started) {
    void vscode.window.showErrorMessage(
      'Karkain: debugger did not start. Is the C/C++ extension (cppdbg) installed and GDB on PATH?',
    );
  }
}

export function activate(context: vscode.ExtensionContext): void {
  channel = vscode.window.createOutputChannel('Karkain');
  context.subscriptions.push(channel);
  lspChannel = vscode.window.createOutputChannel('Karkain Language Server');
  context.subscriptions.push(lspChannel);
  problems = vscode.languages.createDiagnosticCollection('karkain');
  context.subscriptions.push(problems);
  testChannel = vscode.window.createOutputChannel('Karkain Test');
  context.subscriptions.push(testChannel);
  debugChannel = vscode.window.createOutputChannel('Karkain Debug');
  context.subscriptions.push(debugChannel);
  targetStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  context.subscriptions.push(targetStatus);
  updateTargetStatus();
  testController = vscode.tests.createTestController('karkainTests', 'Karkain Tests');
  context.subscriptions.push(testController);
  testRunProfile = testController.createRunProfile(
    'Run',
    vscode.TestRunProfileKind.Run,
    executeTestRun,
    true,
  );
  context.subscriptions.push(testRunProfile);
  log('Karkain for Visual Studio Code 0.8.0 activated.');
  void probeToolchain();
  startLanguageClient(context);
  void refreshAllTests();

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
        runInTerminal(
          'karkain build',
          applyTarget(buildArgs(doc.uri.fsPath), getTarget()),
          effectiveCwd(doc.uri.fsPath),
        );
      }
    }),
    vscode.commands.registerCommand('karkain.run', () => {
      const doc = activeKarkainDocument();
      if (doc) {
        runInTerminal(
          'karkain run',
          applyTarget(runArgs(doc.uri.fsPath), getTarget()),
          effectiveCwd(doc.uri.fsPath),
        );
      }
    }),
    vscode.commands.registerCommand('karkain.clean', () => {
      const doc = vscode.window.activeTextEditor?.document;
      const cwd = doc ? effectiveCwd(doc.uri.fsPath) : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      runInTerminal('karkain clean', cleanArgs(), cwd);
    }),
    vscode.commands.registerCommand('karkain.debug', () => {
      void runDebug();
    }),
    vscode.commands.registerCommand('karkain.test', async () => {
      if (!testController || !testRunProfile) {
        return;
      }
      await refreshAllTests();
      const doc = vscode.window.activeTextEditor?.document;
      let include: readonly vscode.TestItem[] | undefined;
      if (doc && isTestFileUri(doc.uri)) {
        const fileItem = testController.items.get(doc.uri.toString());
        if (!fileItem) {
          void vscode.window.showInformationMessage('Karkain: no tests discovered in the active file.');
          return;
        }
        include = [fileItem];
      } else if (testController.items.size === 0) {
        void vscode.window.showInformationMessage('Karkain: no *_test.kark files found in the workspace.');
        return;
      }
      const source = new vscode.CancellationTokenSource();
      try {
        await executeTestRun(new vscode.TestRunRequest(include, undefined, testRunProfile), source.token);
      } finally {
        source.dispose();
      }
    }),
    vscode.commands.registerCommand('karkain.selectToolchain', async () => {
      const found = discoverToolchains();
      const configured = getCompilerPath();
      const inUse = resolvedCompilerPath();
      if (found.length === 0) {
        void vscode.window.showWarningMessage(
          `Karkain: no karkain executable found on PATH (current setting: ${configured}). Install Karkain 1.1.0+ or set karkain.compilerPath.`,
        );
        return;
      }
      const pick = await vscode.window.showQuickPick(
        found.map((p) => ({
          label: p,
          description: p === configured ? 'configured' : p === inUse ? 'in use' : '',
        })),
        { placeHolder: 'Select the Karkain toolchain executable' },
      );
      if (!pick) {
        return;
      }
      if (!fs.existsSync(pick.label)) {
        void vscode.window.showErrorMessage(`Karkain: ${pick.label} no longer exists.`);
        return;
      }
      const folder = vscode.workspace.workspaceFolders?.[0];
      const target = folder ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
      await vscode.workspace.getConfiguration('karkain').update('compilerPath', pick.label, target);
      log(`Karkain toolchain selected: ${pick.label}`);
      vscode.window.setStatusBarMessage(`Karkain: toolchain set to ${pick.label}`, 5000);
      await probeToolchain();
    }),
    vscode.commands.registerCommand('karkain.formatDocument', () => {
      if (vscode.window.activeTextEditor) {
        void vscode.commands.executeCommand('editor.action.formatDocument');
      }
    }),
    vscode.commands.registerCommand('karkain.selectTarget', async () => {
      const peer = await execTool(targetArgs(), vscode.workspace.workspaceFolders?.[0]?.uri.fsPath);
      if (peer.code !== 0) {
        log(`karkain target failed (exit ${peer.code}):\n${peer.stderr || peer.stdout}`);
        void vscode.window.showErrorMessage(
          'Karkain: could not list targets. See the Karkain output channel.',
        );
        return;
      }
      const matrix = parseTargetOutput(peer.stdout);
      if (matrix.targets.length === 0 && matrix.compute.length === 0) {
        void vscode.window.showWarningMessage('Karkain: the toolchain reported no targets.');
        return;
      }
      interface TargetPick extends vscode.QuickPickItem {
        value: string;
      }
      const picks: TargetPick[] = [
        { label: '$(clear) Host default (native)', description: 'build and run for this machine', value: '' },
        ...matrix.targets.map((t) => ({ label: t.name, description: t.description, value: t.name })),
      ];
      if (matrix.compute.length > 0) {
        picks.push({ label: 'Compute targets', kind: vscode.QuickPickItemKind.Separator, value: '' });
        for (const c of matrix.compute) {
          picks.push({ label: c.name, description: `${c.maturity} — ${c.description}`, value: c.name });
        }
      }
      const pick = await vscode.window.showQuickPick(picks, { placeHolder: 'Select the Karkain target' });
      if (!pick || pick.kind === vscode.QuickPickItemKind.Separator) {
        return;
      }
      const folder = vscode.workspace.workspaceFolders?.[0];
      await vscode.workspace
        .getConfiguration('karkain')
        .update(
          'target',
          pick.value,
          folder ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global,
        );
      log(`Karkain target selected: ${pick.value === '' ? '(host default)' : pick.value}`);
      updateTargetStatus();
      vscode.window.setStatusBarMessage(
        `Karkain: target set to ${pick.value === '' ? 'host default' : pick.value}`,
        5000,
      );
    }),
    vscode.commands.registerCommand('karkain.showEnvironment', async () => {
      channel?.show(true);
      log(`executable: ${getCompilerPath()} (resolved: ${resolvedCompilerPath()})`);
      log(`selected target: ${getTarget() === '' ? '(host default)' : getTarget()}`);
      const active = vscode.window.activeTextEditor?.document;
      log(`project root: ${active ? (findProjectRoot(active.uri.fsPath) ?? '(none)') : '(no active file)'}`);
      log(`toolchains on PATH: ${discoverToolchains().join(', ') || '(none)'}`);
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
    vscode.tasks.registerTaskProvider('karkain', {
      provideTasks() {
        const tasks: vscode.Task[] = [];
        const doc = vscode.window.activeTextEditor?.document;
        const isKark = !!doc && (doc.languageId === 'karkain' || isKarkFile(doc.uri.fsPath));
        const folder =
          (doc && vscode.workspace.getWorkspaceFolder(doc.uri)) ?? vscode.workspace.workspaceFolders?.[0];
        if (isKark && doc) {
          for (const kind of ['build', 'check', 'run'] as KarkainTaskKind[]) {
            const resolved = resolveTaskDefinition(
              { type: 'karkain', task: kind, file: doc.uri.fsPath },
              folder,
            );
            if (resolved) {
              tasks.push(resolved);
            }
          }
        }
        const cleanCwd = (doc && effectiveCwd(doc.uri.fsPath)) ?? folder?.uri.fsPath ?? process.cwd();
        const clean = resolveTaskDefinition({ type: 'karkain', task: 'clean' }, folder, cleanCwd);
        if (clean) {
          tasks.push(clean);
        }
        return tasks;
      },
      resolveTask(task) {
        const def = task.definition as { task?: string; file?: string };
        if (typeof def.task !== 'string') {
          return undefined;
        }
        const kind = def.task as KarkainTaskKind;
        if (!isFileScoped(kind) && kind !== 'clean') {
          return undefined;
        }
        const folder = def.file ? vscode.workspace.getWorkspaceFolder(vscode.Uri.file(def.file)) : undefined;
        const scopeFolder = folder ?? vscode.workspace.workspaceFolders?.[0];
        return resolveTaskDefinition({ type: 'karkain', task: kind, file: def.file }, scopeFolder, undefined);
      },
    }),
    vscode.languages.registerDocumentFormattingEditProvider('karkain', {
      // `karkain fmt` rewrites the file in place (verified on 1.1.0) and only
      // prints a status line, so the provider saves the buffer, formats, then
      // reloads the disk content as the edit. A dirty buffer that cannot be
      // saved is refused rather than formatted against stale disk content.
      provideDocumentFormattingEdits(document, _options, token) {
        return (async (): Promise<vscode.TextEdit[] | null> => {
          if (document.isDirty) {
            const saved = await document.save();
            if (!saved) {
              void vscode.window.showErrorMessage('Karkain: save the file before formatting.');
              return null;
            }
          }
          const r = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
            const proc = spawn(getCompilerPath(), fmtArgs(document.uri.fsPath));
            let stderr = '';
            proc.stderr.on('data', (d) => {
              stderr += String(d);
            });
            const subscription = token.onCancellationRequested(() => proc.kill());
            proc.on('error', (err) => {
              subscription.dispose();
              resolve({ code: null, stderr: err.message });
            });
            proc.on('close', (code) => {
              subscription.dispose();
              resolve({ code, stderr });
            });
          });
          if (token.isCancellationRequested || r.code === null) {
            return null;
          }
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
        updateTargetStatus();
      }
    }),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (testController && isTestFileUri(doc.uri)) {
        void refreshTestFile(doc.uri);
      }
    }),
  );
  const testWatcher = vscode.workspace.createFileSystemWatcher('**/*_test.kark');
  context.subscriptions.push(
    testWatcher,
    testWatcher.onDidCreate((uri) => {
      void refreshTestFile(uri);
    }),
    testWatcher.onDidChange((uri) => {
      void refreshTestFile(uri);
    }),
    testWatcher.onDidDelete((uri) => {
      testController?.items.delete(uri.toString());
    }),
  );
}

export function deactivate(): Thenable<void> | undefined {
  if (client) {
    return client.stop();
  }
  return undefined;
}
