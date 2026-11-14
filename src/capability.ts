// Compiler capability discovery, built on `karkain ide info` (schemaVersion 1,
// verified against Karkain v1.2.0 on Windows AMD64).
//
// Design rules:
//   * External data is validated before it is used. Anything missing or of the
//     wrong type is reported as unverifiable, never silently defaulted.
//   * An unknown schemaVersion is never accepted as compatible; the caller
//     falls back to the hardcoded, verified argv vectors.
//   * This module performs no I/O — the caller supplies the raw JSON text.
//     It is vscode-free so it stays unit-testable.

export type IdeInfoResult =
  | { kind: 'ok'; info: KarkainCapabilityInfo }
  /** Command exists but the payload is unusable (bad JSON, not an object). */
  | { kind: 'invalid'; detail: string }
  /** Machine answered, but not with a contract we can accept. */
  | { kind: 'unsupported'; detail: string };

/** The verified v1.2.0 contract surface, decomposed for consumers. */
export interface KarkainCapabilityInfo {
  schemaVersion: number;
  language?: { name?: string; id?: string; extensions?: string[]; defaultFilename?: string };
  /** How the toolchain detects a project: manifest + entry marker. */
  projectDetection?: { manifest?: string; marker?: string };
  /** argv vectors (without the binary name) exactly as reported. */
  argv: Record<string, string[]>;
  diagnostics?: { format?: string; schema?: string; code?: string };
  /** exit-code table exactly as reported (success/failure/usage/compile/test/package/env). */
  exitCodes?: Record<string, number>;
  /** True when the `lsp` argv vector was advertised. */
  lspAdvertised: boolean;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) {
    return undefined;
  }
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== 'string') {
      return undefined;
    }
    out.push(item);
  }
  return out;
}

function asExitCodes(v: unknown): Record<string, number> | undefined {
  if (!isPlainObject(v)) {
    return undefined;
  }
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(v)) {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      return undefined;
    }
    out[key] = value;
  }
  return out;
}

/**
 * Parses and validates the payload of `karkain ide info`.
 *
 * Never throws. `kind: 'ok'` only when `schemaVersion === 1` and the payload
 * is a JSON object; every unread piece is reported through absence rather
 * than filled with invented defaults, except `argv`, which is always present
 * on the verified schema (possibly empty when every vector is unusable).
 */
export function parseIdeInfo(raw: string): IdeInfoResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { kind: 'invalid', detail: `not JSON: ${(e as Error).message}` };
  }
  if (!isPlainObject(parsed)) {
    return { kind: 'invalid', detail: 'ide info payload is not a JSON object' };
  }
  const schema = parsed['schemaVersion'];
  if (typeof schema !== 'number' || !Number.isInteger(schema)) {
    return { kind: 'unsupported', detail: 'ide info missing integer schemaVersion' };
  }
  if (schema !== 1) {
    return { kind: 'unsupported', detail: `ide info schemaVersion ${schema} is not supported (expected 1)` };
  }

  const info: KarkainCapabilityInfo = {
    schemaVersion: schema,
    argv: {},
    lspAdvertised: false,
  };

  // language
  if (isPlainObject(parsed['language'])) {
    const lang = parsed['language'];
    info.language = {
      name: typeof lang['name'] === 'string' ? lang['name'] : undefined,
      id: typeof lang['id'] === 'string' ? lang['id'] : undefined,
      extensions: asStringArray(lang['extensions']),
      defaultFilename: typeof lang['defaultFilename'] === 'string' ? lang['defaultFilename'] : undefined,
    };
  }

  // projectDetection
  if (isPlainObject(parsed['projectDetection'])) {
    const pd = parsed['projectDetection'];
    info.projectDetection = {
      manifest: typeof pd['manifest'] === 'string' ? pd['manifest'] : undefined,
      marker: typeof pd['marker'] === 'string' ? pd['marker'] : undefined,
    };
  }

  // toolchain: every entry must be a string array or it is dropped entirely.
  const tc = parsed['toolchain'];
  if (isPlainObject(tc)) {
    for (const [key, value] of Object.entries(tc)) {
      if (key === 'binary') {
        continue;
      }
      const vec = asStringArray(value);
      if (vec) {
        info.argv[key] = vec;
      }
    }
    info.lspAdvertised = Array.isArray(tc['lsp']);
  }

  // diagnostics
  if (isPlainObject(parsed['diagnostics'])) {
    const d = parsed['diagnostics'];
    info.diagnostics = {
      format: typeof d['format'] === 'string' ? d['format'] : undefined,
      schema: typeof d['schema'] === 'string' ? d['schema'] : undefined,
      code: typeof d['code'] === 'string' ? d['code'] : undefined,
    };
  }

  // exitCodes
  const ec = asExitCodes(parsed['exitCodes']);
  if (ec) {
    info.exitCodes = ec;
  }

  return { kind: 'ok', info };
}

/** One divergence between the verified fallback argv and the compiler's contract. */
export interface CapabilityDivergence {
  what: string;
  expected: string;
  actual: string;
}

/** Our verified argv vectors, used when the contract is absent or incomplete. */
export const FALLBACK_ARGV: Record<string, string[]> = {
  check: ['check', '<file>'],
  checkJSON: ['check', '--format=json', '<file>'],
  build: ['build', '<file>'],
  run: ['run', '<file>'],
  test: ['test', '<path>'],
  format: ['fmt', '<file>'],
  formatCheck: ['fmt', '--check', '<file>'],
  lint: ['lint', '<file>'],
  lsp: ['lsp'],
};

const EXPECTED_EXIT_CODES: Record<string, number> = {
  success: 0,
  failure: 1,
  usage: 2,
  compile: 3,
  test: 4,
  package: 5,
  env: 6,
};

/**
 * Compares the compiler's advertised contract against the extension's
 * verified fallback vectors. Divergences are reported, never silently
 * preferred either way — the report feeds the health check, where a human
 * decides which side to trust.
 */
export function compareIdeInfoWithFallback(info: KarkainCapabilityInfo): CapabilityDivergence[] {
  const out: CapabilityDivergence[] = [];
  for (const [key, fallback] of Object.entries(FALLBACK_ARGV)) {
    const actual = info.argv[key];
    if (!actual) {
      out.push({ what: `argv.${key}`, expected: JSON.stringify(fallback), actual: '(absent)' });
      continue;
    }
    // The contract's vectors carry the binary name as their first element
    // (e.g. ["karkain","check","<file>"]); compare the suffix so a different
    // binary name does not produce a false divergence.
    const stripped =
      actual.length >= fallback.length ? actual.slice(actual.length - fallback.length) : actual;
    if (stripped.join(' ') !== fallback.join(' ')) {
      out.push({ what: `argv.${key}`, expected: JSON.stringify(fallback), actual: JSON.stringify(actual) });
    }
  }
  for (const [key, expected] of Object.entries(EXPECTED_EXIT_CODES)) {
    const actual = info.exitCodes?.[key];
    if (actual === undefined) {
      out.push({ what: `exitCodes.${key}`, expected: String(expected), actual: '(absent)' });
      continue;
    }
    if (actual !== expected) {
      out.push({ what: `exitCodes.${key}`, expected: String(expected), actual: String(actual) });
    }
  }
  const schema = info.diagnostics?.schema;
  if (schema !== undefined && schema !== 'karkain-diagnostics-v1') {
    out.push({ what: 'diagnostics.schema', expected: 'karkain-diagnostics-v1', actual: schema });
  }
  return out;
}
