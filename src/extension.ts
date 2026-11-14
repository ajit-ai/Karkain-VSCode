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
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  buildArgs,
  candidateExecutableNames,
  checkArgs,
  classifyProbe,
  cleanArgs,
  configArgs,
  isKarkFile,
  listOnPath,
  quoteTerminalArg,
  resolveOnPath,
  runArgs,
  splitPathEnv,
  supportsStructuredDiagnostics,
  targetArgs,
  versionArgs,
} from './toolchain';
import {
  KarkainDiagnostic,
  KarkainSeverity,
  resolveDiagnosticFile,
  toDiagnosticRange,
  toVscodeSeverityLevel,
  tryParseCheckJson,
} from './diagnostics';
import {
  KARKAIN_LANGUAGE_SERVER_ID,
  LspInitializeResult,
  MIN_LANGUAGE_SERVER_VERSION,
  negotiateServerCapabilities,
} from './lsp';
import { describeProject, findProjectRoot, loadProject } from './project';
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
import {
  DEFAULT_TOOLCHAIN_TIMEOUT_MS,
  NodeToolchainService,
  ToolchainRunResult,
  ToolchainService,
} from './toolchainService';
import { parseIdeInfo } from './capability';
import { ActionKind } from './recentActions';
import { buildHealthReport } from './health';
import { ControlCenter, registerControlCenter } from './controlCenter';
import { SharedViewState } from './views/common';
import { DOC_TOPICS } from './views/docs';
import {
  getBuildArgs,
  getEngine,
  getEnv,
  getExamplesPath,
  getRunArgs,
  getStdlibPath,
  getTraceServer,
  getWorkingDirectory,
} from './config';
import { splitFlags } from './flags';
import type { EngineKind } from './config';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LanguageClientType = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let client: LanguageClientType | null = null;
// CLI toolchain version, from `karkain --version`. This is the toolchain domain
// (gates CLI-only features such as `check --format=json`). It is deliberately
// NOT the language server version; LSP compatibility uses serverInfo instead.
let toolchainVersion: string | undefined;
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

// ---- Control Center shared state ----
// View providers read this synchronously; the extension updates it on probes,
// activation and config changes. Nothing in this object fabricates data —
// values are what the last observation actually produced.
const sharedViewState: SharedViewState = {
  compilerLabel: 'not probed yet',
  compilerStatus: 'unknown',
  lspRunning: false,
  lspRestarts: 0,
  lastLspError: undefined,
  healthOverall: undefined,
};
let controlCenter: ControlCenter | null = null;
// The last successful run/launch target, for "Re-run Last Run".
let lastRunLaunch: { file: string; flags: string[] } | undefined;
let lastRunTerminal: vscode.Terminal | undefined;
let lspRestarts = 0;
const extensionInfo = { version: '1.0.0' };

function log(msg: string): void {
  channel?.appendLine(msg);
}

interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
  /** True when the executable itself could not be spawned (ENOENT). */
  notFound: boolean;
}

// The one place the extension is allowed to start a Karkain process.
// `toolchain` is reassigned by the integration suite so activation can be
// exercised without a real toolchain on PATH.
let toolchain: ToolchainService = new NodeToolchainService(getCompilerPath);

/** Replaces the process seam. Intended for tests; production never calls this. */
export function setToolchainService(service: ToolchainService): void {
  toolchain = service;
}

function currentToolchain(): ToolchainService {
  return toolchain;
}

function engineEnv(scope?: vscode.WorkspaceFolder): NodeJS.ProcessEnv {
  const engine: EngineKind = getEngine(scope);
  return engine ? { KARKAIN_ENGINE: engine } : {};
}

async function execTool(
  args: string[],
  cwd?: string,
  scope?: vscode.WorkspaceFolder,
  extraEnv?: NodeJS.ProcessEnv,
): Promise<ExecResult> {
  // Merge order (later wins): process env (inside the service) < karkain.env <
  // engine override < caller's extra env. Never mutates the caller's object.
  const overlay: NodeJS.ProcessEnv = { ...getEnv(scope), ...engineEnv(scope), ...(extraEnv ?? {}) };
  const hasOverlay = Object.keys(overlay).length > 0;
  const r = await currentToolchain().run(args, {
    cwd,
    env: hasOverlay ? overlay : undefined,
    timeoutMs: DEFAULT_TOOLCHAIN_TIMEOUT_MS,
  });
  return {
    code: r.code === null ? -1 : r.code,
    stdout: r.stdout,
    stderr: r.stderr,
    notFound: r.notFound,
  };
}

// One notification per distinct problem kind per session, so re-probing on
// configuration changes never spams the user.
const notifiedProbeIssues = new Set<string>();

function notifyProbeIssue(key: string, message: string): void {
  if (notifiedProbeIssues.has(key)) {
    return;
  }
  notifiedProbeIssues.add(key);
  void vscode.window.showWarningMessage(message);
}

async function probeToolchain(): Promise<void> {
  toolchainVersion = undefined;
  const result = await execTool(versionArgs());
  const outcome = classifyProbe(result, result.notFound);
  if (outcome.kind === 'ok') {
    notifiedProbeIssues.clear();
    toolchainVersion = outcome.version;
    sharedViewState.compilerLabel = outcome.raw.split('\n')[0];
    sharedViewState.compilerStatus = 'ok';
    controlCenter?.refreshAll();
    // Toolchain facts only. LSP compatibility is NOT decided here: it comes from
    // the language server's own serverInfo once it has initialized, because the
    // CLI version and the LSP protocol version are separate domains.
    log(
      `Karkain toolchain: ${outcome.raw} (structured diagnostics: ${supportsStructuredDiagnostics(outcome.version) ? 'yes' : 'requires >= 1.1.0'})`,
    );
    controlCenter?.refreshAll();
    return;
  }
  switch (outcome.kind) {
    case 'notFound':
      sharedViewState.compilerLabel = 'not found';
      sharedViewState.compilerStatus = 'fail';
      log(`Karkain executable not found: ${result.stderr}. Set karkain.compilerPath or add karkain to PATH.`);
      notifyProbeIssue(
        'not-found',
        'Karkain: no karkain executable found. Install the Karkain toolchain, add it to PATH, or set karkain.compilerPath.',
      );
      break;
    case 'unrecognized':
      sharedViewState.compilerLabel = 'unrecognized output';
      sharedViewState.compilerStatus = 'warn';
      log(`Karkain toolchain responded with unrecognized version output: ${outcome.raw}`);
      notifyProbeIssue(
        'unrecognized',
        'Karkain: the karkain executable was found but its version could not be detected. Check karkain.compilerPath.',
      );
      break;
    case 'failed':
      sharedViewState.compilerLabel = `probe failed (exit ${outcome.code})`;
      sharedViewState.compilerStatus = 'warn';
      log(`Karkain toolchain probe failed (exit ${outcome.code}): ${outcome.detail}`);
      notifyProbeIssue(
        `failed:${outcome.code}`,
        `Karkain: karkain --version failed (exit ${outcome.code}). See the Karkain output channel.`,
      );
      break;
  }
  controlCenter?.refreshAll();
}

// Validates the capabilities of the server that actually came up, using the
// real InitializeResult the client holds after initialize. Reports honestly but
// never stops a working server: a missing capability degrades the feature, it
// does not make the language server unusable.
export function reportServerCapabilities(result: unknown): void {
  const negotiation = negotiateServerCapabilities(result as LspInitializeResult | undefined);
  const who = negotiation.serverName ?? 'karkain-lsp';

  // LSP compatibility is decided ONLY from the server's own reported version.
  // Never from the CLI `--version` probe: the two can diverge, and conflating
  // them previously let a stale toolchain version stand in for the server's.
  if (!negotiation.serverVersionKnown) {
    log(
      `Karkain language server ${who} did not report a usable version; LSP compatibility could not be established.`,
    );
    void vscode.window.showWarningMessage(
      'Karkain: the language server did not report a version, so its compatibility could not be verified. See the Karkain Language Server output channel.',
    );
  } else if (!negotiation.serverVersionSupported) {
    log(
      `Karkain language server ${who} reports ${negotiation.serverVersion}, below the verified ${MIN_LANGUAGE_SERVER_VERSION}+ baseline. The server is still used.`,
    );
    void vscode.window.showWarningMessage(
      `Karkain: the language server reports ${negotiation.serverVersion}; language intelligence is verified against ${MIN_LANGUAGE_SERVER_VERSION}+. It is still used.`,
    );
  }

  if (negotiation.compatible) {
    log(`Karkain language server ready (${who} ${negotiation.serverVersion ?? ''}).`.trim());
    return;
  }
  log(
    `Karkain language server initialized with a reduced feature set; missing: ${negotiation.missing.join(', ')}. Affected features stay unavailable; the server is still used.`,
  );
  void vscode.window.showWarningMessage(
    `Karkain: the language server did not advertise ${negotiation.missing.join(', ')}. Those features are unavailable. See the Karkain Language Server output channel.`,
  );
}

