import * as assert from 'assert';
import { splitFlags } from '../../flags';

describe('splitFlags', () => {
  it('splits on whitespace', () => {
    assert.deepStrictEqual(splitFlags('--verbose --target native'), ['--verbose', '--target', 'native']);
    assert.deepStrictEqual(splitFlags(''), []);
    assert.deepStrictEqual(splitFlags('   '), []);
  });

  it('honours quoted segments as single arguments', () => {
    assert.deepStrictEqual(splitFlags('--target "x86_64-windows" --verbose'), [
      '--target',
      'x86_64-windows',
      '--verbose',
    ]);
    assert.deepStrictEqual(splitFlags('-o "my out.exe"'), ['-o', 'my out.exe']);
  });

  it('keeps flag values attached when they are separate tokens', () => {
    assert.deepStrictEqual(splitFlags('--filter test_add --verbose'), ['--filter', 'test_add', '--verbose']);
  });

  it('never splits a quoted value containing spaces', () => {
    assert.deepStrictEqual(splitFlags('--name "a b c"'), ['--name', 'a b c']);
  });

  it('does not interpret shell metacharacters (argv, never a shell)', () => {
    // These must survive as literal data, not be expanded.
    assert.deepStrictEqual(splitFlags('--msg "$(rm -rf /)" ; `id`'), ['--msg', '$(rm -rf /)', ';', '`id`']);
  });
});
