import * as assert from 'assert';
import { findMissingCapabilities, isSupportedServer, lspSymbolKindName, parseServerVersion } from '../../lsp';

describe('lsp contract', () => {
  describe('findMissingCapabilities', () => {
    const full = {
      completionProvider: {},
      hoverProvider: true,
      definitionProvider: true,
      documentSymbolProvider: true,
      semanticTokensProvider: { full: true },
      formattingProvider: true,
      textDocumentSync: {},
    };

    it('accepts the verified 1.1.0 surface', () => {
      assert.deepStrictEqual(findMissingCapabilities(full), []);
    });

    it('names each missing capability', () => {
      assert.deepStrictEqual(findMissingCapabilities({}), [
        'completion',
        'hover',
        'definition',
        'documentSymbol',
        'semanticTokens',
        'formatting',
      ]);
      assert.deepStrictEqual(findMissingCapabilities({ hoverProvider: false }), [
        'completion',
        'hover',
        'definition',
        'documentSymbol',
        'semanticTokens',
        'formatting',
      ]);
      assert.deepStrictEqual(findMissingCapabilities(undefined), [
        'completion',
        'hover',
        'definition',
        'documentSymbol',
        'semanticTokens',
        'formatting',
      ]);
    });
  });

  describe('server version gate', () => {
    it('parses semver prefixes', () => {
      assert.strictEqual(parseServerVersion({ name: 'karkain-lsp', version: '1.1.0' }), '1.1.0');
      assert.strictEqual(parseServerVersion({ version: '1.1.0 (Stable Build)' }), '1.1.0');
      assert.strictEqual(parseServerVersion(undefined), null);
      assert.strictEqual(parseServerVersion({}), null);
      assert.strictEqual(parseServerVersion({ version: 'nightly' }), null);
    });

    it('gates intelligence on 1.1.0', () => {
      assert.strictEqual(isSupportedServer({ version: '1.1.0' }), true);
      assert.strictEqual(isSupportedServer({ version: '1.2.0' }), true);
      assert.strictEqual(isSupportedServer({ version: '1.0.0' }), false);
      assert.strictEqual(isSupportedServer(undefined), false);
    });
  });

  describe('lspSymbolKindName', () => {
    it('names the outline kinds the server emits', () => {
      assert.strictEqual(lspSymbolKindName(12), 'Function');
      assert.strictEqual(lspSymbolKindName(23), 'Struct');
      assert.strictEqual(lspSymbolKindName(10), 'Enum');
      assert.strictEqual(lspSymbolKindName(22), 'EnumMember');
      assert.strictEqual(lspSymbolKindName(8), 'Field');
      assert.strictEqual(lspSymbolKindName(13), 'Variable');
    });

    it('labels unknown kinds instead of throwing', () => {
      assert.strictEqual(lspSymbolKindName(99), 'Unknown(99)');
    });
  });
});