// How long to wait for `karkain lsp` to answer `initialize` before giving up on
// the start. Generous enough for a cold real toolchain, short enough that a
// silent server cannot wedge a command indefinitely.
export const LSP_START_TIMEOUT_MS = 20000;

async function startLanguageClient(context: vscode.ExtensionContext): Promise<void> {
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
  // Deliberately unscoped, and deliberately ONE client for the whole window.
  //
  // `karkain lsp` is a single stdio server, and the client below selects every
  // `file:`/`karkain` document regardless of which root it lives in, so one
  // client already serves a multi-root workspace. Spawning one client per root
  // would duplicate the server, the output channel and the diagnostics stream
  // for no added capability.
  //
  // The consequence is honest and worth stating: the language server runs the
  // workspace-wide `karkain.compilerPath`, so a per-folder compilerPath applies
  // to CLI commands, tasks and formatting decisions, but NOT to the language
  // server's own executable. Running a different toolchain per root would need
  // a per-root client; that is out of scope here and is recorded as a known
  // limitation rather than silently half-implemented.
  //
  // The server is spawned behind out/lsp-proxy.js, a stdio shim that repairs
  // one exact server-side protocol defect: `karkain lsp` answers responses
  // with no result and no error (e.g. every `shutdown`, and every hover that
  // resolves no binding — timing-dependent). vscode-jsonrpc rejects those
  // with "The received response has neither a result nor an error property.",
  // which also broke stop() before the `exit` notification, leaving the
  // server's pipe to break abnormally (observed as exit code 1). The proxy
  // rewrites ONLY that envelope to `"result": null`, which is what JSON-RPC
  // 2.0 and the LSP mandate. It needs no Karkain changes; when Karkain fixes
  // the server, the proxy degrades to a zero-effect pipe.
  const proxyPath = path.join(__dirname, 'lsp-proxy.js');
  const direct = resolvedCompilerPath();
  const serverOptions = fs.existsSync(proxyPath)
    ? {
        command: process.execPath,
        args: [proxyPath, direct, 'lsp'],
        options: { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } },
      }
    : {
        command: getCompilerPath(),
        args: ['lsp'],
        options: {},
      };
  if (!fs.existsSync(proxyPath)) {
    // Degraded, not silent: without the proxy the extension keeps working but
    // the Karkain server's empty-envelope defect reaches the client as-is.
    log(
      'out/lsp-proxy.js is missing; spawning `karkain lsp` directly. Malformed server responses will surface unrepaired.',
    );
  } else {
    log(`language server spawns behind the protocol repair shim (${path.basename(proxyPath)})`);
  }
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
    // Surfaces protocol and transport errors (including malformed server
    // responses with neither result nor error) in the dedicated output
    // channel instead of silently swallowing them. `Continue` keeps the server
    // running for transient failures; `DoNotRestart` on close avoids zombie
    // restart loops when the server exits with a genuine error.
    errorHandler: {
      error: (
        error: Error,
        message: { method?: string; id?: unknown } | undefined,
        count: number | undefined,
      ) => {
        log(`Karkain Language Server protocol error (count=${count ?? 0}): ${error.message}`);
        if (message) {
          log(`  request: method=${JSON.stringify(message.method)}, id=${message.id}`);
        }
        void lspChannel?.show();
        return { action: lc.ErrorAction.Continue, handled: true };
      },
      closed: () => {
        log('Karkain Language Server connection closed.');
        return { action: lc.CloseAction.DoNotRestart, handled: true };
      },
    },
  };
  const next = new lc.LanguageClient(
    KARKAIN_LANGUAGE_SERVER_ID,
    'Karkain Language Server',
    serverOptions,
    clientOptions,
  );
  // Publish the handle before starting so deactivate() and restart always see
  // a live client, never a half-built one.
  client = next;
  try {
    // v9 start() resolves once initialize has completed, which is the only
    // point at which initializeResult is meaningful.
    //
    // Bounded: `next.start()` has no timeout of its own, so a language server
    // that starts but never answers `initialize` would otherwise hang the
    // calling command forever — observed with a real `karkain lsp` that accepts
    // the stdio connection and then goes silent. The race leaves start()
    // running (it may still complete and become usable) but returns control, so
    // the user is not stuck; a failure is surfaced and the half-built handle is
    // dropped rather than left for deactivate() to stop.
    await Promise.race([
      next.start(),
      new Promise<void>((_, reject) =>
        setTimeout(
          () => reject(new Error(`language server did not initialize within ${LSP_START_TIMEOUT_MS}ms`)),
          LSP_START_TIMEOUT_MS,
        ).unref?.(),
      ),
    ]);
  } catch (e) {
    // Never leave a stale handle behind for deactivate() to try to stop.
    if (client === next) {
      client = null;
    }
    sharedViewState.lspRunning = false;
    sharedViewState.lastLspError = (e as Error).message;
    controlCenter?.refreshAll();
    log(`Karkain language client failed to start: ${(e as Error).message}`);
    void vscode.window.showWarningMessage(
      'Karkain: the language server did not start. check/build/run still work; see the Karkain Language Server output channel.',
    );
    return;
  }
  // start() resolves to a promise, not a disposable, so register a real
  // disposable instead of pushing the promise (which has no dispose()).
  context.subscriptions.push({
    dispose: () => {
      void next.stop();
    },
  });
  log('Karkain language client started (`karkain lsp` over stdio).');
  sharedViewState.lspRunning = true;
  sharedViewState.lastLspError = undefined;
  controlCenter?.refreshAll();
  reportServerCapabilities(next.initializeResult);
  applyTraceLevel();
}

// LSP trace level comes from karkain.trace.server; applying it needs the raw
// client handle, so it is a no-op until the client exists.
function applyTraceLevel(): void {
  if (!client) {
    return;
  }
  const level = getTraceServer();
  const map: Record<string, number> = { off: 0, messages: 1, verbose: 3 };
  const setTrace = (client as { setTrace?: (v: number) => Promise<void> }).setTrace;
  if (typeof setTrace === 'function') {
    void setTrace.call(client, map[level] ?? 0).catch((e: unknown) => {
      log(`setTrace(${level}) failed: ${e instanceof Error ? e.message : String(e)}`);
    });
  }
}

async function restartLanguageClient(): Promise<void> {
  if (client) {
    try {
      await client.stop();
    } catch (e) {
      log(`Language client stop reported: ${(e as Error).message}`);
    }
    client = null;
    sharedViewState.lspRunning = false;
    controlCenter?.refreshAll();
  }
}

// Guards against overlapping restarts. Two concurrent stop/start cycles would
// race for the single `client` slot and can leave a half-built client behind, so
// a second request waits for the first to finish instead of interleaving.
let restartInFlight: Promise<void> | null = null;

/**
 * Stops and restarts the language client as one serialized operation.
 * Safe to call concurrently: overlapping callers share the in-flight run.
 */
function restartLanguageClientAndStart(context: vscode.ExtensionContext): Promise<void> {
  if (restartInFlight) {
    return restartInFlight;
  }
  const run = (async () => {
    // Awaited so a stop can never race the next start.
    await restartLanguageClient();
    lspRestarts += 1;
    sharedViewState.lspRestarts = lspRestarts;
    await startLanguageClient(context);
  })().finally(() => {
    restartInFlight = null;
  });
  restartInFlight = run;
  return run;
}

