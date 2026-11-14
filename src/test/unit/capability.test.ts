import * as assert from 'assert';
import {
  compareIdeInfoWithFallback,
  FALLBACK_ARGV,
  parseIdeInfo,
  type KarkainCapabilityInfo,
} from '../../capability';

const VALID = JSON.stringify({
  schemaVersion: 1,
  language: { name: 'Karkain', id: 'karkain', extensions: ['.kark'], defaultFilename: 'main.kark' },
  projectDetection: { manifest: 'karkain.toml', marker: 'main.kark' },
  toolchain: {
    binary: 'karkain',
    check: ['karkain', 'check', '<file>'],
    checkJSON: ['karkain', 'check', '--format=json', '<file>'],
    build: ['karkain', 'build', '<file>'],
    run: ['karkain', 'run', '<file>'],
    test: ['karkain', 'test', '<path>'],
    format: ['karkain', 'fmt', '<file>'],
    formatCheck: ['karkain', 'fmt', '--check', '<file>'],
    lint: ['karkain', 'lint', '<file>'],
    lsp: ['karkain', 'lsp'],
  },
  diagnostics: { format: 'json', schema: 'karkain-diagnostics-v1', code: 'E-K-*/W-K-*' },
  exitCodes: { success: 0, failure: 1, usage: 2, compile: 3, test: 4, package: 5, env: 6 },
});

function validInfo(): KarkainCapabilityInfo {
  const out = parseIdeInfo(VALID);
  assert.strictEqual(out.kind, 'ok');
  if (out.kind !== 'ok') {
    throw new Error('unreachable');
  }
  return out.info;
}

describe('capability / ide info', () => {
  it('parses the real v1.2.0 contract (captured verbatim)', () => {
    const r = parseIdeInfo(VALID);
    assert.strictEqual(r.kind, 'ok');
    if (r.kind !== 'ok') {
      return;
    }
    assert.strictEqual(r.info.schemaVersion, 1);
    assert.strictEqual(r.info.language?.id, 'karkain');
    assert.strictEqual(r.info.projectDetection?.manifest, 'karkain.toml');
    assert.deepStrictEqual(r.info.argv['build'], ['karkain', 'build', '<file>']);
    assert.deepStrictEqual(r.info.argv['lsp'], ['karkain', 'lsp']);
    assert.strictEqual(r.info.lspAdvertised, true);
    assert.strictEqual(r.info.diagnostics?.schema, 'karkain-diagnostics-v1');
    assert.strictEqual(r.info.exitCodes?.compile, 3);
  });

  it('rejects non-JSON input as invalid, without throwing', () => {
    const r = parseIdeInfo('this is not json');
    assert.strictEqual(r.kind, 'invalid');
  });

  it('rejects a JSON array payload as invalid', () => {
    assert.strictEqual(parseIdeInfo('[]').kind, 'invalid');
  });

  it('rejects a missing or non-integer schemaVersion as unsupported', () => {
    assert.strictEqual(parseIdeInfo('{}').kind, 'unsupported');
    assert.strictEqual(parseIdeInfo('{"schemaVersion":"1"}').kind, 'unsupported');
  });

  it('rejects schemaVersion 2 as unsupported (no silent acceptance)', () => {
    const r = parseIdeInfo('{"schemaVersion":2}');
    assert.strictEqual(r.kind, 'unsupported');
    if (r.kind === 'unsupported') {
      assert.match(r.detail, /schemaVersion 2/);
    }
  });

  it('drops non-string-array argv vectors instead of accepting them', () => {
    const r = parseIdeInfo(
      JSON.stringify({
        schemaVersion: 1,
        toolchain: { binary: 'karkain', build: ['build', 42], run: ['run', '<file.kark>'] },
      }),
    );
    assert.strictEqual(r.kind, 'ok');
    if (r.kind !== 'ok') {
      return;
    }
    assert.strictEqual(r.info.argv['build'], undefined);
    assert.deepStrictEqual(r.info.argv['run'], ['run', '<file.kark>']);
  });

  it('drops non-integer exit codes', () => {
    const r = parseIdeInfo(JSON.stringify({ schemaVersion: 1, exitCodes: { success: '0', compile: 3 } }));
    assert.strictEqual(r.kind, 'ok');
    if (r.kind !== 'ok') {
      return;
    }
    assert.strictEqual(r.info.exitCodes, undefined);
  });

  it('reports lspAdvertised false when lsp vector is absent', () => {
    const r = parseIdeInfo(JSON.stringify({ schemaVersion: 1, toolchain: {} }));
    assert.strictEqual(r.kind, 'ok');
    if (r.kind === 'ok') {
      assert.strictEqual(r.info.lspAdvertised, false);
    }
  });

  it('compareIdeInfoWithFallback finds no divergences on the real contract', () => {
    assert.deepStrictEqual(compareIdeInfoWithFallback(validInfo()), []);
  });

  it('compareIdeInfoWithFallback reports missing and divergent argv honestly', () => {
    const info = validInfo();
    info.argv = { ...FALLBACK_ARGV };
    delete info.argv['lint'];
    info.argv['build'] = ['build', '--wrong', '<file>'];
    const divergences = compareIdeInfoWithFallback(info);
    assert.ok(divergences.some((d) => d.what === 'argv.lint' && d.actual === '(absent)'));
    assert.ok(divergences.some((d) => d.what === 'argv.build' && d.actual.includes('--wrong')));
  });

  it('compareIdeInfoWithFallback reports missing exit codes and wrong diagnostics schema', () => {
    const info = validInfo();
    info.exitCodes = { ...info.exitCodes, compile: 99 };
    info.diagnostics = { schema: 'something-else' };
    const divergences = compareIdeInfoWithFallback(info);
    assert.ok(divergences.some((d) => d.what === 'exitCodes.compile' && d.actual === '99'));
    assert.ok(divergences.some((d) => d.what === 'diagnostics.schema'));
  });
});
