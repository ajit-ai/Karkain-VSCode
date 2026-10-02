import * as assert from 'assert';
import { KarkainTaskKind, isFileScoped, taskArgs, taskGroup, taskLabel } from '../../tasks';
import { applyTarget } from '../../targets';

describe('tasks', () => {
  describe('taskArgs', () => {
    it('builds exact argv for file-scoped kinds', () => {
      assert.deepStrictEqual(taskArgs({ kind: 'build', file: 'a.kark' }), ['build', 'a.kark']);
      assert.deepStrictEqual(taskArgs({ kind: 'check', file: 'a.kark' }), ['check', 'a.kark']);
      assert.deepStrictEqual(taskArgs({ kind: 'run', file: 'a.kark' }), ['run', 'a.kark']);
    });

    it('builds bare clean (project-scoped via cwd)', () => {
      assert.deepStrictEqual(taskArgs({ kind: 'clean', cwd: '/proj' }), ['clean']);
    });

    it('refuses file-scoped tasks without a file', () => {
      for (const kind of ['build', 'check', 'run'] as KarkainTaskKind[]) {
        assert.throws(() => taskArgs({ kind }), /requires a file/);
      }
    });

    it('inserts the configured target for build and run, after the verb', () => {
      assert.deepStrictEqual(taskArgs({ kind: 'build', file: 'a.kark', target: 'wasm32-wasi' }), [
        'build',
        '--target',
        'wasm32-wasi',
        'a.kark',
      ]);
      assert.deepStrictEqual(taskArgs({ kind: 'run', file: 'a.kark', target: 'c23' }), [
        'run',
        '--target',
        'c23',
        'a.kark',
      ]);
    });

    it('leaves argv byte-identical when no target is configured', () => {
      assert.deepStrictEqual(taskArgs({ kind: 'build', file: 'a.kark' }), ['build', 'a.kark']);
      assert.deepStrictEqual(taskArgs({ kind: 'build', file: 'a.kark', target: '' }), ['build', 'a.kark']);
      assert.deepStrictEqual(taskArgs({ kind: 'run', file: 'a.kark', target: '  ' }), ['run', 'a.kark']);
    });

    it('does not apply a target to check or clean', () => {
      assert.deepStrictEqual(taskArgs({ kind: 'check', file: 'a.kark', target: 'wasm32-wasi' }), [
        'check',
        'a.kark',
      ]);
      assert.deepStrictEqual(taskArgs({ kind: 'clean', cwd: '/p', target: 'wasm32-wasi' }), ['clean']);
    });

    it('matches the command build path exactly (task and command agree)', () => {
      // The Build File command builds argv with applyTarget(buildArgs(file), t);
      // the task must produce the same vector so the target cannot disappear.
      const target = 'native-x86_64-linux';
      assert.deepStrictEqual(
        taskArgs({ kind: 'build', file: 'a.kark', target }),
        applyTarget(['build', 'a.kark'], target),
      );
    });
  });

  describe('labels and groups', () => {
    it('labels tasks with the file basename', () => {
      assert.strictEqual(taskLabel({ kind: 'build', file: 'C:\\p\\main.kark' }), 'karkain: build main.kark');
      assert.strictEqual(taskLabel({ kind: 'clean' }), 'karkain: clean');
    });

    it('puts only build in the default build group', () => {
      assert.strictEqual(taskGroup('build'), 'build');
      assert.strictEqual(taskGroup('check'), undefined);
      assert.strictEqual(taskGroup('run'), undefined);
      assert.strictEqual(taskGroup('clean'), undefined);
    });

    it('classifies file-scoped kinds', () => {
      assert.strictEqual(isFileScoped('build'), true);
      assert.strictEqual(isFileScoped('clean'), false);
    });
  });
});
