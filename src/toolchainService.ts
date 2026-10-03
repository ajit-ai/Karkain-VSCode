// Karkain toolchain service — the single seam between the extension and the
// `karkain` executable.
//
// Every process invocation in this extension goes through this interface.
// Nothing else imports `child_process`. That makes the toolchain fakeable, so
// command orchestration (the engine probe, check attribution, test result
// mapping, the debug build ordering) can be tested without a real compiler.
//
// Vscode-free on purpose: the interface, the argv contract and the Node
// implementation stay unit-testable without an extension host, matching the
// rest of src/.
import { spawn } from 'child_process';

/**
 * Minimal cancellation shape. `vscode.CancellationToken` satisfies it
 * structurally, so callers may pass one directly.
 */
export interface CancellationSignal {
  onCancellationRequested(listener: () => void): { dispose(): void };
}

export interface ToolchainRunOptions {
  /** Working directory for the child process. */
  cwd?: string;
  /** Environment overlay merged over `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Kill the child after this many milliseconds. */
  timeoutMs?: number;
  /** Kills the child when signalled. */
  token?: CancellationSignal;
}

export interface ToolchainRunResult {
  /** Exit status, or null when the process was killed or never started. */
  code: number | null;
  stdout: string;
  stderr: string;
  /**
   * stdout and stderr concatenated in arrival order. The test runner and the
   * debug build report a single interleaved transcript, and some toolchain
   * output (for example Windows linker noise) is only meaningful in order.
   */
  combined: string;
  /** Set when the process could not be started at all. */
  spawnError?: string;
  /** True when the executable itself is missing (ENOENT). */
  notFound: boolean;
  /** True when the run was stopped by `timeoutMs`. */
  timedOut: boolean;
  /** True when the run was stopped by `token`. */
  cancelled: boolean;
}

/**
 * The whole toolchain surface the extension depends on. Deliberately small:
 * two members, so a fake is cheap and a real implementation has nowhere to
 * hide behaviour.
 */
export interface ToolchainService {
  /** Absolute path, or a bare name resolved through PATH by the OS. */
  executable(): string;
  run(args: string[], opts?: ToolchainRunOptions): Promise<ToolchainRunResult>;
}

export const DEFAULT_TOOLCHAIN_TIMEOUT_MS = 120000;

/**
 * Real implementation. Resolves the executable lazily on every call so a
 * `karkain.compilerPath` change takes effect without re-wiring anything.
 */
export class NodeToolchainService implements ToolchainService {
  constructor(private readonly resolveExecutable: () => string) {}

  executable(): string {
    return this.resolveExecutable();
  }

  run(args: string[], opts: ToolchainRunOptions = {}): Promise<ToolchainRunResult> {
    return new Promise<ToolchainRunResult>((resolve) => {
      let stdout = '';
      let stderr = '';
      let combined = '';
      let settled = false;
      let timedOut = false;
      let cancelled = false;

      const proc = spawn(this.resolveExecutable(), args, {
        cwd: opts.cwd,
        env: opts.env ? { ...process.env, ...opts.env } : process.env,
      });

      const finish = (code: number | null, spawnError?: string, notFound = false): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve({ code, stdout, stderr, combined, spawnError, notFound, timedOut, cancelled });
      };

      proc.stdout?.on('data', (d: unknown) => {
        const s = String(d);
        stdout += s;
        combined += s;
      });
      proc.stderr?.on('data', (d: unknown) => {
        const s = String(d);
        stderr += s;
        combined += s;
      });

      // A failed spawn reports ENOENT; anything else is a launch failure.
      proc.on('error', (err: NodeJS.ErrnoException) => {
        finish(null, err.message, err.code === 'ENOENT');
      });
      proc.on('close', (code: number | null) => {
        finish(code);
      });

      const timer =
        opts.timeoutMs === undefined
          ? undefined
          : setTimeout(() => {
              timedOut = true;
              proc.kill();
            }, opts.timeoutMs);

      const subscription = opts.token?.onCancellationRequested(() => {
        cancelled = true;
        proc.kill();
      });

      function cleanup(): void {
        if (timer !== undefined) {
          clearTimeout(timer);
        }
        subscription?.dispose();
      }
    });
  }
}
