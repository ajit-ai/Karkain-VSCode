import * as assert from 'assert';
import {
  TargetMatrix,
  applyTarget,
  emptyMatrix,
  parseComputeTargetDetail,
  parseTargetOutput,
} from '../../targets';

// Recorded from `karkain target` (1.1.0, host x86_64-windows, 2026-09-24).
// Tests assert structure, never host-specific exhaustiveness.
const RECORDED = [
  'Host: x86_64-windows',
  'Supported targets:',
  '  c23            (C23 source output; x86_64-windows)',
  '  native         (host default; x86_64-windows)',
  '  wasm32-wasi    wasm32-wasi        32-bit little-endian; objects WASM / executables WASM; WebAssembly/WASI',
  'Default: native',
  'Compute targets (Phase 124 experimental):',
  '  cpu                  implemented   Reference scalar CPU executor (the default lowering surface)',
  '  gpu-experimental     experimental  Data-parallel kernel executor over tensor/matrix ops (model only; no vendor dependencies)',
  '  quantum-experimental research      Quantum circuit executor over gate primitives and measurement (spec model only)',
].join('\n');

const DETAIL = [
  'Compute target: gpu-experimental',
  'Family:         gpu',
  'Maturity:       experimental',
  'Host triple:    x86_64-windows',
  'Memory model:   host-device (plain buffers copied across the host/device boundary)',
  'Description:    Data-parallel kernel executor over tensor/matrix ops (model only; no vendor dependencies)',
  'Capabilities:   allocation, async_execution, kernel_launch',
].join('\n');

describe('targets', () => {
  describe('parseTargetOutput', () => {
    it('parses host, default, triples and compute maturities', () => {
      const m: TargetMatrix = parseTargetOutput(RECORDED);
      assert.strictEqual(m.host, 'x86_64-windows');
      assert.strictEqual(m.defaultTarget, 'native');
      assert.deepStrictEqual(m.targets[0], {
        name: 'c23',
        description: '(C23 source output; x86_64-windows)',
      });
      const wasm = m.targets.find((t) => t.name === 'wasm32-wasi');
      assert.ok(wasm && wasm.description.includes('WASM'));
      assert.deepStrictEqual(m.compute[0], {
        name: 'cpu',
        maturity: 'implemented',
        description: 'Reference scalar CPU executor (the default lowering surface)',
      });
      const gpu = m.compute.find((c) => c.name === 'gpu-experimental');
      assert.strictEqual(gpu?.maturity, 'experimental');
      const q = m.compute.find((c) => c.name === 'quantum-experimental');
      assert.strictEqual(q?.maturity, 'research');
    });

    it('returns an empty matrix for unrecognized output', () => {
      assert.deepStrictEqual(parseTargetOutput('nothing here\n'), emptyMatrix());
      assert.deepStrictEqual(parseTargetOutput(''), emptyMatrix());
    });
  });

  describe('parseComputeTargetDetail', () => {
    it('maps the detail view fields', () => {
      const d = parseComputeTargetDetail(DETAIL);
      assert.strictEqual(d?.['Family'], 'gpu');
      assert.strictEqual(d?.['Maturity'], 'experimental');
      assert.ok((d?.['Capabilities'] ?? '').includes('kernel_launch'));
    });

    it('returns null without detail fields', () => {
      assert.strictEqual(parseComputeTargetDetail('plain text\n'), null);
    });
  });

  describe('applyTarget', () => {
    it('inserts --target after the verb', () => {
      assert.deepStrictEqual(applyTarget(['build', 'a.kark'], 'wasm32-wasi'), [
        'build',
        '--target',
        'wasm32-wasi',
        'a.kark',
      ]);
      assert.deepStrictEqual(applyTarget(['run', 'a.kark'], 'x86_64-linux'), [
        'run',
        '--target',
        'x86_64-linux',
        'a.kark',
      ]);
    });

    it('leaves argv untouched for an empty target', () => {
      assert.deepStrictEqual(applyTarget(['build', 'a.kark'], ''), ['build', 'a.kark']);
      assert.deepStrictEqual(applyTarget(['build', 'a.kark'], '   '), ['build', 'a.kark']);
    });
  });
});
