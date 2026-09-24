// Pure test-runner helpers for `karkain test` (verified shapes in
// docs/KARKAIN-INSPECTION.md §3). Vscode-free: unit-testable.
//
// Real output anatomy (default engine, per file):
//   === Running tests in <staged>/pass_test.kark ===
//   <program stdout, interleaved>
//     PASS test_add
//     FAIL test_bad            <- preceded by `assertion failed: ...` detail
//   === Test Summary: 2 tests, 1 passed, 1 failed, 0 skipped ===
//   1 passed; 1 failed; 0 skipped; 2 total
// Exit 0 all-pass, 4 on any failure. Windows kcc runs also emit Winsock
// linker noise; result/summary lines keep their exact shapes regardless.

export type KarkainTestStatus = 'passed' | 'failed';

export interface KarkainTestResult {
  name: string;
  status: KarkainTestStatus;
  /** Assertion detail lines preceding a FAIL marker (empty for passes). */
  detail: string;
}

export interface KarkainTestSummary {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
}

const RESULT_LINE = /^\s+(PASS|FAIL)\s+(\S+)\s*$/;
const SUMMARY_LINE = /(\d+)\s+passed;\s*(\d+)\s+failed;\s*(\d+)\s+skipped;\s*(\d+)\s+total/;
// Toolchain stderr noise that never carries test semantics.
const NOISE_LINE = /^(=== Running tests in|=== Test Summary:|collect2|C:.*ld\.exe)/;

export function isNoiseLine(line: string): boolean {
  return NOISE_LINE.test(line.trim());
}

// Test-function names from semantic document symbols (Function kind 12).
export function testNamesFromSymbols(symbols: { name: string; kind: number }[]): string[] {
  return symbols.filter((s) => s.kind === 12 && s.name.startsWith('test_')).map((s) => s.name);
}

// Fallback when the language server is unavailable: top-level
// `func test_name(` declarations scanned textually. Logged as fallback.
const TEST_FUNC_LINE = /^\s*func\s+(test_[A-Za-z0-9_]*)\s*\(/;

export function testNamesFromText(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    const m = TEST_FUNC_LINE.exec(line.replace(/\r$/, ''));
    if (m && !out.includes(m[1])) {
      out.push(m[1]);
    }
  }
  return out;
}

export function parseTestResults(output: string): KarkainTestResult[] {
  const results: KarkainTestResult[] = [];
  let pending: string[] = [];
  for (const raw of output.split('\n')) {
    const line = raw.replace(/\r$/, '');
    const m = RESULT_LINE.exec(line);
    if (m) {
      results.push({
        name: m[2],
        status: m[1] === 'PASS' ? 'passed' : 'failed',
        detail: m[1] === 'PASS' ? '' : pending.join('\n').trim(),
      });
      pending = [];
      continue;
    }
    if (line.trim() === '' || isNoiseLine(line) || SUMMARY_LINE.test(line)) {
      if (SUMMARY_LINE.test(line) || isNoiseLine(line)) {
        pending = [];
      }
      continue;
    }
    pending.push(line);
  }
  return results;
}

export function parseTestSummary(output: string): KarkainTestSummary | null {
  const m = SUMMARY_LINE.exec(output);
  if (!m) {
    return null;
  }
  return {
    passed: Number(m[1]),
    failed: Number(m[2]),
    skipped: Number(m[3]),
    total: Number(m[4]),
  };
}

// Argv for a file run. Whole-file runs map by exact name afterwards: the
// runner's --filter is substring-based and could over-match (test_a vs
// test_ab), so single-test runs still execute the file and filter by equality.
export function testFileArgs(file: string): string[] {
  return ['test', file];
}
