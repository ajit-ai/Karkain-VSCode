import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

// SPEC.md §1.2 authoritative word list (lexer keywords + literals).
const SPEC_WORDS = [
  'func',
  'fn',
  'print',
  'println',
  'let',
  'var',
  // `const` is a reserved lexer keyword (pkg/lexer/lexer.go -> TokenConst);
  // asserted here so it cannot silently drop out of the grammar again.
  'const',
  'return',
  'if',
  'else',
  'import',
  'matrix',
  'alloc',
  'free',
  'addr',
  'qreg',
  'gate',
  'measure',
  'actor',
  'spawn',
  'receive',
  'channel',
  'send',
  'macro',
  'quote',
  'unquote',
  'comptime',
  'while',
  'for',
  'type',
  'struct',
  'bool',
  'bigint',
  'bigfloat',
  'true',
  'false',
  'kernel',
  'device',
  'global_id',
  'barrier',
  'mut',
  'raw',
  'move',
  'Some',
  'None',
  'Ok',
  'Err',
  'match',
  'linear',
  'packed',
  'enum',
  'in',
  'break',
  'continue',
];

function repoRoot(): string {
  return path.resolve(__dirname, '..', '..', '..');
}

function collectRegexSources(node: unknown, into: string[]): void {
  if (typeof node === 'string') {
    into.push(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      collectRegexSources(item, into);
    }
    return;
  }
  if (typeof node === 'object' && node !== null) {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if ((key === 'match' || key === 'begin' || key === 'end') && typeof value === 'string') {
        into.push(value);
      } else {
        collectRegexSources(value, into);
      }
    }
  }
}

// The intended TextMate scope of each keyword rule, in grammar order. Taken from
// the grammar as it stands (SPEC §1.2 keyword taxonomy); the keyword words are
// NOT listed here — they are derived from each rule's own alternation and
// cross-checked against SPEC_WORDS, so the two lists cannot drift apart.
const EXPECTED_KEYWORD_SCOPES = [
  'keyword.control.karkain',
  'support.function.builtin.karkain',
  'constant.language.boolean.karkain',
  'constant.language.karkain',
  'support.type.primitive.karkain',
  'keyword.other.karkain',
];

// Extracts the alternatives of a keyword rule shaped like `\b(a|b|c)\b`.
// Returns an empty array for any other shape, which the caller treats as a
// failure rather than silently ignoring the rule.
function alternationWords(match: string): string[] {
  const m = /^\s*\\b\((.+)\)\\b\s*$/.exec(match);
  return m ? m[1].split('|') : [];
}

