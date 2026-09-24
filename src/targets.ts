// Pure target-matrix helpers for `karkain target` (verified output shapes in
// docs/KARKAIN-INSPECTION.md §10). Only names, maturities and descriptions the
// CLI itself reports are exposed; nothing is invented. Vscode-free.

export interface TargetEntry {
  name: string;
  description: string;
}

export interface ComputeTarget {
  name: string;
  /** Maturity vocabulary comes from the CLI verbatim (e.g. implemented). */
  maturity: string;
  description: string;
}

export interface TargetMatrix {
  host: string | null;
  defaultTarget: string | null;
  targets: TargetEntry[];
  compute: ComputeTarget[];
}

export function emptyMatrix(): TargetMatrix {
  return { host: null, defaultTarget: null, targets: [], compute: [] };
}

const HOST_LINE = /^Host:\s+(\S+)/;
const DEFAULT_LINE = /^Default:\s+(\S+)/;
const SECTION_TARGETS = 'Supported targets:';
const SECTION_COMPUTE = 'Compute targets';

export function parseTargetOutput(output: string): TargetMatrix {
  const matrix = emptyMatrix();
  let section: 'targets' | 'compute' | null = null;
  for (const raw of output.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line.includes(SECTION_TARGETS)) {
      section = 'targets';
      continue;
    }
    if (line.includes(SECTION_COMPUTE)) {
      section = 'compute';
      continue;
    }
    const host = HOST_LINE.exec(line);
    if (host) {
      matrix.host = host[1];
      continue;
    }
    const def = DEFAULT_LINE.exec(line);
    if (def) {
      matrix.defaultTarget = def[1];
      continue;
    }
    if (section === 'targets') {
      const m = /^\s{2,}(\S+)(?:\s+(.*))?$/.exec(line);
      if (m) {
        matrix.targets.push({ name: m[1], description: (m[2] ?? '').trim() });
      }
    } else if (section === 'compute') {
      const m = /^\s{2,}(\S+)\s+(\S+)(?:\s+(.*))?$/.exec(line);
      if (m) {
        matrix.compute.push({ name: m[1], maturity: m[2], description: (m[3] ?? '').trim() });
      }
    }
  }
  return matrix;
}

// Parses the `karkain target <name>` detail view (Family/Maturity/… lines).
// Returns null when the output is not a detail view.
export function parseComputeTargetDetail(output: string): Record<string, string> | null {
  const detail: Record<string, string> = {};
  for (const raw of output.split('\n')) {
    const m = /^([A-Za-z][A-Za-z ]*):\s+(.*)$/.exec(raw.replace(/\r$/, ''));
    if (m) {
      detail[m[1].trim()] = m[2].trim();
    }
  }
  return Object.keys(detail).length > 0 ? detail : null;
}

// Inserts `--target <target>` after the command verb: `build --target X file`.
// An empty target leaves argv untouched (host default behavior).
export function applyTarget(args: string[], target: string): string[] {
  const t = target.trim();
  if (t.length === 0 || args.length === 0) {
    return [...args];
  }
  return [args[0], '--target', t, ...args.slice(1)];
}
