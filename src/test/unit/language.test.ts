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
      const regexes = sources.map((s) => new RegExp(s));
      const missing = SPEC_WORDS.filter((w) => !regexes.some((re) => re.test(w)));
      assert.deepStrictEqual(missing, [], `words without grammar coverage: ${missing.join(', ')}`);
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
});