describe('language assets', () => {
  describe('grammar (syntaxes/karkain.tmLanguage.json)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let grammar: any;
    let sources: string[];

    before(() => {
      grammar = JSON.parse(
        fs.readFileSync(path.join(repoRoot(), 'syntaxes', 'karkain.tmLanguage.json'), 'utf8'),
      );
      sources = [];
      collectRegexSources(grammar.repository, sources);
      assert.ok(sources.length > 0, 'grammar must contain match/begin/end patterns');
    });

    it('declares the source.karkain scope', () => {
      assert.strictEqual(grammar.scopeName, 'source.karkain');
    });

    it('compiles every regex', () => {
      for (const src of sources) {
        assert.doesNotThrow(() => new RegExp(src), `invalid regex: ${src}`);
      }
    });

    it('covers every SPEC §1.2 word', () => {
      // Only rules that actually consume characters count as coverage. Two
      // kinds of rule would otherwise match every word and make this assertion
      // vacuous: the generic identifier rule (`\b[a-zA-Z_]\w*\b`), and the
      // zero-width `end` lookaheads (e.g. `(?=\{|$)`), which match the empty
      // string. Excluding both is what makes a removed keyword — such as
      // `const` — fail this test instead of silently passing.
      const identifier = grammar.repository.identifier?.match;
      const regexes = sources
        .filter((s) => s !== identifier)
        .map((s) => new RegExp(s))
        .filter((re) => !re.test(''));
      const missing = SPEC_WORDS.filter((w) => !regexes.some((re) => re.test(w)));
      assert.deepStrictEqual(missing, [], `words without grammar coverage: ${missing.join(', ')}`);
    });

    it('assigns every keyword the intended TextMate scope', () => {
      // Matching a keyword is not enough: a rule can match and still highlight
      // it with the wrong colour if its scope is wrong. Each keyword rule is
      // therefore checked for its own scope, and every SPEC word is resolved
      // through the rule that actually claims it — so a scope changed to an
      // unrelated one fails here instead of passing silently.
      const patterns = grammar.repository.keyword.patterns as {
        match: string;
        name: string;
      }[];
      assert.strictEqual(
        patterns.length,
        EXPECTED_KEYWORD_SCOPES.length,
        'keyword rule count changed; update EXPECTED_KEYWORD_SCOPES deliberately',
      );

      const scopeByWord = new Map<string, string>();
      patterns.forEach((pattern, i) => {
        assert.strictEqual(
          pattern.name,
          EXPECTED_KEYWORD_SCOPES[i],
          `keyword rule ${i} must use scope ${EXPECTED_KEYWORD_SCOPES[i]}, got ${pattern.name}`,
        );
        const words = alternationWords(pattern.match);
        assert.ok(words.length > 0, `keyword rule ${i} has no \b(...)\b alternation to verify`);
        for (const word of words) {
          assert.ok(
            !scopeByWord.has(word),
            `keyword "${word}" is claimed by both ${scopeByWord.get(word)} and ${pattern.name}`,
          );
          scopeByWord.set(word, pattern.name);
        }
      });

      // Every asserted keyword must be resolved through a keyword rule, so the
      // scope check above is genuinely reachable for all of SPEC_WORDS.
      const unscoped = SPEC_WORDS.filter((w) => !scopeByWord.has(w));
      assert.deepStrictEqual(unscoped, [], `keywords with no keyword rule: ${unscoped.join(', ')}`);
    });

    it('keeps comment/string/identifier rules', () => {
      assert.ok(grammar.repository.comment, 'comment rule missing');
      assert.ok(grammar.repository.string, 'string rule missing');
      assert.ok(grammar.repository.identifier, 'identifier rule missing');
      assert.ok(new RegExp(grammar.repository.comment.match).test('// hello'));
    });
  });

  describe('snippets (snippets/karkain.json)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let snippets: Record<string, any>;

    before(() => {
      snippets = JSON.parse(fs.readFileSync(path.join(repoRoot(), 'snippets', 'karkain.json'), 'utf8'));
    });

    it('defines a non-empty snippet set', () => {
      assert.ok(Object.keys(snippets).length >= 10, 'expected at least 10 snippets');
    });

    it('gives every snippet a prefix, body and description', () => {
      for (const [name, s] of Object.entries(snippets)) {
        const prefix = Array.isArray(s.prefix) ? s.prefix.join('') : String(s.prefix ?? '');
        const body = Array.isArray(s.body) ? s.body.join('\n') : String(s.body ?? '');
        assert.ok(prefix.length > 0, `${name}: empty prefix`);
        assert.ok(body.length > 0, `${name}: empty body`);
        assert.ok(String(s.description ?? '').length > 0, `${name}: empty description`);
        assert.ok(/\$(\d|\{)/.test(body), `${name}: body has no tab stop`);
      }
    });

    it('ships the core main/func/match/struct snippets', () => {
      const prefixes = Object.values(snippets).map((s) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Array.isArray((s as any).prefix) ? (s as any).prefix.join(' ') : String((s as any).prefix),
      );
      for (const want of ['main', 'func', 'match', 'struct', 'import']) {
        assert.ok(prefixes.includes(want), `missing snippet with prefix ${want}`);
      }
    });
  });

  describe('language-configuration.json', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let config: any;

    before(() => {
      config = JSON.parse(fs.readFileSync(path.join(repoRoot(), 'language-configuration.json'), 'utf8'));
    });

    it('uses // line comments and ASCII identifier words', () => {
      assert.strictEqual(config.comments.lineComment, '//');
      const word = new RegExp(`^(?:${config.wordPattern})$`);
      assert.ok(word.test('my_var1'), 'wordPattern must match identifiers');
      assert.ok(!word.test('9lives'), 'wordPattern must reject leading digits');
    });

    it('compiles indentation and onEnter rules', () => {
      assert.doesNotThrow(() => new RegExp(config.indentationRules.increaseIndentPattern));
      assert.doesNotThrow(() => new RegExp(config.indentationRules.decreaseIndentPattern));
      for (const rule of config.onEnterRules ?? []) {
        assert.doesNotThrow(() => new RegExp(rule.beforeText));
      }
    });
  });

  describe('manifest (package.json)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let manifest: any;
    let raw: string;

    before(() => {
      raw = fs.readFileSync(path.join(repoRoot(), 'package.json'), 'utf8');
      manifest = JSON.parse(raw);
    });

    it('declares no duplicate JSON object keys', () => {
      // A duplicated key is silently dropped by JSON.parse, so the parsed
      // manifest looks correct while the source is ambiguous. Detect it in the
      // raw text instead: collect every key occurrence in the contributes
      // block and assert no name is declared twice at the same level.
      const hit = /"contributes"\s*:\s*\{/.exec(raw);
      assert.ok(hit, 'contributes block must exist');
      // Walk braces to find the end of the contributes object.
      const start = hit.index + hit[0].length;
      let depth = 1;
      let i = start;
      let inString = false;
      let escaped = false;
      for (; i < raw.length && depth > 0; i++) {
        const ch = raw[i];
        if (inString) {
          if (escaped) {
            escaped = false;
          } else if (ch === '\\') {
            escaped = true;
          } else if (ch === '"') {
            inString = false;
          }
          continue;
        }
        if (ch === '"') {
          inString = true;
        } else if (ch === '{') {
          depth++;
        } else if (ch === '}') {
          depth--;
        }
      }
      const body = raw.slice(start, i - 1);
      // Top-level keys are the ones at exactly 4 spaces of indentation.
      const seen: string[] = [];
      for (const m of body.matchAll(/^ {4}"([^"]+)"\s*:/gm)) {
        const key = m[1];
        assert.ok(!seen.includes(key), `duplicate contributes.${key} declaration`);
        seen.push(key);
      }
      assert.strictEqual(seen.filter((k) => k === 'menus').length, 1, 'exactly one contributes.menus');
    });

    it('keeps a single menus object with the expected editor/context entries', () => {
      const context = manifest.contributes.menus['editor/context'];
      assert.ok(Array.isArray(context), 'editor/context menu must be an array');
      const commands = context.map((e: { command: string }) => e.command);
      assert.deepStrictEqual(commands, [
        'karkain.check',
        'karkain.build',
        'karkain.run',
        'karkain.test',
        'karkain.debug',
      ]);
    });

    it('declares no default formatter (the language server owns formatting)', () => {
      // The extension registers no formatting provider, so a manifest-level
      // default would advertise a competing formatter.
      const karkain = manifest.contributes.configuration.properties;
      assert.ok(!('karkain.defaultFormatter' in karkain), 'no extension-side default formatter expected');
      assert.ok(
        !JSON.stringify(manifest.contributes).includes('defaultFormatter'),
        'manifest must not declare a defaultFormatter',
      );
    });

    it('registers no DocumentFormattingEditProvider in the compiled extension', () => {
      const compiled = path.join(repoRoot(), 'out', 'extension.js');
      if (!fs.existsSync(compiled)) {
        // out/ is produced by `npm run compile`; nothing to assert without it.
        return;
      }
      const js = fs.readFileSync(compiled, 'utf8');
      assert.ok(
        !js.includes('registerDocumentFormattingEditProvider'),
        'formatting must come from the language client only',
      );
    });
  });
});
