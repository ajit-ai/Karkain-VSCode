import * as assert from 'assert';
import {
  CancellationSignal,
  DEFAULT_TOOLCHAIN_TIMEOUT_MS,
  NodeToolchainService,
  ToolchainRunResult,
  ToolchainService,
} from '../../toolchainService';
import { FakeToolchainService, NotInstalledToolchainService } from '../fakes/toolchainFake';
import { parseTestResults } from '../../testing';

const CWD = process.cwd();

describe('NodeToolchainService', () => {
  it('resolves the executable lazily on every call', async () => {
    let exe = 'first';
    const svc = new NodeToolchainService(() => exe);
    assert.strictEqual(svc.executable(), 'first');
    exe = 'second';
    assert.strictEqual(svc.executable(), 'second');
  });

  it('runs a real process and separates stdout from stderr', async () => {
    const svc = new NodeToolchainService(() => process.execPath);
    const r = await svc.run([
      '-e',
      'process.stdout.write("OUT"); process.stderr.write("ERR"); process.exit(0);',
    ]);
    assert.strictEqual(r.stdout, 'OUT');
    assert.strictEqual(r.stderr, 'ERR');
    assert.strictEqual(r.combined, 'OUTERR');
    assert.strictEqual(r.code, 0);
    assert.strictEqual(r.spawnError, undefined);
    assert.strictEqual(r.notFound, false);
    assert.strictEqual(r.timedOut, false);
    assert.strictEqual(r.cancelled, false);
  });

  it('reports a non-zero exit code without a spawn error', async () => {
    const svc = new NodeToolchainService(() => process.execPath);
    const r = await svc.run(['-e', 'process.exit(3);']);
    assert.strictEqual(r.code, 3);
    assert.strictEqual(r.spawnError, undefined);
  });

  it('reports a missing executable as notFound rather than a crash', async () => {
    const svc = new NodeToolchainService(() => 'karkain-does-not-exist-xyz');
    const r = await svc.run(['--version']);
    assert.strictEqual(r.notFound, true);
    assert.ok(r.spawnError, 'expected a spawnError for a missing executable');
    assert.strictEqual(r.code, null);
  });

  it('passes cwd through to the child', async () => {
    const svc = new NodeToolchainService(() => process.execPath);
    const r = await svc.run(['-e', 'process.stdout.write(process.cwd());'], { cwd: CWD });
    assert.strictEqual(r.stdout.trim().length > 0, true);
  });

  it('merges an env overlay over the inherited environment', async () => {
    const svc = new NodeToolchainService(() => process.execPath);
    const r = await svc.run(['-e', 'process.stdout.write(process.env.KARKAIN_ENGINE || "");'], {
      env: { KARKAIN_ENGINE: 'go' },
    });
    assert.strictEqual(r.stdout, 'go');
  });

  it('kills the child and flags timedOut when the timeout elapses', async () => {
    const svc = new NodeToolchainService(() => process.execPath);
    const r = await svc.run(['-e', 'setTimeout(() => {}, 60000);'], { timeoutMs: 150 });
    assert.strictEqual(r.timedOut, true);
  });

  it('kills the child and flags cancelled when the token fires', async () => {
    const svc = new NodeToolchainService(() => process.execPath);
    let fire: (() => void) | undefined;
    const token = {
      onCancellationRequested(listener: () => void): { dispose(): void } {
        fire = listener;
        return { dispose: () => undefined };
      },
    };
    const pending = svc.run(['-e', 'setTimeout(() => {}, 60000);'], { token });
    await new Promise((r) => setTimeout(r, 50));
    fire?.();
    const r = await pending;
    assert.strictEqual(r.cancelled, true);
  });

  it('exposes a bounded default timeout constant', () => {
    assert.strictEqual(DEFAULT_TOOLCHAIN_TIMEOUT_MS, 120000);
  });
});