// The toolchain -> VS Code severity decision itself lives in diagnostics.ts as
// `toVscodeSeverityLevel` so it can be unit-tested without an extension host;
// this only translates the chosen level onto the vscode enum.
function toVscodeSeverity(s: KarkainSeverity): vscode.DiagnosticSeverity {
  switch (toVscodeSeverityLevel(s)) {
    case 'warning':
      return vscode.DiagnosticSeverity.Warning;
    case 'information':
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

// The integrated terminals launched for build/run/clean honour the same
// karkain.env overlay and engine override as spawned processes.
function terminalEnv(scope?: vscode.WorkspaceFolder): NodeJS.ProcessEnv {
  return { ...getEnv(scope), ...engineEnv(scope) };
}

// `scope` is the workspace folder that owns the file the command acts on, so a
// multi-root window runs each root's own configured toolchain.
function runInTerminal(
  label: string,
  args: string[],
  cwd?: string,
  scope?: vscode.WorkspaceFolder,
): vscode.Terminal {
  const term = vscode.window.createTerminal({ name: label, cwd, env: terminalEnv(scope) });
  term.show(true);
  term.sendText(`${quoteTerminalArg(getCompilerPath(scope))} ${args.map(quoteTerminalArg).join(' ')}`);
  return term;
}

function recordAction(kind: ActionKind, summary: string, ok: boolean | null): void {
  controlCenter?.recentActions.record({ kind, summary, ok });
  controlCenter?.refreshAll();
}

// Working directory for file commands: the karkain.toml project root when the
// file lives in a project, else the workspace folder that owns the file, else
// undefined.
//
// Multi-root: the owning folder is resolved from the file itself, never from
// `workspaceFolders[0]`. A file outside every root yields undefined, which the
// toolchain treats as "inherit the process cwd" — an honest result rather than
// a fabricated association with an unrelated root.
function effectiveCwd(file: string): string | undefined {
  const root = findProjectRoot(file);
  if (root) {
    return root;
  }
  return vscode.workspace.getWorkspaceFolder(vscode.Uri.file(file))?.uri.fsPath;
}

/**
 * The configuration scope for a file: the workspace folder that owns it, or
 * undefined when it is outside every root.
 *
 * Passing this to `getCompilerPath`/`getTarget`/… is what makes folder-scoped
 * settings resolve per root. Undefined is the correct answer for a document with
 * no workspace context, not a gap to paper over with the first folder.
 */
function configScopeFor(file: string): vscode.WorkspaceFolder | undefined {
  if (!file) {
    return undefined;
  }
  return vscode.workspace.getWorkspaceFolder(vscode.Uri.file(file));
}

/** Same, from an open document (its URI is the resource VS Code scopes on). */
function configScopeForDoc(doc: vscode.TextDocument | undefined): vscode.WorkspaceFolder | undefined {
  return doc ? configScopeFor(doc.uri.fsPath) : undefined;
}

// Resolves the configured debugger (karkain.debuggerPath). Absolute paths are
// used as-is when they exist; bare names are looked up on PATH. Returns null
// when nothing resolvable exists.
function resolvedDebuggerPath(scope?: vscode.WorkspaceFolder): string | null {
  const configured = getDebuggerPath(scope);
  const configuredIsPath = configured.includes('/') || configured.includes('\\');
  if (configuredIsPath) {
    return fs.existsSync(configured) ? configured : null;
  }
  return (
    resolveOnPath(pathDirectories(), [configured], (p) => fs.existsSync(p)) ??
    (fs.existsSync(configured) ? configured : null)
  );
}

function pathDirectories(): string[] {
  return splitPathEnv(process.env.PATH, process.platform);
}

function toolchainNames(): string[] {
  return candidateExecutableNames(process.platform);
}

// Every karkain executable found via PATH (de-duplicated), configured path first.
// `scope` resolves folder-scoped settings: without it a multi-root window would
// offer root A's configured toolchain while acting on root B's file.
function discoverToolchains(scope?: vscode.WorkspaceFolder): string[] {
  const found = listOnPath(pathDirectories(), toolchainNames(), (p) => fs.existsSync(p));
  const configured = getCompilerPath(scope);
  const configuredIsPath = configured.includes('/') || configured.includes('\\');
  if (configuredIsPath && fs.existsSync(configured) && !found.includes(configured)) {
    return [configured, ...found];
  }
  return found;
}

// The status bar is a single global item, so it reports the target for the
// active document's folder. With no active document it falls back to the
// workspace-wide value rather than an arbitrary root's.
function updateTargetStatus(): void {
  const scope = configScopeForDoc(vscode.window.activeTextEditor?.document);
  const t = getTarget(scope);
  if (targetStatus) {
    targetStatus.text = `Karkain: ${t === '' ? 'native' : t}`;
    targetStatus.tooltip = scope
      ? `Karkain target for ${scope.name} (click to select)`
      : 'Karkain target (click to select)';
    targetStatus.command = 'karkain.selectTarget';
    targetStatus.show();
  }
}

function resolvedCompilerPath(scope?: vscode.WorkspaceFolder): string {
  const configured = getCompilerPath(scope);
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
  // Scope settings to the folder that owns this task's file, so a task for a
  // file in root B builds with root B's target and compiler.
  const scope = definition.file ? configScopeFor(definition.file) : folder;
  let args: string[];
  try {
    // The configured target is applied here, exactly as the Build File/Run File
    // commands apply it, so the task and the command cannot disagree.
    args = taskArgs({ kind, file: definition.file, target: getTarget(scope) });
  } catch {
    return undefined;
  }
  const cwd =
    cwdOverride ?? (definition.file ? effectiveCwd(definition.file) : undefined) ?? folder?.uri.fsPath;
  const execution = new vscode.ShellExecution(getCompilerPath(scope), args, { cwd });
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

async function spawnCheck(
  file: string,
  folder: string | undefined,
  extraEnv: NodeJS.ProcessEnv,
): Promise<CheckSpawn> {
  const r: ToolchainRunResult = await currentToolchain().run(checkArgs(file, true), {
    cwd: folder,
    env: extraEnv,
    timeoutMs: DEFAULT_TOOLCHAIN_TIMEOUT_MS,
  });
  return {
    code: r.code,
    stdout: r.stdout,
    stderr: r.stderr,
    spawnError: r.spawnError,
  };
}

async function runCheck(doc: vscode.TextDocument): Promise<void> {
  const file = doc.uri.fsPath;
  // Same effective-cwd model as every other file command: the karkain.toml
  // project root when the file lives in a project, else the workspace folder,
  // else undefined. This also anchors relative diagnostic `file` paths.
  const folder = effectiveCwd(file);
  const useJson =
    toolchainVersion === undefined ||
    toolchainVersion === '' ||
    supportsStructuredDiagnostics(toolchainVersion);
  if (!useJson) {
    void vscode.window.showWarningMessage(
      'Karkain: structured diagnostics require Karkain 1.1.0+. Raw compiler output was written to the Karkain channel.',
    );
  }
  // Two engines are probed on purpose and this is a compatibility contract,
  // not redundancy (verified against the Karkain 1.1.0 source):
  //   * cmd/karkain/main.go dispatches `check` on the default (kcc) engine to
  //     cli.KCCCheckCommand(nil, file, verbose), which takes no format
  //     argument and can only render the human report.
  //   * The Go backend dispatches to cli.CheckCommandFormatted(..., json),
  //     which is the only path that writes a schema-v1 JSON array to stdout.
  // So the first probe is the fast path for a toolchain that does honour the
  // flag, and the second is what actually yields structured diagnostics for
  // the default engine. Removing the first would break any Karkain build whose
  // default engine does support `--format=json`; removing the second would
  // leave the extension with no structured diagnostics at all.
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
      recordAction('check', `check ${path.basename(file)} (spawn failed)`, false);
      void vscode.window.showErrorMessage(
        'Karkain: could not start the karkain executable. Configure `karkain.compilerPath` or add karkain to PATH.',
      );
      return;
    }
    const parsed = tryParseCheckJson(r.stdout);
    if (parsed !== null) {
      result = r;
      usedEngine = attempt.label;
      recordAction(
        'check',
        `check ${path.basename(file)} (${attempt.label}, exit ${r.code}, ${parsed.length} problem(s))`,
        parsed.length === 0,
      );
      reportCheck(doc, file, folder, r, parsed);
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
    recordAction('check', `check ${path.basename(file)} (engine ${usedEngine}, exit ${last.code})`, false);
    void vscode.window.showErrorMessage(
      `Karkain: check failed (exit ${last.code}). See the Karkain output channel.`,
    );
  } else {
    recordAction('check', `check ${path.basename(file)} (engine ${usedEngine}, ok)`, true);
    vscode.window.setStatusBarMessage('Karkain: check passed', 3000);
  }
}

function reportCheck(
  doc: vscode.TextDocument,
  file: string,
  cwd: string | undefined,
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
  // `karkain check` reports per-file spans, so one invocation can describe
  // several files. Group by the diagnostic's own `file` instead of pinning
  // everything to the active document, which would attribute another file's
  // error to the file the user happens to have open.
  const byFile = new Map<string, vscode.Diagnostic[]>();
  for (const d of parsed) {
    const resolved = resolveDiagnosticFile(d.file, cwd, file);
    const r = toDiagnosticRange(d);
    const diag = new vscode.Diagnostic(
      new vscode.Range(r.startLine, r.startCharacter, r.endLine, r.endCharacter),
      d.message,
      toVscodeSeverity(d.severity),
    );
    diag.source = 'karkain';
    if (d.code) {
      diag.code = d.code;
    }
    const bucket = byFile.get(resolved);
    if (bucket) {
      bucket.push(diag);
    } else {
      byFile.set(resolved, [diag]);
    }
  }
  for (const [target, diags] of byFile) {
    problems?.set(vscode.Uri.file(target), diags);
  }
  const total = parsed.length;
  const files = byFile.size;
  vscode.window.setStatusBarMessage(
    files > 1 ? `Karkain: ${total} problem(s) in ${files} file(s)` : `Karkain: ${total} problem(s)`,
    5000,
  );
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
  recordAction('test', `test ${targets.map((t) => path.basename(t.uri.fsPath)).join(', ') || '(all)'}`, null);
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
    const outcome = await currentToolchain()
      .run(testFileArgs(target.uri.fsPath), {
        cwd,
        token,
        timeoutMs: DEFAULT_TOOLCHAIN_TIMEOUT_MS,
      })
      .then((r) => ({ code: r.code, out: r.combined, spawnError: r.spawnError }));
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
  if (getTarget(folder) !== '') {
    debugChannel?.appendLine(
      `note: karkain.target is '${getTarget(folder)}'; debugging always uses a host build`,
    );
  }
  debugChannel?.appendLine(`$ karkain build -g ${file} -o ${program}`);
  const build = await currentToolchain()
    .run(debugBuildArgs(file, program), { cwd, timeoutMs: DEFAULT_TOOLCHAIN_TIMEOUT_MS })
    .then((r) => ({ code: r.code, out: r.spawnError ? r.combined + r.spawnError : r.combined }));
  debugChannel?.append(build.out);
  if (build.code !== 0) {
    debugChannel?.appendLine(`(debug build failed, exit ${build.code})`);
    recordAction('debug', `debug ${path.basename(file)} (build failed)`, false);
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
  const config = cppdbgLaunchConfig(program, getDebuggerPath(folder));
  debugChannel?.appendLine(`launching ${program} under GDB`);
  const started = await vscode.debug.startDebugging(folder, config);
  recordAction('debug', `debug ${path.basename(file)}`, started);
  if (!started) {
    void vscode.window.showErrorMessage(
      'Karkain: debugger did not start. Is the C/C++ extension (cppdbg) installed and GDB on PATH?',
    );
  }
}

/**
 * The extension's public API. A minimal test-only seam, deliberately the
 * *entire* exported surface rather than a DI container.
 *
 * Removing it would leave the extension-host suite with no way to substitute
 * the toolchain or drive capability negotiation, and the only alternatives are a
 * bespoke injection framework (more production surface than the seam it
 * replaces) or requiring a real `karkain` on PATH (which would make the
 * activation tests environment-dependent). It keeps every production code path
 * free of test knowledge.
 */
export interface KarkainExtensionApi {
  /** Replaces the process seam. Intended for tests; production never calls this. */
  setToolchainService(service: ToolchainService): void;
  /**
   * Validates a real InitializeResult against the required capability set and
   * reports any degradation. Exposed so the extension-host suite can assert the
   * production negotiation path without standing up a real `karkain lsp`.
   */
  reportServerCapabilities(result: unknown): void;
}

export function activate(context: vscode.ExtensionContext): KarkainExtensionApi {
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
  log(`Karkain for Visual Studio Code ${context.extension.packageJSON.version as string} activated.`);
  void probeToolchain();
  // Fire-and-forget: activation must not block on the language server.
  void startLanguageClient(context);
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
        // Every argument below is resolved against the folder owning this file,
        // so a multi-root window builds with the right root's settings.
        const scope = configScopeFor(doc.uri.fsPath);
        const args = [...buildArgs(doc.uri.fsPath), ...splitFlags(getBuildArgs(scope))];
        runInTerminal(
          'karkain build',
          applyTarget(args, getTarget(scope)),
          getWorkingDirectory(scope) || effectiveCwd(doc.uri.fsPath),
          scope,
        );
        controlCenter?.refreshAll();
        recordAction('build', `build ${path.basename(doc.uri.fsPath)}`, null);
      }
    }),
    vscode.commands.registerCommand('karkain.run', () => {
      const doc = activeKarkainDocument();
      if (doc) {
        const scope = configScopeFor(doc.uri.fsPath);
        const runArgsForDoc = [...runArgs(doc.uri.fsPath), ...splitFlags(getRunArgs(scope))];
        const term = runInTerminal(
          'karkain run',
          applyTarget(runArgsForDoc, getTarget(scope)),
          getWorkingDirectory(scope) || effectiveCwd(doc.uri.fsPath),
          scope,
        );
        // Remember the launch for Re-run/Stop (terminal lifetime unknown).
        lastRunTerminal = term;
        lastRunLaunch = { file: doc.uri.fsPath, flags: splitFlags(getRunArgs(scope)) };
        controlCenter?.refreshAll();
        recordAction('run', `run ${path.basename(doc.uri.fsPath)}`, null);
      }
    }),
    vscode.commands.registerCommand('karkain.clean', () => {
      const doc = vscode.window.activeTextEditor?.document;
      // Clean is project-scoped: it runs in the active file's project root, else
      // its workspace folder. With no active document it uses the first root,
      // which is the pre-existing single-root behaviour, unchanged.
      const scope = configScopeForDoc(doc);
      const cwd = doc
        ? getWorkingDirectory(scope) || effectiveCwd(doc.uri.fsPath)
        : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      runInTerminal('karkain clean', cleanArgs(), cwd, configScopeForDoc(doc));
      recordAction('clean', 'clean', null);
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
      // Multi-root: a folder-scoped selection must not be written as a
      // workspace-wide value, or choosing a toolchain for root A would silently
      // change root B too. `scopeFolder` is the active file's folder; with no
      // active document the selection is workspace-wide, as before.
      const scopeFolder = configScopeForDoc(vscode.window.activeTextEditor?.document);
      const found = discoverToolchains(scopeFolder);
      const configured = getCompilerPath(scopeFolder);
      const inUse = resolvedCompilerPath(scopeFolder);
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
        {
          placeHolder: scopeFolder
            ? `Select the Karkain toolchain for ${scopeFolder.name}`
            : 'Select the Karkain toolchain executable',
        },
      );
      if (!pick) {
        return;
      }
      if (!fs.existsSync(pick.label)) {
        void vscode.window.showErrorMessage(`Karkain: ${pick.label} no longer exists.`);
        return;
      }
      // Single-root keeps the original workspace-wide write. With multiple
      // roots and a folder in context, write folder-scoped so the choice is
      // isolated to the root the user is working in.
      const multiRoot = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
      const target =
        multiRoot && scopeFolder
          ? vscode.ConfigurationTarget.WorkspaceFolder
          : vscode.workspace.workspaceFolders?.[0]
            ? vscode.ConfigurationTarget.Workspace
            : vscode.ConfigurationTarget.Global;
      await vscode.workspace
        .getConfiguration('karkain', scopeFolder)
        .update('compilerPath', pick.label, target);
      log(
        `Karkain toolchain selected: ${pick.label}${target === vscode.ConfigurationTarget.WorkspaceFolder ? ` (${scopeFolder?.name} only)` : ''}`,
      );
      vscode.window.setStatusBarMessage(`Karkain: toolchain set to ${pick.label}`, 5000);
      await probeToolchain();
    }),
    vscode.commands.registerCommand('karkain.formatDocument', () => {
      const doc = vscode.window.activeTextEditor?.document;
      if (!doc) {
        return;
      }
      if (!client) {
        // The language server is the only formatting provider; say so instead
        // of silently doing nothing.
        void vscode.window.showWarningMessage(
          'Karkain: formatting requires the Karkain language server, which is not running. See the Karkain Language Server output channel.',
        );
        return;
      }
      recordAction('format', 'format document', null);
      void vscode.commands.executeCommand('editor.action.formatDocument');
    }),
    vscode.commands.registerCommand('karkain.selectTarget', async () => {
      // Multi-root: list targets for the active file's folder and write the
      // choice folder-scoped, so root B's target is not changed by a selection
      // made while working in root A.
      const scopeFolder = configScopeForDoc(vscode.window.activeTextEditor?.document);
      const probeCwd = scopeFolder?.uri.fsPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const peer = await execTool(targetArgs(), probeCwd);
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
      const multiRoot = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
      await vscode.workspace
        .getConfiguration('karkain', scopeFolder)
        .update(
          'target',
          pick.value,
          multiRoot && scopeFolder
            ? vscode.ConfigurationTarget.WorkspaceFolder
            : vscode.workspace.workspaceFolders?.[0]
              ? vscode.ConfigurationTarget.Workspace
              : vscode.ConfigurationTarget.Global,
        );
      log(
        `Karkain target selected: ${pick.value === '' ? '(host default)' : pick.value}${
          multiRoot && scopeFolder ? ` (${scopeFolder.name} only)` : ''
        }`,
      );
      updateTargetStatus();
      vscode.window.setStatusBarMessage(
        `Karkain: target set to ${pick.value === '' ? 'host default' : pick.value}`,
        5000,
      );
    }),
    vscode.commands.registerCommand('karkain.showEnvironment', async () => {
      channel?.show(true);
      const active = vscode.window.activeTextEditor?.document;
      // Multi-root: report against the active file's folder so the numbers shown
      // are the ones that will actually be used, and list every root rather than
      // only the first.
      const scopeFolder = configScopeForDoc(active);
      const roots = vscode.workspace.workspaceFolders ?? [];
      if (roots.length > 1) {
        log(`workspace roots (${roots.length}): ${roots.map((r) => r.name).join(', ')}`);
      }
      log(`active folder: ${scopeFolder ? scopeFolder.name : '(none — active file is outside every root)'}`);
      log(`executable: ${getCompilerPath(scopeFolder)} (resolved: ${resolvedCompilerPath(scopeFolder)})`);
      log(
        `selected target: ${
          getTarget(scopeFolder) === '' ? '(host default)' : getTarget(scopeFolder)
        }${scopeFolder ? ` (${scopeFolder.name})` : ''}`,
      );
      const project = active ? loadProject(active.uri.fsPath) : null;
      log(`project root: ${project ? project.root : '(none)'}`);
      if (project) {
        const m = project.manifest;
        log(
          `project: ${describeProject(m) ?? '(unnamed)'} (license: ${m.license ?? 'unset'}, targets: ${
            m.targets.length > 0 ? m.targets.join(', ') : 'unset'
          })`,
        );
        // Honest about partial reads rather than implying a clean manifest.
        if (m.sections.length > 0) {
          log(`project manifest sections not modelled: ${m.sections.join(', ')}`);
        }
        if (m.extraKeys.length > 0) {
          log(`project manifest keys not modelled: ${m.extraKeys.join(', ')}`);
        }
      } else if (active) {
        log('project manifest: not found or unreadable');
      }
      log(`toolchains on PATH: ${discoverToolchains(scopeFolder).join(', ') || '(none)'}`);
      // Probe from the active file's folder; with no active file, the first root.
      const probeCwd = scopeFolder?.uri.fsPath ?? roots[0]?.uri.fsPath;
      for (const args of [versionArgs(), targetArgs(), configArgs()]) {
        const r = await execTool(args, probeCwd);
        log(`$ karkain ${args.join(' ')} (exit ${r.code})\n${r.stdout}${r.stderr}`);
      }
    }),
    vscode.commands.registerCommand('karkain.restartLanguageServer', async () => {
      await restartLanguageClientAndStart(context);
      vscode.window.setStatusBarMessage('Karkain: language server restarted', 3000);
    }),
    vscode.tasks.registerTaskProvider('karkain', {
      provideTasks() {
        const tasks: vscode.Task[] = [];
        const doc = vscode.window.activeTextEditor?.document;
        const isKark = !!doc && (doc.languageId === 'karkain' || isKarkFile(doc.uri.fsPath));
        // Multi-root: the owning folder of the active file. `??` to the first
        // root preserves the pre-existing behaviour when there is no active
        // document; a file that belongs to no root still resolves to undefined
        // in resolveTaskDefinition, which scopes its settings honestly.
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
    // Formatting is intentionally NOT registered here. `karkain lsp`
    // advertises `formattingProvider` (pkg/lsp/handler.go), so the language
    // client is the single authoritative formatting provider and `karkain fmt`
    // is reached through the server's textDocument/formatting request. An
    // extension-side `karkain fmt` provider used to compete with it; removing
    // it leaves exactly one provider for the operation. No fallback formatter
    // is faked: with no language server there is simply no formatter.
  );

  // Guarded so the post-format save below cannot re-enter the handler.
  let formattingOnSave = false;
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (formattingOnSave) {
        return;
      }
      // Multi-root: formatOnSave is folder-scoped, so it must be read for the
      // saved file's own folder. Reading it unscoped would apply root A's
      // preference to a file saved in root B.
      if (
        (doc.languageId === 'karkain' || isKarkFile(doc.uri.fsPath)) &&
        getFormatOnSave(configScopeForDoc(doc))
      ) {
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
      if (!e.affectsConfiguration('karkain')) {
        return;
      }
      void probeToolchain();
      updateTargetStatus();
      // A changed compilerPath invalidates the running server: it was spawned
      // from the previous executable and would keep answering for a toolchain
      // the user has moved away from. Restart it, and say so in the output
      // channel so the brief loss of intelligence is never silent.
      //
      // There is deliberately ONE language client for the whole window, not one
      // per root: `karkain lsp` is a single stdio server and the client owns the
      // document selector for every root. The restart is reported for the
      // affected folder so a per-folder change is still explained.
      if (e.affectsConfiguration('karkain.compilerPath')) {
        const scope = configScopeForDoc(vscode.window.activeTextEditor?.document);
        const next = getCompilerPath(scope);
        log(
          `karkain.compilerPath changed to '${next}'${
            scope ? ` for ${scope.name}` : ''
          }; restarting the language server.`,
        );
        void restartLanguageClientAndStart(context).then(() =>
          vscode.window.setStatusBarMessage('Karkain: language server restarted (toolchain changed)', 3000),
        );
      }
      if (e.affectsConfiguration('karkain.debuggerPath')) {
        void vscode.commands.executeCommand(
          'setContext',
          'karkain.debugAvailable',
          resolvedDebuggerPath() !== null &&
            vscode.extensions.getExtension('ms-vscode.cpptools') !== undefined,
        );
      }
      if (
        e.affectsConfiguration('karkain.engine') ||
        e.affectsConfiguration('karkain.env') ||
        e.affectsConfiguration('karkain.stdlibPath') ||
        e.affectsConfiguration('karkain.examplesPath') ||
        e.affectsConfiguration('karkain.target') ||
        e.affectsConfiguration('karkain.workingDirectory')
      ) {
        controlCenter?.refreshAll();
      }
    }),
    // Multi-root: roots can be added or removed while the window is open. The
    // extension keeps exactly one client, one diagnostic collection, one test
    // controller and one watcher regardless of how many roots exist, so there is
    // nothing to construct or tear down here — but the status bar and toolchain
    // facts are folder-scoped and must be recomputed against the new root set.
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      const roots = vscode.workspace.workspaceFolders ?? [];
      log(
        `workspace folders changed: ${roots.length} root(s)${roots.length > 1 ? ` (${roots.map((r) => r.name).join(', ')})` : ''}`,
      );
      updateTargetStatus();
      controlCenter?.refreshAll();
    }),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (testController && isTestFileUri(doc.uri)) {
        void refreshTestFile(doc.uri);
      }
    }),
  );
  // ---- Control Center ------------------------------------------------------
  extensionInfo.version =
    (context.extension?.packageJSON?.version as string | undefined) ?? extensionInfo.version;
  controlCenter = registerControlCenter(context, sharedViewState);
  void vscode.commands.executeCommand(
    'setContext',
    'karkain.debugAvailable',
    resolvedDebuggerPath() !== null && vscode.extensions.getExtension('ms-vscode.cpptools') !== undefined,
  );

  // ---- Shared health/diagnostics report ------------------------------------
  interface IdeProbeState {
    kind: 'ok' | 'invalid' | 'unsupported' | 'not-probed';
    detail?: string;
  }
  let lastIdeInfo: IdeProbeState = { kind: 'not-probed' };

  const ideProbeDetail = (r: { stdout: string; code: number }): IdeProbeState => {
    const parsed = parseIdeInfo(r.stdout);
    if (parsed.kind === 'ok') {
      return { kind: 'ok' };
    }
    return parsed.kind === 'invalid'
      ? { kind: 'invalid', detail: parsed.detail }
      : { kind: 'unsupported', detail: parsed.detail };
  };

  const countRepairLog = (): number | undefined => {
    const file = process.env.KARKAIN_LSP_REPAIR_LOG;
    if (!file) {
      return undefined;
    }
    try {
      return fs
        .readFileSync(file, 'utf8')
        .split('\n')
        .filter((l) => l.trim().length > 0).length;
    } catch {
      return undefined;
    }
  };

  const gatherHealthReport = async (): Promise<string> => {
    const active = vscode.window.activeTextEditor?.document;
    const scopeFolder = configScopeForDoc(active) ?? vscode.workspace.workspaceFolders?.[0];
    const compilerPathSetting = getCompilerPath(scopeFolder);
    const resolved = resolvedCompilerPath(scopeFolder);
    const exists = fs.existsSync(resolved);
    const probe = await execTool(versionArgs(), undefined, scopeFolder);
    const parsed = classifyProbe(probe, probe.notFound);
    const ide = await execTool(['ide', 'info'], undefined, scopeFolder);
    lastIdeInfo = ideProbeDetail(ide);
    const manifest = (() => {
      const start = active?.uri.fsPath ?? scopeFolder?.uri.fsPath;
      if (!start) {
        return null;
      }
      const project = loadProject(start);
      if (!project) {
        return { found: false as const, problem: 'no karkain.toml found (or unreadable)' };
      }
      return { found: true as const, summary: describeProject(project.manifest) ?? '(unnamed project)' };
    })();
    const gdb = resolvedDebuggerPath(scopeFolder);
    const roots = (vscode.workspace.workspaceFolders ?? []).map((r) => r.uri.fsPath);
    const diagnostics = vscode.languages.getDiagnostics().reduce((n, [, d]) => n + d.length, 0);
    const report = buildHealthReport({
      vscodeVersion: vscode.version,
      platform: `${process.platform}/${process.arch}`,
      extensionVersion: extensionInfo.version,
      compilerPathSetting,
      compilerPathResolved: resolved,
      compilerExists: exists,
      probe:
        parsed.kind === 'ok'
          ? { ok: true, version: parsed.version, rawBanner: parsed.raw }
          : parsed.kind === 'notFound'
            ? { ok: false, detail: 'executable not found' }
            : parsed.kind === 'unrecognized'
              ? { ok: false, detail: `unrecognized banner: ${parsed.raw}` }
              : { ok: false, detail: `exit ${parsed.code}: ${parsed.detail}` },
      engineSetting: getEngine(scopeFolder),
      targetSetting: getTarget(scopeFolder),
      lsp: {
        running: sharedViewState.lspRunning,
        restarts: sharedViewState.lspRestarts,
        lastError: sharedViewState.lastLspError,
      },
      shim: { present: fs.existsSync(path.join(__dirname, 'lsp-proxy.js')), repairsLogged: countRepairLog() },
      workspaceRoots: roots,
      manifest,
      gdb: { pathSetting: getDebuggerPath(scopeFolder), found: gdb !== null },
      stdlibPathSet: getStdlibPath(scopeFolder).length > 0,
      examplesPathSet: getExamplesPath(scopeFolder).length > 0,
      ideInfo: lastIdeInfo,
      diagnosticCount: diagnostics,
    });
    sharedViewState.healthOverall = report.overall === 'info' ? 'ok' : report.overall;
    controlCenter?.refreshAll();
    return report.text;
  };

  const topicBySlug = (slug: string): string | undefined => {
    const found = DOC_TOPICS.find((t) => t.slug === slug);
    return found ? path.join(context.extensionUri.fsPath, 'docs', 'user', found.file) : undefined;
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('karkain.newProject', async () => {
      const name = await vscode.window.showInputBox({
        prompt: 'Project name (creates <parent>/<name> via `karkain init`)',
        placeHolder: 'my-app',
        validateInput: (v) =>
          v.trim().length === 0
            ? 'name is required'
            : v.trim().startsWith('-')
              ? 'name must not start with a dash'
              : undefined,
      });
      if (!name) {
        return;
      }
      const picked = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: 'Select parent folder',
      });
      if (!picked || picked.length === 0) {
        return;
      }
      const r = await currentToolchain().run(['init', name.trim()], {
        cwd: picked[0].fsPath,
        timeoutMs: DEFAULT_TOOLCHAIN_TIMEOUT_MS,
      });
      log(`$ karkain init ${name.trim()} (exit ${r.code})\n${r.combined}`);
      if (r.code !== 0) {
        void vscode.window.showErrorMessage(
          `Karkain: project creation failed (exit ${r.code}). See the Karkain output channel.`,
        );
        return;
      }
      const targetDir = vscode.Uri.joinPath(picked[0], name.trim());
      const add = await vscode.window.showInformationMessage(
        `Karkain: project "${name.trim()}" created in ${targetDir.fsPath}.`,
        'Add to Workspace',
        'Open Folder',
        'Dismiss',
      );
      if (add === 'Add to Workspace') {
        vscode.workspace.updateWorkspaceFolders(vscode.workspace.workspaceFolders?.length ?? 0, 0, {
          uri: targetDir,
          name: name.trim(),
        });
      } else if (add === 'Open Folder') {
        void vscode.commands.executeCommand('vscode.openFolder', targetDir, { forceNewWindow: true });
      } else {
        const marker = vscode.Uri.joinPath(targetDir, 'src', 'main.kark');
        if (fs.existsSync(marker.fsPath)) {
          void vscode.window.showTextDocument(await vscode.workspace.openTextDocument(marker));
        }
      }
    }),
    vscode.commands.registerCommand('karkain.openProject', async () => {
      const picked = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: true,
        openLabel: 'Open Karkain project folder(s)',
      });
      if (!picked || picked.length === 0) {
        return;
      }
      const current = vscode.workspace.workspaceFolders?.length ?? 0;
      vscode.workspace.updateWorkspaceFolders(
        current,
        0,
        ...picked.map((uri) => ({ uri, name: path.basename(uri.fsPath) })),
      );
    }),
    vscode.commands.registerCommand('karkain.lint', async () => {
      const doc = activeKarkainDocument();
      if (!doc) {
        return;
      }
      const scope = configScopeFor(doc.uri.fsPath);
      const r = await execTool(['lint', doc.uri.fsPath], effectiveCwd(doc.uri.fsPath), scope);
      channel?.appendLine(`$ karkain lint ${doc.uri.fsPath} (exit ${r.code})\n${r.stdout}${r.stderr}`);
      channel?.show(true);
      recordAction('check', `lint ${path.basename(doc.uri.fsPath)}`, r.code === 0);
      void vscode.window.setStatusBarMessage(
        r.code === 0 ? 'Karkain: lint passed' : `Karkain: lint reported issues (exit ${r.code})`,
        5000,
      );
    }),
    vscode.commands.registerCommand('karkain.explainError', async () => {
      const code = await vscode.window.showInputBox({
        prompt: 'Karkain error code to explain (from the Problems panel or check output)',
        placeHolder: 'K001',
        validateInput: (v) =>
          /^(K|E|W)?[0-9]{1,4}$/i.test(v.trim()) ? undefined : 'expected a code such as K001',
      });
      if (!code) {
        return;
      }
      const r = await execTool(['explain', code.trim().toUpperCase()]);
      channel?.appendLine(
        `$ karkain explain ${code.trim().toUpperCase()} (exit ${r.code})\n${r.stdout}${r.stderr}`,
      );
      channel?.show(true);
    }),
    vscode.commands.registerCommand('karkain.showConfig', async () => {
      const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const r = await execTool(configArgs(), ws);
      channel?.appendLine(`$ karkain config (exit ${r.code})\n${r.stdout}${r.stderr}`);
      channel?.show(true);
    }),
    vscode.commands.registerCommand('karkain.showIdeInfo', async () => {
      const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const r = await execTool(['ide', 'info'], ws);
      const parsed = parseIdeInfo(r.stdout);
      lastIdeInfo = ideProbeDetail(r);
      const schema = parsed.kind === 'ok' ? String(parsed.info.schemaVersion) : 'unusable';
      channel?.appendLine(
        `$ karkain ide info (exit ${r.code}, schemaVersion: ${schema})\n${r.stdout}${r.stderr}`,
      );
      channel?.show(true);
      if (parsed.kind === 'ok') {
        log(`ide info contract accepted (schemaVersion ${parsed.info.schemaVersion})`);
      } else {
        log(
          `ide info contract not usable (${parsed.kind}): the extension falls back to verified argv vectors`,
        );
      }
    }),
    vscode.commands.registerCommand('karkain.selectEngine', async () => {
      const scopeFolder = configScopeForDoc(vscode.window.activeTextEditor?.document);
      const current = getEngine(scopeFolder);
      const pick = await vscode.window.showQuickPick(
        [
          {
            label: '(default) Toolchain default',
            description: 'kcc on 1.2.0 — needs a C compiler to bootstrap',
            value: '""',
          },
          { label: 'kcc', description: 'Self-hosted engine, explicit', value: 'kcc' },
          { label: 'go', description: 'Go front end — required for `check --format=json`', value: 'go' },
        ],
        {
          placeHolder: scopeFolder
            ? `Engine for ${scopeFolder.name} (current: ${current || 'default'})`
            : `Engine for the workspace (current: ${current || 'default'})`,
        },
      );
      if (!pick) {
        return;
      }
      const value = pick.value === '""' ? '' : pick.value;
      const multiRoot = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
      const target =
        multiRoot && scopeFolder
          ? vscode.ConfigurationTarget.WorkspaceFolder
          : vscode.workspace.workspaceFolders?.[0]
            ? vscode.ConfigurationTarget.Workspace
            : vscode.ConfigurationTarget.Global;
      await vscode.workspace.getConfiguration('karkain', scopeFolder).update('engine', value, target);
      log(`karkain.engine set to '${value || '(default)'}'${scopeFolder ? ` for ${scopeFolder.name}` : ''}`);
      controlCenter?.refreshAll();
      void vscode.window.setStatusBarMessage(`Karkain: engine set to ${value || '(default)'}`, 3000);
    }),
    vscode.commands.registerCommand('karkain.workspaceBuild', async () => {
      const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const yes = await vscode.window.showInformationMessage(
        'Build all workspace members in dependency order? This can take a while.',
        'Build',
        'Cancel',
      );
      if (yes !== 'Build') {
        return;
      }
      runInTerminal('karkain workspace build', ['workspace', 'build'], ws);
      recordAction('build', 'workspace build', null);
    }),
    vscode.commands.registerCommand('karkain.workspaceTest', async () => {
      const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      runInTerminal('karkain workspace test', ['workspace', 'test'], ws);
      recordAction('test', 'workspace test', null);
    }),
    vscode.commands.registerCommand('karkain.workspaceCheck', async () => {
      const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const r = await execTool(['workspace', 'check'], ws);
      channel?.appendLine(`$ karkain workspace check (exit ${r.code})\n${r.stdout}${r.stderr}`);
      channel?.show(true);
      recordAction('check', 'workspace check', r.code === 0);
      void vscode.window.setStatusBarMessage(
        r.code === 0 ? 'Karkain: workspace check passed' : `Karkain: workspace check failed (exit ${r.code})`,
        5000,
      );
    }),
    vscode.commands.registerCommand('karkain.workspaceTree', async () => {
      const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const r = await execTool(['workspace', 'graph'], ws);
      channel?.appendLine(`$ karkain workspace graph (exit ${r.code})\n${r.stdout}${r.stderr}`);
      channel?.show(true);
    }),
    vscode.commands.registerCommand('karkain.addPackage', async () => {
      const name = await vscode.window.showInputBox({
        prompt: 'Package name (Karkain registry)',
        placeHolder: 'http3',
        validateInput: (v) =>
          v.trim().length === 0
            ? 'name is required'
            : v.trim().startsWith('-')
              ? 'name must not start with a dash'
              : undefined,
      });
      if (!name) {
        return;
      }
      const version = await vscode.window.showInputBox({
        prompt: 'Version (optional — semver or ^range)',
        placeHolder: '^0.14.0',
      });
      const versionArg = version?.trim() ? [version.trim()] : [];
      const confirm = await vscode.window.showInformationMessage(
        `Add dependency "${name.trim()}"${versionArg.length ? ` ${version!.trim()}` : ''}? This updates karkain.toml and karkain.lock.`,
        'Add',
        'Cancel',
      );
      if (confirm !== 'Add') {
        return;
      }
      const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const r = await currentToolchain().run(['add', name.trim(), ...versionArg], {
        cwd: ws,
        timeoutMs: DEFAULT_TOOLCHAIN_TIMEOUT_MS,
      });
      channel?.appendLine(
        `$ karkain add ${name.trim()} ${versionArg.join(' ')} (exit ${r.code})\n${r.combined}`,
      );
      channel?.show(true);
      void vscode.window.setStatusBarMessage(
        r.code === 0 ? `Karkain: added ${name.trim()}` : `Karkain: add failed (exit ${r.code})`,
        5000,
      );
    }),
    vscode.commands.registerCommand('karkain.fetchPackages', async () => {
      const confirm = await vscode.window.showInformationMessage(
        'Fetch resolved dependencies per karkain.lock? This may use the network.',
        'Fetch',
        'Cancel',
      );
      if (confirm !== 'Fetch') {
        return;
      }
      const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const r = await currentToolchain().run(['fetch'], { cwd: ws, timeoutMs: DEFAULT_TOOLCHAIN_TIMEOUT_MS });
      channel?.appendLine(`$ karkain fetch (exit ${r.code})\n${r.combined}`);
      channel?.show(true);
      void vscode.window.setStatusBarMessage(
        r.code === 0 ? 'Karkain: dependencies fetched' : `Karkain: fetch failed (exit ${r.code})`,
        5000,
      );
    }),
    vscode.commands.registerCommand('karkain.runWithOptions', async () => {
      const doc = activeKarkainDocument();
      if (!doc) {
        return;
      }
      const scope = configScopeFor(doc.uri.fsPath);
      const flags = await vscode.window.showInputBox({
        prompt: 'Compiler CLI flags for this run (program arguments are NOT forwarded by the v1.2.0 CLI)',
        placeHolder: '--verbose',
      });
      if (flags === undefined) {
        return;
      }
      const split = splitFlags(flags);
      const term = runInTerminal(
        'karkain run',
        applyTarget([...runArgs(doc.uri.fsPath), ...split], getTarget(scope)),
        getWorkingDirectory(scope) || effectiveCwd(doc.uri.fsPath),
        scope,
      );
      lastRunTerminal = term;
      lastRunLaunch = { file: doc.uri.fsPath, flags: split };
      recordAction('run', `run ${path.basename(doc.uri.fsPath)} (flags)`, null);
    }),
    vscode.commands.registerCommand('karkain.rerunLastRun', async () => {
      if (!lastRunLaunch) {
        void vscode.window.showInformationMessage('Karkain: no run launched yet in this session.');
        return;
      }
      const docPath = lastRunLaunch.file;
      const scope = configScopeFor(docPath);
      const term = runInTerminal(
        'karkain run',
        applyTarget([...runArgs(docPath), ...lastRunLaunch.flags], getTarget(scope)),
        getWorkingDirectory(scope) || effectiveCwd(docPath),
        scope,
      );
      lastRunTerminal = term;
      recordAction('run', `run ${path.basename(docPath)} (re-run)`, null);
    }),
    vscode.commands.registerCommand('karkain.stopRun', () => {
      if (lastRunTerminal) {
        lastRunTerminal.sendText('\x03');
        void vscode.window.setStatusBarMessage('Karkain: interrupt (Ctrl+C) sent to the run terminal', 4000);
      } else {
        void vscode.window.showInformationMessage('Karkain: no run terminal from this session to stop.');
      }
    }),
    vscode.commands.registerCommand('karkain.recentActions', async () => {
      const actions = controlCenter?.recentActions.list() ?? [];
      if (actions.length === 0) {
        void vscode.window.showInformationMessage('Karkain: no actions recorded yet.');
        return;
      }
      const kindToCommand: Record<string, string> = {
        check: 'karkain.check',
        build: 'karkain.build',
        run: 'karkain.run',
        test: 'karkain.test',
        debug: 'karkain.debug',
        format: 'karkain.formatDocument',
        clean: 'karkain.clean',
      };
      const pick = await vscode.window.showQuickPick(
        actions.map((a) => ({
          label: a.summary,
          description: `${a.ok === null ? 'launched' : a.ok ? 'ok' : 'FAILED'} · ${new Date(a.at).toLocaleTimeString()}`,
          action: a,
        })),
        { placeHolder: 'Recent actions (pick to run the matching action again)' },
      );
      if (pick && kindToCommand[pick.action.kind]) {
        await vscode.commands.executeCommand(kindToCommand[pick.action.kind]);
      }
    }),
    vscode.commands.registerCommand('karkain.openDocumentation', async () => {
      const pick = await vscode.window.showQuickPick(
        DOC_TOPICS.map((t) => ({ label: t.label, description: t.description, topic: t })),
        { placeHolder: 'Karkain documentation' },
      );
      if (pick) {
        const file = path.join(context.extensionUri.fsPath, 'docs', 'user', pick.topic.file);
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file), {
          preview: true,
        });
      }
    }),
    vscode.commands.registerCommand('karkain.openDocumentationTopic', async (resource?: string) => {
      const file = typeof resource === 'string' ? resource : topicBySlug('getting-started');
      if (file && fs.existsSync(file)) {
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file), {
          preview: true,
        });
      } else {
        void vscode.window.showWarningMessage('Karkain: documentation topic not found in this build.');
      }
    }),
    vscode.commands.registerCommand('karkain.openManifest', async (rootArg?: string) => {
      const active = vscode.window.activeTextEditor?.document;
      const root =
        rootArg ??
        (active ? findProjectRoot(active.uri.fsPath) : undefined) ??
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!root) {
        void vscode.window.showWarningMessage('Karkain: no project found (no karkain.toml).');
        return;
      }
      const file = path.join(root, 'karkain.toml');
      if (!fs.existsSync(file)) {
        void vscode.window.showWarningMessage(`Karkain: no karkain.toml in ${root}.`);
        return;
      }
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file));
    }),
    vscode.commands.registerCommand('karkain.copyCommandUsage', async (usage?: string) => {
      if (typeof usage === 'string' && usage.length > 0) {
        await vscode.env.clipboard.writeText(usage);
        void vscode.window.setStatusBarMessage('Karkain: command copied to clipboard', 3000);
      }
    }),
    vscode.commands.registerCommand('karkain.filterCommands', async (initial?: string) => {
      const provider = controlCenter?.views.commands;
      if (!provider) {
        return;
      }
      const value = await vscode.window.showInputBox({
        prompt: 'Filter compiler commands (empty clears the filter)',
        value: typeof initial === 'string' ? initial : provider.currentFilter,
      });
      if (value === undefined) {
        return;
      }
      provider.setFilter(value);
    }),
    vscode.commands.registerCommand('karkain.filterExamples', async (initial?: string) => {
      const provider = controlCenter?.views.examples;
      if (!provider) {
        return;
      }
      const value = await vscode.window.showInputBox({
        prompt: 'Filter examples (empty clears the filter)',
        value: typeof initial === 'string' ? initial : provider.currentFilter,
      });
      if (value === undefined) {
        return;
      }
      provider.setFilter(value);
    }),
    vscode.commands.registerCommand('karkain.setTraceLevel', async () => {
      const current = getTraceServer();
      const pick = await vscode.window.showQuickPick(
        [
          { label: 'off', description: 'no server tracing', value: 'off' },
          {
            label: 'messages',
            description: 'log message summaries to the output channel',
            value: 'messages',
          },
          { label: 'verbose', description: 'log full LSP payloads (very noisy)', value: 'verbose' },
        ],
        { placeHolder: `Language server trace (current: ${current})` },
      );
      if (!pick) {
        return;
      }
      const scopeFolder = configScopeForDoc(vscode.window.activeTextEditor?.document);
      const multiRoot = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
      const target =
        multiRoot && scopeFolder
          ? vscode.ConfigurationTarget.WorkspaceFolder
          : vscode.workspace.workspaceFolders?.[0]
            ? vscode.ConfigurationTarget.Workspace
            : vscode.ConfigurationTarget.Global;
      await vscode.workspace
        .getConfiguration('karkain', scopeFolder)
        .update('trace.server', pick.value, target);
      applyTraceLevel();
      void vscode.window.setStatusBarMessage(`Karkain: LSP trace set to ${pick.value}`, 3000);
    }),
    vscode.commands.registerCommand('karkain.formatCheck', async () => {
      const doc = activeKarkainDocument();
      if (!doc) {
        return;
      }
      const scope = configScopeFor(doc.uri.fsPath);
      const r = await execTool(['fmt', '--check', doc.uri.fsPath], effectiveCwd(doc.uri.fsPath), scope);
      channel?.appendLine(`$ karkain fmt --check ${doc.uri.fsPath} (exit ${r.code})\n${r.stdout}${r.stderr}`);
      channel?.show(true);
      recordAction('format', `fmt --check ${path.basename(doc.uri.fsPath)}`, r.code === 0);
      void vscode.window.setStatusBarMessage(
        r.code === 0
          ? 'Karkain: formatting OK'
          : `Karkain: file is not canonically formatted (exit ${r.code})`,
        5000,
      );
    }),
    vscode.commands.registerCommand('karkain.debugPrerequisites', async () => {
      const scopeFolder = configScopeForDoc(vscode.window.activeTextEditor?.document);
      const gdb = resolvedDebuggerPath(scopeFolder);
      const cppdbg = vscode.extensions.getExtension('ms-vscode.cpptools');
      channel?.appendLine('Karkain — debug prerequisites');
      channel?.appendLine(`GDB (karkain.debuggerPath): ${gdb ?? 'NOT FOUND'}`);
      channel?.appendLine(
        `C/C++ extension (ms-vscode.cpptools): ${
          cppdbg ? (cppdbg.isActive ? 'installed and active' : 'installed but not active') : 'NOT INSTALLED'
        }`,
      );
      channel?.appendLine(
        'Build: debugging uses `karkain build -g` (debug symbols), which needs a C toolchain.',
      );
      channel?.appendLine('Target: debugging always uses a host build regardless of karkain.target.');
      channel?.appendLine('Test binaries cannot be debugged (no main, do not link).');
      channel?.show(true);
      const problems: string[] = [];
      if (!gdb) {
        problems.push('GDB');
      }
      if (!cppdbg) {
        problems.push('C/C++ extension');
      }
      if (problems.length > 0) {
        void vscode.window.showWarningMessage(
          `Karkain: debug prerequisites missing: ${problems.join(', ')}. See the Karkain output channel for details.`,
        );
      } else {
        void vscode.window.showInformationMessage('Karkain: debug prerequisites look good.');
      }
    }),
    vscode.commands.registerCommand('karkain.runHealthCheck', async () => {
      const text = await gatherHealthReport();
      channel?.appendLine(`\n${text}\n`);
      channel?.show(true);
      void vscode.window.showInformationMessage(
        sharedViewState.healthOverall === 'ok'
          ? 'Karkain: health check passed. See the Karkain output channel for the full report.'
          : `Karkain: health check finished with "${sharedViewState.healthOverall}". See the Karkain output channel for the full report.`,
      );
    }),
    vscode.commands.registerCommand('karkain.copyHealthReport', async () => {
      const text = await gatherHealthReport();
      await vscode.env.clipboard.writeText(text);
      void vscode.window.setStatusBarMessage('Karkain: diagnostic report copied to clipboard', 4000);
    }),
    vscode.commands.registerCommand('karkain.exportHealthReport', async () => {
      const text = await gatherHealthReport();
      const target = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(path.join(os.tmpdir(), 'karkain-diagnostic-report.md')),
        filters: { Markdown: ['md'], Text: ['txt'] },
      });
      if (!target) {
        return;
      }
      try {
        await vscode.workspace.fs.writeFile(target, Buffer.from(text, 'utf8'));
        void vscode.window.setStatusBarMessage(
          `Karkain: diagnostic report written to ${target.fsPath}`,
          5000,
        );
      } catch (e) {
        void vscode.window.showErrorMessage(`Karkain: could not write the report: ${(e as Error).message}`);
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
  return { setToolchainService, reportServerCapabilities };
}

export function deactivate(): Promise<void> | undefined {
  const c = client;
  client = null;
  sharedViewState.lspRunning = false;
  if (!c) {
    return undefined;
  }
  // deactivate() must never reject: VS Code logs a rejected deactivate and
  // then tears the pipe down on its own terms. A server that cannot stop
  // cleanly (e.g. one that ignores `exit` after a failed shutdown) must not
  // take the extension host's teardown down with it — log and let the host
  // dispose the transport.
  return Promise.resolve(c.stop()).then(
    () => undefined,
    (err: unknown) => {
      log(`language client did not stop cleanly: ${err instanceof Error ? err.message : String(err)}`);
    },
  );
}
