// VS Code settings access for the Karkain extension. Each setting mirrors a
// real toolchain integration surface (compiler path, debugger path,
// format-on-save, build target); no speculative settings are defined.
import * as vscode from 'vscode';

export const DEFAULT_COMPILER_PATH = 'karkain';
export const DEFAULT_DEBUGGER_PATH = 'gdb';
export const DEFAULT_TARGET = '';

export function getCompilerPath(): string {
  const v = vscode.workspace.getConfiguration('karkain').get<string>('compilerPath');
  const s = (v ?? '').trim();
  return s.length > 0 ? s : DEFAULT_COMPILER_PATH;
}

export function getDebuggerPath(): string {
  const v = vscode.workspace.getConfiguration('karkain').get<string>('debuggerPath');
  const s = (v ?? '').trim();
  return s.length > 0 ? s : DEFAULT_DEBUGGER_PATH;
}

export function getFormatOnSave(): boolean {
  return vscode.workspace.getConfiguration('karkain').get<boolean>('formatOnSave') === true;
}

// Target triple passed as `--target` to build/run. Empty means the host
// default (verified: no flag is sent, toolchain behavior unchanged).
export function getTarget(): string {
  const v = vscode.workspace.getConfiguration('karkain').get<string>('target');
  return (v ?? '').trim();
}
