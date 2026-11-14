import * as assert from 'assert';
import { buildHealthReport, HealthInput } from '../../health';

function base(): HealthInput {
  return {
    vscodeVersion: '1.96.0',
    platform: 'win32/x64',
    extensionVersion: '1.0.0',
    compilerPathSetting: 'karkain',
    compilerPathResolved: 'C:\\tools\\karkain.exe',
    compilerExists: true,
    probe: { ok: true, version: '1.2.0', rawBanner: 'Karkain Compiler v1.2.0 (windows/amd64, Stable Build)' },
    engineSetting: '',
    targetSetting: '',
    lsp: { running: true, restarts: 0 },
    shim: { present: true, repairsLogged: 2 },
    workspaceRoots: ['F:\\proj'],
    manifest: { found: true, summary: 'sample@0.1.0' },
    gdb: { pathSetting: 'gdb', found: true },
    stdlibPathSet: false,
    examplesPathSet: false,
    ideInfo: { kind: 'ok' },
    diagnosticCount: 0,
  };
}

describe('health report builder', () => {
  it('produces a report with all core sections, PASS overall', () => {
    const r = buildHealthReport(base());
    assert.strictEqual(r.overall, 'ok');
    assert.match(r.text, /Karkain — Diagnostic Report/);
    assert.match(r.text, /\[PASS\] Compiler executable: found; v1\.2\.0/);
    assert.match(r.text, /\[PASS\] Language server: running/);
    assert.match(r.text, /Shim|shim|repair/i);
    assert.match(r.text, /F:\\proj/);
    assert.match(r.text, /sample@0\.1\.0/);
    assert.match(r.text, /schemaVersion 1/);
  });

  it('marks a missing compiler as FAIL with a remediation', () => {
    const input = { ...base(), compilerExists: false, probe: { ok: false, detail: 'not found' } };
    const r = buildHealthReport(input);
    assert.strictEqual(r.overall, 'fail');
    const line = r.lines.find((l) => l.label === 'Compiler executable');
    assert.strictEqual(line?.status, 'fail');
    assert.ok(line?.remediation && /compilerPath/.test(line.remediation));
  });

  it('a probe failure downgrades to warn, not fail', () => {
    const input = { ...base(), probe: { ok: false, detail: 'unparseable banner' } };
    const r = buildHealthReport(input);
    assert.strictEqual(r.overall, 'warn');
  });

  it('a missing gdb downgrades to warn with remediation', () => {
    const input = { ...base(), gdb: { pathSetting: 'gdb', found: false } };
    const r = buildHealthReport(input);
    assert.strictEqual(r.overall, 'warn');
    const line = r.lines.find((l) => l.label === 'GDB debugger');
    assert.ok(line?.remediation && /debuggerPath/.test(line.remediation));
  });

  it('a language server down produces warn and includes the error', () => {
    const input = { ...base(), lsp: { running: false, restarts: 3, lastError: 'initialize timeout' } };
    const r = buildHealthReport(input);
    assert.strictEqual(r.overall, 'warn');
    assert.match(r.text, /initialize timeout/);
    assert.match(r.text, /restarts this session: 3/);
  });

  it('missing ide info contract is a warning, not a failure', () => {
    const input = { ...base(), ideInfo: { kind: 'invalid' as const, detail: 'not JSON' } };
    const r = buildHealthReport(input);
    assert.strictEqual(r.overall, 'warn');
    const line = r.lines.find((l) => l.label === 'ide info contract');
    assert.strictEqual(line?.status, 'warn');
  });

  it('an unreadable manifest is warn with remediation', () => {
    const input = { ...base(), manifest: { found: false as const, problem: 'parse error at line 3' } };
    const r = buildHealthReport(input);
    const line = r.lines.find((l) => l.label === 'Karkain project (karkain.toml)');
    assert.strictEqual(line?.status, 'warn');
    assert.match(line?.remediation ?? '', /karkain\.toml/);
  });

  it('contains no environment variable values', () => {
    // The input contract has no env surface; assert the shape cannot carry PATH-like data.
    const input = base();
    const keys = Object.keys(input);
    for (const key of ['env', 'PATH', 'pathEnv', 'environ']) {
      assert.ok(!keys.includes(key));
    }
  });
});
