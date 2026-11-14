// VS Code settings access for the Karkain extension. Each setting mirrors a
// real toolchain integration surface (compiler path, debugger path,
// format-on-save, build target); no speculative settings are defined.
//
// Multi-root: every getter takes an optional `scope` (a Uri, TextDocument or
// WorkspaceFolder). Passing the owning resource makes VS Code resolve the
// folder-scoped value for THAT folder. Omitting it is not equivalent — with no
// scope, `getConfiguration` returns the first folder's value for every file, so
// in a multi-root window root B silently inherits root A's toolchain.
//
// `undefined` scope therefore means "no folder context", which is the correct
// value for a genuinely workspace-less document, and the fallback for the
// single-root case where VS Code resolves it identically either way.
import * as vscode from 'vscode';

export const DEFAULT_COMPILER_PATH = 'karkain';
export const DEFAULT_DEBUGGER_PATH = 'gdb';
export const DEFAULT_TARGET = '';

export const DEFAULT_ENGINE = '';
export const DEFAULT_RUN_ARGS = '';
export const DEFAULT_BUILD_ARGS = '';
export const DEFAULT_WORKING_DIRECTORY = '';
export const DEFAULT_TRACE_SERVER = 'off';

/** Anything VS Code accepts as a configuration resource. */
export type ConfigScope = vscode.Uri | vscode.TextDocument | vscode.WorkspaceFolder | undefined;

function read<T>(key: string, scope: ConfigScope, fallback: T): T {
  const v = vscode.workspace.getConfiguration('karkain', scope).get<T>(key);
  return v === undefined || v === null ? fallback : v;
}

export function getCompilerPath(scope?: ConfigScope): string {
  return (read<string>('compilerPath', scope, DEFAULT_COMPILER_PATH) ?? '').trim() || DEFAULT_COMPILER_PATH;
}

export function getDebuggerPath(scope?: ConfigScope): string {
  return (read<string>('debuggerPath', scope, DEFAULT_DEBUGGER_PATH) ?? '').trim() || DEFAULT_DEBUGGER_PATH;
}

export function getFormatOnSave(scope?: ConfigScope): boolean {
  return read<boolean>('formatOnSave', scope, false) === true;
}

// Target triple passed as `--target` to build/run. Empty means the host
// default (verified: no flag is sent, toolchain behavior unchanged).
export function getTarget(scope?: ConfigScope): string {
  return (read<string>('target', scope, DEFAULT_TARGET) ?? '').trim();
}

// Engine passed to spawned compiler processes via KARKAIN_ENGINE. Empty means
// the toolchain default (kcc on 1.2.0); `go` selects the in-tree Go front end.
// Only the two verified values are honoured; anything else is ignored (the
// CLI would refuse it anyway).
export type EngineKind = '' | 'kcc' | 'go';

export function getEngine(scope?: ConfigScope): EngineKind {
  const v = (read<string>('engine', scope, DEFAULT_ENGINE) ?? '').trim().toLowerCase();
  if (v === 'kcc' || v === 'go') {
    return v;
  }
  return '';
}

// Extra CLI flags appended to `karkain run` / `karkain build`. These go to the
// COMPILER CLI, not the compiled program (the v1.2.0 CLI does not forward
// program arguments — verified in source). Flag splitting lives in ./flags.
export function getRunArgs(scope?: ConfigScope): string {
  return (read<string>('runArgs', scope, DEFAULT_RUN_ARGS) ?? '').trim();
}

export function getBuildArgs(scope?: ConfigScope): string {
  return (read<string>('buildArgs', scope, DEFAULT_BUILD_ARGS) ?? '').trim();
}

// Extra environment variables merged into compiler processes and terminals.
// Values must be strings; non-string values (and the literal string
// "undefined") are dropped so a malformed settings.json cannot smuggle junk.
export function getEnv(scope?: ConfigScope): NodeJS.ProcessEnv {
  const raw = read<Record<string, unknown>>('env', scope, {});
  const out: NodeJS.ProcessEnv = {};
  if (typeof raw !== 'object' || raw === null) {
    return out;
  }
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string' && value.length > 0 && value !== 'undefined') {
      out[key] = value;
    }
  }
  return out;
}

// Override for the working directory used by run/build. Empty means the
// automatic resolution (nearest karkain.toml root → owning workspace folder).
export function getWorkingDirectory(scope?: ConfigScope): string {
  return (read<string>('workingDirectory', scope, DEFAULT_WORKING_DIRECTORY) ?? '').trim();
}

// Language-server trace level; the client forwards to VS Code's LSP tracing.
export type TraceServer = 'off' | 'messages' | 'verbose';

export function getTraceServer(scope?: ConfigScope): TraceServer {
  const v = (read<string>('trace.server', scope, DEFAULT_TRACE_SERVER) ?? '').trim().toLowerCase();
  if (v === 'messages' || v === 'verbose') {
    return v;
  }
  return 'off';
}

// Optional local paths for stdlib/examples navigation. Evaluated only when set.
export function getStdlibPath(scope?: ConfigScope): string {
  return (read<string>('stdlibPath', scope, '') ?? '').trim();
}

export function getExamplesPath(scope?: ConfigScope): string {
  return (read<string>('examplesPath', scope, '') ?? '').trim();
}
