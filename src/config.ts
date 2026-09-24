// VS Code settings access for the Karkain extension. The three settings below
// mirror the real toolchain integration surface (compiler path, debugger path,
// format-on-save); no speculative settings are defined in Phase 1.
import * as vscode from 'vscode';

export const DEFAULT_COMPILER_PATH = 'karkain';
export const DEFAULT_DEBUGGER_PATH = 'gdb';

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
