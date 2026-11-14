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
