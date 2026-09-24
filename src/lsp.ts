// Pure LSP contract helpers for the Karkain language server (`karkain lsp`).
// Shapes mirror pkg/lsp/protocol.go; the verified capability matrix lives in
// docs/KARKAIN-INSPECTION.md §4. No vscode dependency: unit-testable.
import { compareVersions } from './toolchain';

export const KARKAIN_LANGUAGE_SERVER_ID = 'karkain-lsp';
export const MIN_LANGUAGE_SERVER_VERSION = '1.1.0';

export interface LspServerInfo {
  name?: string;
  version?: string;
}

export interface LspServerCapabilities {
  completionProvider?: unknown;
  hoverProvider?: unknown;
  definitionProvider?: unknown;
  documentSymbolProvider?: unknown;
  formattingProvider?: unknown;
  semanticTokensProvider?: unknown;
  textDocumentSync?: unknown;
}

export interface LspInitializeResult {
  capabilities?: LspServerCapabilities;
  serverInfo?: LspServerInfo;
}

// Capability keys the extension relies on, in extension-facing terms.
const REQUIRED: [keyof LspServerCapabilities, string][] = [
  ['completionProvider', 'completion'],
  ['hoverProvider', 'hover'],
  ['definitionProvider', 'definition'],
  ['documentSymbolProvider', 'documentSymbol'],
  ['semanticTokensProvider', 'semanticTokens'],
  ['formattingProvider', 'formatting'],
];

// Names capabilities the server did NOT advertise. An empty array means the
// verified 1.1.0 surface is fully present.
export function findMissingCapabilities(caps: LspServerCapabilities | undefined | null): string[] {
  if (!caps) {
    return REQUIRED.map(([, name]) => name);
  }
  return REQUIRED.filter(([key]) => caps[key] === undefined || caps[key] === null || caps[key] === false).map(
    ([, name]) => name,
  );
}

export function parseServerVersion(info: LspServerInfo | undefined | null): string | null {
  if (!info || typeof info.version !== 'string') {
    return null;
  }
  const m = /^(\d+\.\d+\.\d+)/.exec(info.version.trim());
  return m ? m[1] : null;
}

export function isSupportedServer(info: LspServerInfo | undefined | null): boolean {
  const v = parseServerVersion(info);
  return v !== null && compareVersions(v, MIN_LANGUAGE_SERVER_VERSION) >= 0;
}

// LSP 3.17 SymbolKind names, mirroring pkg/lsp/protocol.go SymbolKind* consts.
const SYMBOL_KINDS: Record<number, string> = {
  1: 'File',
  2: 'Module',
  3: 'Namespace',
  4: 'Package',
  5: 'Class',
  6: 'Method',
  7: 'Property',
  8: 'Field',
  9: 'Constructor',
  10: 'Enum',
  11: 'Interface',
  12: 'Function',
  13: 'Variable',
  14: 'Constant',
  15: 'String',
  16: 'Number',
  17: 'Boolean',
  18: 'Array',
  19: 'Object',
  20: 'Key',
  21: 'Null',
  22: 'EnumMember',
  23: 'Struct',
  24: 'Event',
  25: 'Operator',
  26: 'TypeParameter',
};

export function lspSymbolKindName(kind: number): string {
  return SYMBOL_KINDS[kind] ?? `Unknown(${kind})`;
}
