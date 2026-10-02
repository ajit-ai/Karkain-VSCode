import * as path from 'path';

// Structured diagnostics parsing for `karkain check --format=json`.
// Schema v1 (per the Karkain 1.1.0 toolchain contract,
// pkg/diagnostics/diagnostic.go):
//   [{ "file": string, "line": number, "column": number,
//      "endColumn": number?, "severity": string|number, "code": string,
//      "message": string }]
// Line/column/endColumn are 1-based. `endColumn` is "the column just past the
// offending token"; absent (or 0) means the span is unknown. The schema has no
// end-line field, so a span never crosses a line. This module is vscode-free so
// it stays unit-testable; the extension maps these items onto
// vscode.Diagnostic objects.

export type KarkainSeverity = 'error' | 'warning' | 'info' | 'hint';

export interface KarkainDiagnostic {
  file: string;
  line: number;
  column: number;
  /**
   * 1-based column just past the offending token, or null when the toolchain
   * reported no usable end position (`endColumn` absent, zero, non-numeric or
   * not after the start column).
   */
  endColumn: number | null;
  severity: KarkainSeverity;
  code: string;
  message: string;
}

function normalizeSeverity(value: unknown): KarkainSeverity {
  if (typeof value === 'number') {
    if (value === 2) {
      return 'warning';
    }
    if (value === 3) {
      return 'info';
    }
    if (value === 4) {
      return 'hint';
    }
    return 'error';
  }
  if (typeof value === 'string') {
    const s = value.toLowerCase();
    if (s === 'warning' || s === 'warn') {
      return 'warning';
    }
    if (s === 'info' || s === 'information') {
      return 'info';
    }
    if (s === 'hint') {
      return 'hint';
    }
    if (s === 'error') {
      return 'error';
    }
  }
  // Unknown severity is surfaced as an error: never silently downgrade a
  // diagnostic the toolchain considered worth reporting.
  return 'error';
}

function toOneBasedInt(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(1, Math.floor(value));
  }
  return 1;
}

// `endColumn` is optional in schema v1. Absent, zero, non-numeric or
// non-advancing values carry no usable span and become null, so a diagnostic
// stays a single-position marker instead of an inverted range.
function toEndColumn(value: unknown, column: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  const end = Math.floor(value);
  return end > column ? end : null;
}

// Returns the diagnostic list, or null when `output` is not structured
// schema-v1 JSON (caller falls back to raw compiler output). An empty array
// means valid structured output with zero diagnostics (check passed).
export function tryParseCheckJson(output: string): KarkainDiagnostic[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) {
    return null;
  }
  const out: KarkainDiagnostic[] = [];
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }
    const rec = item as Record<string, unknown>;
    if (typeof rec['file'] !== 'string' || typeof rec['message'] !== 'string') {
      continue;
    }
    const message = (rec['message'] as string).trim();
    if (message.length === 0) {
      continue;
    }
    const line = toOneBasedInt(rec['line']);
    const column = toOneBasedInt(rec['column']);
    out.push({
      file: rec['file'] as string,
      line,
      column,
      endColumn: toEndColumn(rec['endColumn'], column),
      severity: normalizeSeverity(rec['severity']),
      code: typeof rec['code'] === 'string' ? (rec['code'] as string) : '',
      message,
    });
  }
  return out;
}

// A zero-based range in the shape vscode.Range expects. The schema has no
// end-line, so both ends always share the diagnostic's line.
export interface DiagnosticRange {
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
}

// Converts a parsed diagnostic into a zero-based range. Single-position
// diagnostics (no usable endColumn) are preserved as-is rather than widened.
export function toDiagnosticRange(d: KarkainDiagnostic): DiagnosticRange {
  const startLine = Math.max(0, d.line - 1);
  const startCharacter = Math.max(0, d.column - 1);
  const endCharacter = d.endColumn === null ? startCharacter : Math.max(startCharacter, d.endColumn - 1);
  return { startLine, startCharacter, endLine: startLine, endCharacter };
}

// Resolves a diagnostic's `file` field to an absolute path.
//
// `karkain check` reports per-file spans, so a single invocation can describe
// several files; attaching all of them to the active document misattributes
// errors. Relative paths are resolved against the effective cwd (the
// karkain.toml project root when detected, else the workspace folder), which is
// exactly where the check ran. Absolute paths are normalized and preserved.
// Blank or unusable values fall back to the checked document.
export function resolveDiagnosticFile(
  file: string,
  cwd: string | undefined,
  checkedFile: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const trimmed = file.trim();
  if (trimmed.length === 0) {
    return checkedFile;
  }
  const isWin = platform === 'win32';
  const impl = isWin ? path.win32 : path.posix;
  // Karkain emits forward-slash paths on every platform; accept both.
  const unified = trimmed.replace(/\\/g, '/');
  const absolute = isWin ? /^[A-Za-z]:\//.test(unified) || unified.startsWith('//') : unified.startsWith('/');
  if (absolute) {
    return impl.normalize(unified);
  }
  if (cwd) {
    return impl.normalize(impl.resolve(cwd.replace(/\\/g, isWin ? '\\' : '/'), unified));
  }
  return impl.normalize(impl.resolve(impl.dirname(checkedFile.replace(/\\/g, isWin ? '\\' : '/')), unified));
}
