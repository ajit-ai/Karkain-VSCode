// Pure VS Code task shapes for Karkain file commands. Kept vscode-free so the
// argv construction stays unit-testable; extension.ts maps these onto
// vscode.Task objects. File commands always need a file (verified: bare
// `karkain run/check/build` exit 2); `clean` is project-scoped via cwd.
import { applyTarget } from './targets';

export type KarkainTaskKind = 'build' | 'check' | 'run' | 'clean';

export interface KarkainTaskSpec {
  kind: KarkainTaskKind;
  /** Absolute .kark file for file-scoped kinds; omitted for clean. */
  file?: string;
  /** Working directory (project root when detected). */
  cwd?: string;
  /**
   * Configured `karkain.target` triple. Applied to build/run exactly as the
   * Build File/Run File commands apply it, so the target cannot silently
   * disappear depending on how the user invokes it. Empty = host default.
   */
  target?: string;
}

export function isFileScoped(kind: KarkainTaskKind): boolean {
  return kind === 'build' || kind === 'check' || kind === 'run';
}

// Targets apply to the code-generating commands only; `check` and `clean` stay
// untouched, matching the command handlers.
function isTargetScoped(kind: KarkainTaskKind): boolean {
  return kind === 'build' || kind === 'run';
}

// Exact argv vectors, mirroring src/toolchain.ts builders.
export function taskArgs(spec: KarkainTaskSpec): string[] {
  if (spec.kind === 'clean') {
    return ['clean'];
  }
  if (!spec.file) {
    throw new Error(`karkain ${spec.kind} task requires a file`);
  }
  const base = [spec.kind, spec.file];
  return isTargetScoped(spec.kind) ? applyTarget(base, spec.target ?? '') : base;
}

export function taskLabel(spec: KarkainTaskSpec): string {
  if (spec.kind === 'clean') {
    return 'karkain: clean';
  }
  const base = spec.file ? spec.file.split(/[\\/]/).pop() : spec.kind;
  return `karkain: ${spec.kind} ${base}`;
}

// Only build joins the default build group; the rest stay explicit.
export function taskGroup(kind: KarkainTaskKind): 'build' | undefined {
  return kind === 'build' ? 'build' : undefined;
}
