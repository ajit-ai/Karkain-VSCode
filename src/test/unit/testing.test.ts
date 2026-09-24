import * as assert from 'assert';
import {
  isNoiseLine,
  parseTestResults,
  parseTestSummary,
  testFileArgs,
  testNamesFromSymbols,
  testNamesFromText,
} from '../../testing';

// Recorded from real `karkain test` runs (1.1.0, default engine); linker-noise
// lines trimmed for readability — the parser must ignore them either way.
const PASS_OUTPUT = [
  '=== Running tests in /tmp/karkain-kcc-test1/pass_test.kark ===',
  '2',
  'two',
  '  PASS test_add',
  '  PASS test_second',
  '',
  '=== Test Summary: 2 tests, 2 passed, 0 failed, 0 skipped ===',
  '2 passed; 0 failed; 0 skipped; 2 total',
].join('\n');

const FAIL_OUTPUT = [
  '=== Running tests in /tmp/karkain-kcc-test2/fail_test.kark ===',
  'C:/x/ld.exe: undefined reference to `__imp_socket`',
  'collect2.exe: error: ld returned 1 exit status',
  'assertion failed: assert_eq: assert_eq(actual, expected)',
  '  expected: 2',
  '  actual:   1',
  '  FAIL test_bad',
  'ok',
  '  PASS test_ok',
  '',
  '=== Test Summary: 2 tests, 1 passed, 1 failed, 0 skipped ===',
  '1 passed; 1 failed; 0 skipped; 2 total',
].join('\n');

describe('testing', () => {
  describe('parseTestResults', () => {
    it('parses passing runs', () => {
      assert.deepStrictEqual(parseTestResults(PASS_OUTPUT), [
        { name: 'test_add', status: 'passed', detail: '' },
        { name: 'test_second', status: 'passed', detail: '' },
      ]);
    });

    it('parses failures with assertion detail and skips noise', () => {
      const got = parseTestResults(FAIL_OUTPUT);
      assert.strictEqual(got.length, 2);
      assert.strictEqual(got[0].name, 'test_bad');
      assert.strictEqual(got[0].status, 'failed');
      assert.ok(got[0].detail.includes('assertion failed'), `detail was: ${got[0].detail}`);
      assert.ok(got[0].detail.includes('expected: 2'));
      assert.ok(!got[0].detail.includes('ld.exe'), 'linker noise must not leak into detail');
      assert.deepStrictEqual(got[1], { name: 'test_ok', status: 'passed', detail: '' });
    });

    it('returns [] for output without result lines', () => {
      assert.deepStrictEqual(parseTestResults('nothing here\n'), []);
    });
  });

  describe('parseTestSummary', () => {
    it('parses the totals line', () => {
      assert.deepStrictEqual(parseTestSummary(PASS_OUTPUT), { passed: 2, failed: 0, skipped: 0, total: 2 });
      assert.deepStrictEqual(parseTestSummary(FAIL_OUTPUT), { passed: 1, failed: 1, skipped: 0, total: 2 });
    });

    it('returns null without a totals line', () => {
      assert.strictEqual(parseTestSummary('  PASS x\n'), null);
    });
  });

  describe('isNoiseLine', () => {
    it('classifies runner scaffolding and linker noise', () => {
      assert.strictEqual(isNoiseLine('=== Running tests in /tmp/x ==='), true);
      assert.strictEqual(isNoiseLine('=== Test Summary: 1 tests, 1 passed, 0 failed, 0 skipped ==='), true);
      assert.strictEqual(isNoiseLine('C:/x/ld.exe: undefined reference'), true);
      assert.strictEqual(isNoiseLine('collect2.exe: error'), true);
      assert.strictEqual(isNoiseLine('  PASS test_a'), false);
      assert.strictEqual(isNoiseLine('hello'), false);
    });
  });

  describe('discovery', () => {
    it('takes test names from semantic symbols', () => {
      assert.deepStrictEqual(
        testNamesFromSymbols([
          { name: 'test_add', kind: 12 },
          { name: 'helper', kind: 12 },
          { name: 'test_x', kind: 13 },
        ]),
        ['test_add'],
      );
    });

    it('falls back to textual func scanning', () => {
      const text = ['// c', 'func test_add() {', '}', 'func helper() {', '}', 'func test_add() {', '}'].join(
        '\n',
      );
      assert.deepStrictEqual(testNamesFromText(text), ['test_add']);
      assert.deepStrictEqual(testNamesFromText('func main() {}\n'), []);
    });
  });

  describe('testFileArgs', () => {
    it('builds the file run vector', () => {
      assert.deepStrictEqual(testFileArgs('a_test.kark'), ['test', 'a_test.kark']);
    });
  });
});
