import * as assert from 'assert';
import { tryParseCheckJson } from '../../diagnostics';

describe('diagnostics', () => {
  describe('tryParseCheckJson', () => {
    it('parses a single diagnostic', () => {
      const out = JSON.stringify([
        {
          file: 'bad.kark',
          line: 2,
          column: 9,
          severity: 'error',
          code: 'K002',
          message: "undefined identifier 'x'",
        },
      ]);
      const got = tryParseCheckJson(out);
      assert.deepStrictEqual(got, [
        {
          file: 'bad.kark',
          line: 2,
          column: 9,
          severity: 'error',
          code: 'K002',
          message: "undefined identifier 'x'",
        },
      ]);
    });

    it('parses multiple diagnostics with mixed severities', () => {
      const out = JSON.stringify([
        { file: 'a.kark', line: 1, column: 1, severity: 'error', code: 'E1', message: 'bad' },
        { file: 'a.kark', line: 3, column: 5, severity: 'warning', code: 'W1', message: 'suspicious' },
        { file: 'b.kark', line: 2, column: 2, severity: 3, code: '', message: 'note' },
      ]);
      const got = tryParseCheckJson(out);
      assert.strictEqual(got?.length, 3);
      assert.strictEqual(got?.[1].severity, 'warning');
      assert.strictEqual(got?.[2].severity, 'info');
    });

    it('maps numeric severities and unknown values honestly', () => {
      const out = JSON.stringify([
        { file: 'a.kark', line: 1, column: 1, severity: 1, code: '', message: 'e' },
        { file: 'a.kark', line: 1, column: 1, severity: 4, code: '', message: 'h' },
        { file: 'a.kark', line: 1, column: 1, severity: 'bogus', code: '', message: 'u' },
      ]);
      const got = tryParseCheckJson(out);
      assert.strictEqual(got?.[0].severity, 'error');
      assert.strictEqual(got?.[1].severity, 'hint');
      // Unknown severity is surfaced as error, never silently downgraded.
      assert.strictEqual(got?.[2].severity, 'error');
    });

    it('returns [] for valid empty output (check passed)', () => {
      assert.deepStrictEqual(tryParseCheckJson('[]'), []);
    });

    it('returns null for non-structured output', () => {
      assert.strictEqual(tryParseCheckJson('Check passed.\n'), null);
      assert.strictEqual(tryParseCheckJson(''), null);
      assert.strictEqual(tryParseCheckJson('{"not":"an array"}'), null);
    });

    it('skips items missing file or message and clamps ranges', () => {
      const out = JSON.stringify([
        { line: 1, column: 1, severity: 'error', code: 'X', message: 'no file' },
        { file: 'a.kark', line: 1, column: 1, severity: 'error', code: 'X' },
        { file: 'a.kark', line: 0, column: -5, severity: 'error', code: '', message: '  spaced  ' },
      ]);
      const got = tryParseCheckJson(out);
      assert.strictEqual(got?.length, 1);
      assert.strictEqual(got?.[0].line, 1);
      assert.strictEqual(got?.[0].column, 1);
      assert.strictEqual(got?.[0].message, 'spaced');
    });

    it('survives a multiline diagnostic message', () => {
      const out = JSON.stringify([
        {
          file: 'a.kark',
          line: 10,
          column: 3,
          severity: 'error',
          code: 'K100',
          message: 'first\nsecond\nthird',
        },
      ]);
      const got = tryParseCheckJson(out);
      assert.strictEqual(got?.[0].message, 'first\nsecond\nthird');
    });
  });
});
