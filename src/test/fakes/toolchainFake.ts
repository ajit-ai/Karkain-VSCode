// In-memory ToolchainService for tests.
//
// Lives under src/test/ so it compiles to out/test/fakes/, which .vscodeignore
// already excludes from the VSIX. It never touches child_process.
import { ToolchainRunOptions, ToolchainRunResult, ToolchainService } from '../../toolchainService';

export interface RecordedRun {
  executable: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface FakeResponse {
  code?: number | null;
  stdout?: string;
  stderr?: string;
  /**
   * Ordered transcript. The real service appends stdout and stderr in arrival
   * order, so a plain concatenation is only correct when the two streams are
   * known to arrive in that order. Pass this to model an interleave that
   * `stdout + stderr` would get wrong. Defaults to `stdout + stderr`.
   */
  combined?: string;
  /** Reported as a spawn failure; `notFound` marks it as a missing binary. */
  spawnError?: string;
  notFound?: boolean;
  /**
   * Keeps the run pending until this settles, modelling a slow or hung
   * toolchain without spawning anything. Without it the run resolves
   * immediately, so a timeout or cancellation has nothing to interrupt and is
   * reported as `false` — exactly as production behaves for a fast child.
   */
  pending?: Promise<void>;
}

type Responder = FakeResponse | ((run: RecordedRun, call: number) => FakeResponse);

export class FakeToolchainService implements ToolchainService {
  readonly runs: RecordedRun[] = [];
  private responder: Responder;
  private exe: string;

  constructor(executable = 'karkain', responder: Responder = {}) {
    this.exe = executable;
    this.responder = responder;
  }

  executable(): string {
    return this.exe;
  }

  setExecutable(executable: string): void {
    this.exe = executable;
  }

  /** Replaces the behaviour for subsequent runs. */
  respondWith(responder: Responder): void {
    this.responder = responder;
  }

  /** Argv of the most recent run, for assertions. */
  lastRun(): RecordedRun | undefined {
    return this.runs[this.runs.length - 1];
  }

  /** Every recorded argv joined, for substring assertions. */
  argvLog(): string[] {
    return this.runs.map((r) => r.args.join(' '));
  }

  async run(args: string[], opts: ToolchainRunOptions = {}): Promise<ToolchainRunResult> {
    const record: RecordedRun = {
      executable: this.exe,
      args,
      cwd: opts.cwd,
      env: opts.env,
    };
    this.runs.push(record);
    const call = this.runs.length - 1;
    const r = typeof this.responder === 'function' ? this.responder(record, call) : this.responder;

    // Mirror NodeToolchainService: the two listeners race, the first one to
    // fire wins, and a killed child resolves with a null exit code.
    let timedOut = false;
    let cancelled = false;

    if (r.pending !== undefined) {
      let interrupt: (kind: 'timeout' | 'cancel') => void = () => undefined;
      const stopped = new Promise<void>((resolve) => {
        interrupt = (kind) => {
          if (kind === 'timeout') {
            timedOut = true;
          } else {
            cancelled = true;
          }
          resolve();
        };
      });
      const timer =
        opts.timeoutMs === undefined ? undefined : setTimeout(() => interrupt('timeout'), opts.timeoutMs);
      // An already-cancelled token must win even before any work is done.
      const subscription = opts.token?.onCancellationRequested(() => interrupt('cancel'));
      await Promise.race([r.pending, stopped]);
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      subscription?.dispose();
    } else {
      // Nothing to wait on, so the only cancellation observable is one that
      // predate the work: a token already cancelled fires its listener on
      // subscription, which is exactly the case this models. Production agrees
      // because a child that has already exited cannot be killed.
      const subscription = opts.token?.onCancellationRequested(() => {
        cancelled = true;
      });
      subscription?.dispose();
    }

    const stdout = r.stdout ?? '';
    const stderr = r.stderr ?? '';
    return {
      // `??` would turn an explicit null (process never started) into 0.
      // A timed-out or cancelled child is killed, so it reports a null code.
      code: timedOut || cancelled ? null : r.code === undefined ? 0 : r.code,
      stdout,
      stderr,
      combined: r.combined ?? `${stdout}${stderr}`,
      spawnError: r.spawnError,
      notFound: r.notFound ?? false,
      timedOut,
      cancelled,
    };
  }
}

/** A ToolchainService that always fails to start, as when karkain is absent. */
export class NotInstalledToolchainService extends FakeToolchainService {
  constructor() {
    super('karkain', {
      code: null,
      spawnError: 'spawn karkain ENOENT',
      notFound: true,
    });
  }
}
