import * as assert from 'assert';
import {
  KarkainDiagnostic,
  KarkainSeverity,
  resolveDiagnosticFile,
  toDiagnosticRange,
  toVscodeSeverityLevel,
  tryParseCheckJson,
} from '../../diagnostics';

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
          endColumn: null,
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
      // LSP numeric 4 is Hint; the toolchain's equivalent wire value is `help`.
      assert.strictEqual(got?.[1].severity, 'help');
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

    it('parses every toolchain severity without falling through to error', () => {
      // The complete wire vocabulary from pkg/diagnostics/reporter.go. Parsing
      // and mapping are checked together so a severity cannot be parsed
      // correctly and then still surface as an error.
      const WIRE: [KarkainSeverity, 'error' | 'warning' | 'information' | 'hint'][] = [
        ['error', 'error'],
        ['warning', 'warning'],
        ['info', 'information'],
        ['note', 'information'],
        ['help', 'hint'],
      ];
      const out = JSON.stringify(
        WIRE.map(([severity], i) => ({
          file: 'a.kark',
          line: i + 1,
          column: 1,
          severity,
          code: '',
          message: severity,
        })),
      );
      const got = tryParseCheckJson(out);
      assert.strictEqual(got?.length, WIRE.length);
      WIRE.forEach(([wire, level], i) => {
        const d = got?.[i];
        assert.strictEqual(d?.severity, wire, `${wire} must parse unchanged`);
        assert.strictEqual(toVscodeSeverityLevel(d?.severity as KarkainSeverity), level, `${wire} level`);
      });
      // The defect this guards: note and help must not reach VS Code Error.
      const levels = (got ?? []).map((d) => toVscodeSeverityLevel(d.severity));
      assert.strictEqual(levels.filter((l) => l === 'error').length, 1, 'only `error` maps to error');
    });

    it('maps note and help away from error while leaving error and warning alone', () => {
      assert.strictEqual(toVscodeSeverityLevel('error'), 'error');
      assert.strictEqual(toVscodeSeverityLevel('warning'), 'warning');
      assert.strictEqual(toVscodeSeverityLevel('note'), 'information');
      assert.strictEqual(toVscodeSeverityLevel('help'), 'hint');
      assert.strictEqual(toVscodeSeverityLevel('info'), 'information');
    });

    it('accepts note and help in the wire output end to end', () => {
      const out = JSON.stringify([
        { file: 'a.kark', line: 1, column: 1, severity: 'note', code: '', message: 'context' },
        { file: 'a.kark', line: 2, column: 1, severity: 'help', code: '', message: 'try this' },
        { file: 'a.kark', line: 3, column: 1, severity: 'warning', code: 'W1', message: 'careful' },
      ]);
      const got = tryParseCheckJson(out);
      assert.deepStrictEqual(
        got?.map((d) => [d.severity, toVscodeSeverityLevel(d.severity)]),
        [
          ['note', 'information'],
          ['help', 'hint'],
          ['warning', 'warning'],
        ],
      );
    });

    it('parses endColumn when the toolchain reports a span', () => {
      const out = JSON.stringify([
        { file: 'a.kark', line: 4, column: 7, endColumn: 12, severity: 'error', code: 'E1', message: 'x' },
      ]);
      assert.strictEqual(tryParseCheckJson(out)?.[0].endColumn, 12);
    });

    it('treats absent, zero, inverted and non-numeric endColumn as unknown', () => {
      const out = JSON.stringify([
        { file: 'a.kark', line: 1, column: 5, severity: 'error', code: '', message: 'absent' },
        { file: 'a.kark', line: 1, column: 5, endColumn: 0, severity: 'error', code: '', message: 'zero' },
        // endColumn equal to or before column cannot describe a span.
        { file: 'a.kark', line: 1, column: 5, endColumn: 5, severity: 'error', code: '', message: 'equal' },
        {
          file: 'a.kark',
          line: 1,
          column: 5,
          endColumn: 2,
          severity: 'error',
          code: '',
          message: 'inverted',
        },
        {
          file: 'a.kark',
          line: 1,
          column: 5,
          endColumn: 'nine',
          severity: 'error',
          code: '',
          message: 'text',
        },
      ]);
      const got = tryParseCheckJson(out);
      assert.strictEqual(got?.length, 5);
      for (const d of got ?? []) {
        assert.strictEqual(d.endColumn, null, `${d.message} should have no usable endColumn`);
      }
    });
  });

  describe('toDiagnosticRange', () => {
    const base: KarkainDiagnostic = {
      file: 'a.kark',
      line: 1,
      column: 1,
      endColumn: null,
      severity: 'error',
      code: '',
      message: 'm',
    };

    it('converts a normal start/end range 1-based -> 0-based', () => {
      assert.deepStrictEqual(toDiagnosticRange({ ...base, line: 4, column: 7, endColumn: 12 }), {
        startLine: 3,
        startCharacter: 6,
        endLine: 3,
        endCharacter: 11,
      });
    });

    it('keeps a single-position diagnostic when no end is available', () => {
      assert.deepStrictEqual(toDiagnosticRange({ ...base, line: 9, column: 3, endColumn: null }), {
        startLine: 8,
        startCharacter: 2,
        endLine: 8,
        endCharacter: 2,
      });
    });

    it('never produces a negative or inverted range', () => {
      // Line/column are clamped to >= 0 even for out-of-contract input.
      assert.deepStrictEqual(toDiagnosticRange({ ...base, line: 0, column: 0, endColumn: null }), {
        startLine: 0,
        startCharacter: 0,
        endLine: 0,
        endCharacter: 0,
      });
      const wide = toDiagnosticRange({ ...base, line: 2, column: 20, endColumn: 3 });
      assert.ok(wide.endCharacter >= wide.startCharacter);
    });

    it('does not fabricate a large range for a one-column diagnostic', () => {
      const r = toDiagnosticRange({ ...base, line: 1, column: 1, endColumn: null });
      assert.strictEqual(r.endCharacter - r.startCharacter, 0);
    });
  });

  describe('resolveDiagnosticFile', () => {
    it('preserves and normalizes absolute POSIX paths', () => {
      assert.strictEqual(
        resolveDiagnosticFile('/proj/src/main.kark', '/proj', '/proj/other.kark', 'linux'),
        '/proj/src/main.kark',
      );
      assert.strictEqual(
        resolveDiagnosticFile('/proj/./src/../src/a.kark', '/proj', '/proj/b.kark', 'linux'),
        '/proj/src/a.kark',
      );
    });

    it('resolves relative paths against the effective cwd', () => {
      assert.strictEqual(
        resolveDiagnosticFile('src/main.kark', '/proj', '/proj/src/other.kark', 'linux'),
        '/proj/src/main.kark',
      );
      assert.strictEqual(resolveDiagnosticFile('a.kark', '/proj', '/proj/b.kark', 'linux'), '/proj/a.kark');
    });

    it('resolves Windows paths and drive letters', () => {
      assert.strictEqual(
        resolveDiagnosticFile('src\\main.kark', 'C:\\proj', 'C:\\proj\\x.kark', 'win32'),
        'C:\\proj\\src\\main.kark',
      );
      // An absolute Windows path survives verbatim, whatever the cwd was.
      assert.strictEqual(
        resolveDiagnosticFile('D:\\other\\main.kark', 'C:\\proj', 'C:\\proj\\x.kark', 'win32'),
        'D:\\other\\main.kark',
      );
      // Forward-slash absolute paths are accepted too.
      assert.strictEqual(
        resolveDiagnosticFile('C:/proj/src/main.kark', undefined, 'C:\\proj\\x.kark', 'win32'),
        'C:\\proj\\src\\main.kark',
      );
    });

    it('falls back to the checked file for blank values and to its directory when no cwd', () => {
      assert.strictEqual(resolveDiagnosticFile('', '/proj', '/proj/a.kark', 'linux'), '/proj/a.kark');
      assert.strictEqual(resolveDiagnosticFile('   ', '/proj', '/proj/a.kark', 'linux'), '/proj/a.kark');
      assert.strictEqual(
        resolveDiagnosticFile('a.kark', undefined, '/proj/src/b.kark', 'linux'),
        '/proj/src/a.kark',
      );
    });

    it('keeps diagnostics from different files distinct (multi-file check)', () => {
      const cwd = '/proj';
      const checked = '/proj/src/main.kark';
      const parsed = tryParseCheckJson(
        JSON.stringify([
          { file: 'src/main.kark', line: 1, column: 1, severity: 'error', code: 'E1', message: 'in main' },
          { file: 'src/util.kark', line: 2, column: 3, severity: 'error', code: 'E2', message: 'in util' },
        ]),
      );
      const resolved = new Set(
        (parsed ?? []).map((d) => resolveDiagnosticFile(d.file, cwd, checked, 'linux')),
      );
      assert.deepStrictEqual([...resolved].sort(), ['/proj/src/main.kark', '/proj/src/util.kark']);
    });
  });
});
