// Pure Karkain toolchain helpers: no vscode dependency so they stay unit-testable.
// Every command shape below mirrors the real Karkain 1.1.0 CLI
// (cmd/karkain/main.go on main): `karkain [command] [options] <file.kark>`.

export interface ToolchainVersion {
  version: string;
  os: string;
  arch: string;
  raw: string;
}

// Parses `Karkain Compiler v1.1.0 (windows/amd64, Stable Build)`.
// Also accepts the older `v1.0.0 (windows/amd64, LSP Engine & IDE Tooling)` shape.
// Returns null when the output is not a recognizable version banner.
export function parseVersionString(output: string): ToolchainVersion | null {
  const m = /Karkain Compiler v(\d+\.\d+\.\d+)\s*\(\s*([^/\s,]+)\s*\/\s*([^,)\s]+)/.exec(output);
  if (!m) {
    return null;
  }
  return { version: m[1], os: m[2], arch: m[3], raw: output.trim() };
}

// Numeric triple comparison: -1 when a < b, 0 when equal, 1 when a > b.
// Non-numeric segments compare as 0 and never throw.
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = a.split('.').map((s) => parseInt(s, 10));
  const pb = b.split('.').map((s) => parseInt(s, 10));
  for (let i = 0; i < 3; i++) {
    const x = Number.isFinite(pa[i]) ? pa[i] : 0;
    const y = Number.isFinite(pb[i]) ? pb[i] : 0;
    if (x < y) {
      return -1;
    }
    if (x > y) {
      return 1;
    }
  }
  return 0;
}

// Structured `check --format=json` diagnostics require Karkain >= 1.1.0.
export const MIN_STRUCTURED_DIAGNOSTICS_VERSION = '1.1.0';

export function supportsStructuredDiagnostics(version: string): boolean {
  return compareVersions(version, MIN_STRUCTURED_DIAGNOSTICS_VERSION) >= 0;
}

// File association check. Extension match is case-insensitive so Windows
// users opening `MAIN.KARK` still activate the language.
export function isKarkFile(fsPath: string): boolean {
  return fsPath.toLowerCase().endsWith('.kark');
}

// Executable candidates per platform. Callers resolve these via PATH lookup
// or an explicit `karkain.compilerPath` setting; no hard-coded install dirs.
export function candidateExecutableNames(platform: NodeJS.Platform): string[] {
  if (platform === 'win32') {
    return ['karkain.exe', 'karkain'];
  }
  return ['karkain'];
}

// Argument vectors only (never shell strings). Callers must spawn with an
// argv API such as execFile/spawn and must not concatenate these into a shell.
export function checkArgs(file: string, jsonFormat: boolean): string[] {
  return jsonFormat ? ['check', '--format=json', file] : ['check', file];
}

export function buildArgs(file: string): string[] {
  return ['build', file];
}

export function runArgs(file: string): string[] {
  return ['run', file];
}

export function fmtArgs(file: string): string[] {
  return ['fmt', file];
}

export function versionArgs(): string[] {
  return ['--version'];
}

export function targetArgs(): string[] {
  return ['target'];
}

export function configArgs(): string[] {
  return ['config'];
}
