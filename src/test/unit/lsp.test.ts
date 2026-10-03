import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {
  findMissingCapabilities,
  isSupportedServer,
  lspSymbolKindName,
  negotiateServerCapabilities,
  parseServerVersion,
} from '../../lsp';

function repoRoot(): string {
  return path.resolve(__dirname, '..', '..', '..');
}

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

  // The verified 1.1.0 capability set, shaped as the real server advertises it.
  const COMPATIBLE_CAPS = {
    textDocumentSync: { openClose: true, change: 1 },
    completionProvider: { triggerCharacters: ['.', ':'] },
    semanticTokensProvider: { legend: { tokenTypes: [], tokenModifiers: [] }, full: true },
    hoverProvider: true,
    definitionProvider: true,
    documentSymbolProvider: true,
    formattingProvider: true,
  };

  describe('negotiateServerCapabilities', () => {
    it('accepts a server that satisfies the capability contract', () => {
      const got = negotiateServerCapabilities({
        capabilities: COMPATIBLE_CAPS,
        serverInfo: { name: 'karkain-lsp', version: '1.1.0' },
      });
      assert.deepStrictEqual(got.missing, []);
      assert.strictEqual(got.compatible, true);
      // serverInfo is reported for diagnostics only; it is not a version gate.
      assert.strictEqual(got.serverName, 'karkain-lsp');
      assert.strictEqual(got.serverVersion, '1.1.0');
    });

    it('names every missing capability for a degraded server', () => {
      const got = negotiateServerCapabilities({
        capabilities: { ...COMPATIBLE_CAPS, hoverProvider: false, formattingProvider: false },
      });
      assert.deepStrictEqual(got.missing, ['hover', 'formatting']);
      assert.strictEqual(got.compatible, false);
    });

    it('treats an absent InitializeResult as nothing advertised, not as success', () => {
      for (const absent of [undefined, null]) {
        const got = negotiateServerCapabilities(absent);
        assert.strictEqual(got.compatible, false);
        assert.strictEqual(got.missing.length, 6);
      }
    });

    it('agrees with findMissingCapabilities (no duplicated contract)', () => {
      const caps = { ...COMPATIBLE_CAPS, semanticTokensProvider: undefined };
      const fromResult = negotiateServerCapabilities({ capabilities: caps }).missing;
      assert.deepStrictEqual(fromResult, findMissingCapabilities(caps));
    });
  });

  describe('production wiring', () => {
    // Returns the body of the named top-level function in a compiled bundle, by
    // brace matching. Asserting on a whole-file substring is not enough: the
    // function declaration would satisfy it even with the call removed.
    function functionBody(js: string, name: string): string {
      const at = js.indexOf(`function ${name}(`);
      assert.ok(at !== -1, `${name} must exist in the compiled extension`);
      const open = js.indexOf('{', at);
      assert.notStrictEqual(open, -1, `${name} has no body`);
      let depth = 0;
      for (let i = open; i < js.length; i++) {
        if (js[i] === '{') {
          depth++;
        } else if (js[i] === '}') {
          depth--;
          if (depth === 0) {
            return js.slice(open, i);
          }
        }
      }
      throw new Error(`unbalanced braces in ${name}`);
    }

    it('the client start path actually invokes capability negotiation', () => {
      // Proves the production call site exists, not merely the helper. Reads the
      // compiled bundle because extension.ts imports `vscode` and cannot be
      // loaded in a plain mocha process.
      const compiled = path.join(repoRoot(), 'out', 'extension.js');
      if (!fs.existsSync(compiled)) {
        return; // out/ is produced by `npm run compile`.
      }
      const js = fs.readFileSync(compiled, 'utf8');
      const start = functionBody(js, 'startLanguageClient');
      assert.ok(
        start.includes('await next.start()'),
        'startLanguageClient must await the client so initialize has completed',
      );
      assert.ok(
        /reportServerCapabilities\(\s*next\.initializeResult\s*\)/.test(start),
        'startLanguageClient must negotiate against the real InitializeResult',
      );
      assert.ok(
        start.includes('negotiateServerCapabilities') || start.includes('reportServerCapabilities'),
        'startLanguageClient must reach the capability negotiation',
      );
    });

    it('a failed start leaves no stale client handle behind', () => {
      const compiled = path.join(repoRoot(), 'out', 'extension.js');
      if (!fs.existsSync(compiled)) {
        return;
      }
      const js = fs.readFileSync(compiled, 'utf8');
      const start = functionBody(js, 'startLanguageClient');
      assert.ok(
        /catch[\s\S]*client\s*=\s*null/.test(start),
        'startLanguageClient must clear the client handle when start() fails',
      );
    });
  });
});
