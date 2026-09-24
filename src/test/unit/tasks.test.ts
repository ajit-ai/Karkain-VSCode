import * as assert from 'assert';
import { KarkainTaskKind, isFileScoped, taskArgs, taskGroup, taskLabel } from '../../tasks';

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
