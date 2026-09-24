import * as assert from 'assert';
import {
  buildArgs,
  candidateExecutableNames,
  checkArgs,
  cleanArgs,
  compareVersions,
  fmtArgs,
  isKarkFile,
  listOnPath,
  parseVersionString,
  resolveOnPath,
  runArgs,
  splitPathEnv,
  supportsStructuredDiagnostics,
} from '../../toolchain';

describe('toolchain', () => {
  describe('parseVersionString', () => {
    it('parses the 1.1.0 stable banner', () => {
      const p = parseVersionString('Karkain Compiler v1.1.0 (windows/amd64, Stable Build)\n');
      assert.deepStrictEqual(p, {
        version: '1.1.0',
        os: 'windows',
        arch: 'amd64',
        raw: 'Karkain Compiler v1.1.0 (windows/amd64, Stable Build)',
      });
    });

    it('parses the older 1.0.0 banner shape', () => {
      const p = parseVersionString('Karkain Compiler v1.0.0 (windows/amd64, LSP Engine & IDE Tooling)');
      assert.strictEqual(p?.version, '1.0.0');
      assert.strictEqual(p?.os, 'windows');
      assert.strictEqual(p?.arch, 'amd64');
    });

    it('returns null for unrecognized output', () => {
      assert.strictEqual(parseVersionString(''), null);
      assert.strictEqual(parseVersionString('karkain: command not found'), null);
      assert.strictEqual(parseVersionString('Version 1.1.0'), null);
    });
  });

  describe('compareVersions', () => {
    it('orders triples numerically', () => {
      assert.strictEqual(compareVersions('1.0.0', '1.1.0'), -1);
      assert.strictEqual(compareVersions('1.1.0', '1.1.0'), 0);
      assert.strictEqual(compareVersions('1.10.0', '1.9.9'), 1);
      assert.strictEqual(compareVersions('2.0.0', '1.99.99'), 1);
    });
  });

  describe('supportsStructuredDiagnostics', () => {
    it('gates check --format=json on 1.1.0', () => {
      assert.strictEqual(supportsStructuredDiagnostics('1.1.0'), true);
      assert.strictEqual(supportsStructuredDiagnostics('1.2.0'), true);
      assert.strictEqual(supportsStructuredDiagnostics('1.0.0'), false);
      assert.strictEqual(supportsStructuredDiagnostics('0.117.0'), false);
    });
  });

  describe('isKarkFile', () => {
    it('matches .kark case-insensitively', () => {
      assert.strictEqual(isKarkFile('hello.kark'), true);
      assert.strictEqual(isKarkFile('C:\\proj\\MAIN.KARK'), true);
      assert.strictEqual(isKarkFile('notes.txt'), false);
      assert.strictEqual(isKarkFile('kark'), false);
    });
  });

  describe('command construction', () => {
    it('builds exact argv vectors', () => {
      assert.deepStrictEqual(checkArgs('a.kark', true), ['check', '--format=json', 'a.kark']);
      assert.deepStrictEqual(checkArgs('a.kark', false), ['check', 'a.kark']);
      assert.deepStrictEqual(buildArgs('a.kark'), ['build', 'a.kark']);
      assert.deepStrictEqual(runArgs('a.kark'), ['run', 'a.kark']);
      assert.deepStrictEqual(fmtArgs('a.kark'), ['fmt', 'a.kark']);
    });
  });

  describe('candidateExecutableNames', () => {
    it('prefers karkain.exe on Windows', () => {
      assert.deepStrictEqual(candidateExecutableNames('win32'), ['karkain.exe', 'karkain']);
      assert.deepStrictEqual(candidateExecutableNames('linux'), ['karkain']);
      assert.deepStrictEqual(candidateExecutableNames('darwin'), ['karkain']);
    });
  });

  describe('PATH resolution', () => {
    it('splits PATH with the platform delimiter', () => {
      assert.deepStrictEqual(splitPathEnv('C:\\a;C:\\b;;', 'win32'), ['C:\\a', 'C:\\b']);
      assert.deepStrictEqual(splitPathEnv('/a:/b:', 'linux'), ['/a', '/b']);
      assert.deepStrictEqual(splitPathEnv(undefined, 'linux'), []);
      assert.deepStrictEqual(splitPathEnv('', 'win32'), []);
    });

    it('resolves the first existing candidate', () => {
      const have = new Set(['/tools/karkain', 'C:/t/karkain.exe']);
      const exists = (p: string) => have.has(p);
      assert.strictEqual(resolveOnPath(['/bin', '/tools'], ['karkain'], exists), '/tools/karkain');
      assert.strictEqual(resolveOnPath(['/bin'], ['nope'], exists), null);
      assert.deepStrictEqual(listOnPath(['C:/t', '/tools'], ['karkain.exe', 'karkain'], exists), [
        'C:/t/karkain.exe',
        '/tools/karkain',
      ]);
    });
  });

  describe('cleanArgs', () => {
    it('builds the bare project clean', () => {
      assert.deepStrictEqual(cleanArgs(), ['clean']);
    });
  });
});