describe('FakeToolchainService', () => {
  it('records every run with argv, cwd and env', async () => {
    const fake = new FakeToolchainService();
    await fake.run(['check', 'a.kark'], { cwd: '/proj', env: { KARKAIN_ENGINE: 'go' } });
    const run = fake.lastRun();
    assert.ok(run);
    assert.deepStrictEqual(run?.args, ['check', 'a.kark']);
    assert.strictEqual(run?.cwd, '/proj');
    assert.deepStrictEqual(run?.env, { KARKAIN_ENGINE: 'go' });
  });

  it('never spawns a process', async () => {
    const fake = new FakeToolchainService('karkain', { stdout: '[]' });
    const r = await fake.run(['check', '--format=json', 'a.kark']);
    assert.strictEqual(r.stdout, '[]');
    assert.strictEqual(fake.runs.length, 1);
  });

  it('switches behaviour per call so the two-engine probe can be modelled', async () => {
    const fake = new FakeToolchainService('karkain', (_run, call) =>
      call === 0 ? { code: 0, stdout: '[ok] a.kark' } : { code: 0, stdout: '[]' },
    );
    const first = await fake.run(['check', '--format=json', 'a.kark'], { env: {} });
    const second = await fake.run(['check', '--format=json', 'a.kark'], {
      env: { KARKAIN_ENGINE: 'go' },
    });
    assert.strictEqual(first.stdout, '[ok] a.kark');
    assert.strictEqual(second.stdout, '[]');
    assert.deepStrictEqual(fake.argvLog(), ['check --format=json a.kark', 'check --format=json a.kark']);
  });

  it('concatenates stdout and stderr into combined', async () => {
    const fake = new FakeToolchainService('karkain', { stdout: 'A', stderr: 'B' });
    const r = await fake.run(['test', 'a.kark']);
    assert.strictEqual(r.combined, 'AB');
  });

  it('reports a not-installed toolchain', async () => {
    const fake = new NotInstalledToolchainService();
    const r = await fake.run(['--version']);
    assert.strictEqual(r.notFound, true);
    assert.strictEqual(r.code, null);
    assert.ok(r.spawnError);
  });

  it('satisfies the ToolchainService interface', async () => {
    const fake: ToolchainService = new FakeToolchainService();
    assert.strictEqual(typeof fake.executable(), 'string');
    assert.ok(typeof (await fake.run(['--version'])).code === 'number');
  });

  describe('timeout and cancellation parity with production', () => {
    /** A token the test drives by hand, mirroring vscode.CancellationToken. */
    function controllableToken(): {
      token: CancellationSignal;
      fire: () => void;
      preCancelled: () => CancellationSignal;
    } {
      let listener: (() => void) | undefined;
      return {
        token: {
          onCancellationRequested(l: () => void): { dispose(): void } {
            listener = l;
            return { dispose: () => undefined };
          },
        },
        fire: () => listener?.(),
        // vscode.CancellationToken fires its listener immediately on
        // subscription when cancellation was requested beforehand.
        preCancelled: () => ({
          onCancellationRequested(l: () => void): { dispose(): void } {
            l();
            return { dispose: () => undefined };
          },
        }),
      };
    }

    it('honours a timeout while pending and reports a null code', async () => {
      const fake = new FakeToolchainService('karkain', { pending: new Promise<void>(() => undefined) });
      const r = await fake.run(['test', 'a.kark'], { timeoutMs: 20 });
      assert.strictEqual(r.timedOut, true);
      assert.strictEqual(r.cancelled, false);
      // Production reports a null code for a killed child, so the fake must too.
      assert.strictEqual(r.code, null);
    });

    it('does not report a timeout for work that finishes in time', async () => {
      const fake = new FakeToolchainService('karkain', { pending: Promise.resolve() });
      const r = await fake.run(['check', 'a.kark'], { timeoutMs: 5000 });
      assert.strictEqual(r.timedOut, false);
      assert.strictEqual(r.cancelled, false);
      assert.strictEqual(r.code, 0);
    });

    it('honours cancellation while pending', async () => {
      const { token, fire } = controllableToken();
      const fake = new FakeToolchainService('karkain', { pending: new Promise<void>(() => undefined) });
      const pending = fake.run(['test', 'a.kark'], { token });
      fire();
      const r = await pending;
      assert.strictEqual(r.cancelled, true);
      assert.strictEqual(r.timedOut, false);
      assert.strictEqual(r.code, null);
    });

    it('honours cancellation requested before run', async () => {
      const fake = new FakeToolchainService('karkain', { pending: new Promise<void>(() => undefined) });
      const r = await fake.run(['test', 'a.kark'], { token: controllableToken().preCancelled() });
      assert.strictEqual(r.cancelled, true);
      assert.strictEqual(r.code, null);
    });

    it('leaves a non-cancelled run untouched', async () => {
      const { token, fire } = controllableToken();
      const fake = new FakeToolchainService('karkain', { pending: Promise.resolve(), stdout: '[]' });
      const r = await fake.run(['check', '--format=json', 'a.kark'], { token });
      fire();
      assert.strictEqual(r.cancelled, false);
      assert.strictEqual(r.timedOut, false);
      assert.strictEqual(r.code, 0);
      assert.strictEqual(r.stdout, '[]');
    });

    it('agrees with NodeToolchainService on normal, timeout and cancelled results', async () => {
      // The contract the seam promises: for the three outcomes the extension
      // branches on, the fake and the real service must report identical
      // fields. Real processes stand in for production here.
      const real = new NodeToolchainService(() => process.execPath);
      const normal = await real.run(['-e', 'process.exit(0);']);
      const timedOut = await real.run(['-e', 'setTimeout(() => {}, 60000);'], { timeoutMs: 150 });
      const { token, fire } = controllableToken();
      const pendingReal = real.run(['-e', 'setTimeout(() => {}, 60000);'], { token });
      fire();
      const cancelled = await pendingReal;

      const fakeNormal = await new FakeToolchainService().run(['--version']);
      const fakeTimedOut = await new FakeToolchainService('karkain', { pending: never() }).run(
        ['--version'],
        { timeoutMs: 20 },
      );
      const fakeCancelled = await new FakeToolchainService('karkain', { pending: never() }).run(
        ['--version'],
        { token: controllableToken().preCancelled() },
      );

      const shape = (r: ToolchainRunResult) => ({
        timedOut: r.timedOut,
        cancelled: r.cancelled,
        codeIsNull: r.code === null,
      });
      assert.deepStrictEqual(shape(fakeNormal), shape(normal), 'normal result must agree');
      assert.deepStrictEqual(shape(fakeTimedOut), shape(timedOut), 'timeout result must agree');
      assert.deepStrictEqual(shape(fakeCancelled), shape(cancelled), 'cancelled result must agree');
    });
  });

  describe('transcript ordering', () => {
    it('defaults combined to stdout then stderr', async () => {
      const fake = new FakeToolchainService('karkain', { stdout: 'A', stderr: 'B' });
      assert.strictEqual((await fake.run(['test', 'a.kark'])).combined, 'AB');
    });

    it('can model an interleave that concatenation would get wrong', async () => {
      // testing.ts parses PASS/FAIL out of this transcript, so a run whose
      // stderr lands before its stdout cannot be expressed by `stdout+stderr`.
      const fake = new FakeToolchainService('karkain', {
        stdout: '  PASS test_add\n',
        stderr: '=== Running tests in a_test.kark ===\n',
        combined: '=== Running tests in a_test.kark ===\n  PASS test_add\n',
      });
      const r = await fake.run(['test', 'a_test.kark']);
      assert.strictEqual(r.combined, '=== Running tests in a_test.kark ===\n  PASS test_add\n');
      // The parsed result must survive that interleave.
      assert.deepStrictEqual(
        parseTestResults(r.combined).map((x) => [x.name, x.status]),
        [['test_add', 'passed']],
      );
    });
  });
});

/** A promise that never settles, standing in for a hung toolchain. */
function never(): Promise<void> {
  return new Promise<void>(() => undefined);
}
