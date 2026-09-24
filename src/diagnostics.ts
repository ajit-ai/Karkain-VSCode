// Structured diagnostics parsing for `karkain check --format=json`.
// Schema v1 (per the Karkain 1.1.0 toolchain contract):
//   [{ "file": string, "line": number, "column": number,
//      "severity": string|number, "code": string, "message": string }]
// Line/column are 1-based. This module is vscode-free so it stays unit-testable;
// the extension maps these items onto vscode.Diagnostic objects.

export type KarkainSeverity = 'error' | 'warning' | 'info' | 'hint';

export interface KarkainDiagnostic {
  file: string;
  line: number;
  column: number;
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
    out.push({
      file: rec['file'] as string,
      line: toOneBasedInt(rec['line']),
      column: toOneBasedInt(rec['column']),
      severity: normalizeSeverity(rec['severity']),
      code: typeof rec['code'] === 'string' ? (rec['code'] as string) : '',
      message,
    });
  }
  return out;
}
