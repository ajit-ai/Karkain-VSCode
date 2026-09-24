import * as assert from 'assert';
import { cppdbgAttachConfig, cppdbgLaunchConfig, debugBinaryPath, debugBuildArgs } from '../../debug';

describe('debug', () => {
  describe('debugBinaryPath', () => {
    it('derives the program path per platform', () => {
      assert.strictEqual(debugBinaryPath('C:\\p\\prog.kark', 'win32'), 'C:\\p\\prog.exe');
      assert.strictEqual(debugBinaryPath('/p/prog.kark', 'linux'), '/p/prog');
      assert.strictEqual(debugBinaryPath('/p/prog.kark', 'darwin'), '/p/prog');
      assert.strictEqual(debugBinaryPath('/p/prog', 'linux'), '/p/prog');
    });
  });

  describe('debugBuildArgs', () => {
    it('builds with debug symbols to the program path', () => {
      assert.deepStrictEqual(debugBuildArgs('a.kark', 'a.exe'), ['build', '-g', 'a.kark', '-o', 'a.exe']);
    });
  });

  describe('cppdbgLaunchConfig', () => {
    it('targets cppdbg/gdb with pretty-printing', () => {
      const cfg = cppdbgLaunchConfig('/p/prog', 'gdb');
      assert.strictEqual(cfg.type, 'cppdbg');
      assert.strictEqual(cfg.request, 'launch');
      assert.strictEqual(cfg.program, '/p/prog');
      assert.strictEqual(cfg.MIMode, 'gdb');
      assert.strictEqual(cfg.miDebuggerPath, 'gdb');
      assert.deepStrictEqual(cfg.setupCommands, [
        {
          description: 'Pretty-print Karkain Value cells',
          text: '-enable-pretty-printing',
          ignoreFailures: true,
        },
      ]);
    });
  });

  describe('cppdbgAttachConfig', () => {
    it('uses the process picker', () => {
      const cfg = cppdbgAttachConfig('/p/prog', '/usr/bin/gdb');
      assert.strictEqual(cfg.request, 'attach');
      assert.strictEqual(cfg.processId, '${command:pickProcess}');
      assert.strictEqual(cfg.miDebuggerPath, '/usr/bin/gdb');
    });
  });
});
