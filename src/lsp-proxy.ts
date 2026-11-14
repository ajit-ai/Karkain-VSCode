// Standalone protocol-repair proxy between the VS Code extension host and
// the Karkain language server (`karkain lsp`). Compiled to out/lsp-proxy.js.
//
// Why this exists: the Karkain LSP server emits `{"jsonrpc":"2.0","id":N}`
// with neither result nor error for every handler that produces no value
// (unresolvable hover/definition/documentSymbol — timing-dependent — and
// every shutdown, unconditionally). vscode-languageclient classifies that
// message as neither a response nor a notification and rejects the pending
// request with "The received response has neither a result nor an error
// property.", which also aborts the client's stop() path before the `exit`
// notification is sent, leaving the server's pipe to break abnormally
// (observed as exit code 1).
//
// This proxy sits on the server→extension-host byte stream and rewrites ONLY
// that exact envelope to include `"result": null`, which is what the JSON-RPC
// 2.0 specification and the LSP mandate. Once Karkain fixes the server's
// `omitempty` on JSONRPCResponse.Result, every message passes through and this
// process is a zero-effect pipe.
//
// Design rules:
//   * No imports beyond Node builtins + ./jsonrpc-repair (this file ships in
//     the VSIX as a standalone script; it must not become a second extension
//     entry point).
//   * Nothing that belongs to the client→server stream is ever rewritten.
//   * The client→server stream is forwarded byte-for-byte.
//   * Repair notices go to stderr (the client forwards it to the output
//     channel) — never to stdout, which belongs to the JSON-RPC stream.
//   * If the stream cannot be framed, bytes pass through verbatim and the
//     proxy says so on stderr once; it never guesses at message contents.
//   * Signals and EOF are forwarded so the server's process lifecycle
//     (kill, exit code) is preserved as closely as a wrapper allows.

import { spawn } from 'child_process';
import { appendFileSync } from 'fs';
import { extractFrames, frameMessage, repairServerMessageBody } from './jsonrpc-repair';

const argv = process.argv.slice(2);
const serverCommand = argv[0];
const serverArgs = argv.slice(1);

if (!serverCommand) {
  process.stderr.write('[lsp-proxy] usage: node lsp-proxy.js <karkain executable> [server args...]\n');
  process.exit(2);
}

let child: ReturnType<typeof spawn>;
try {
  child = spawn(serverCommand, serverArgs, {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
} catch (e) {
  process.stderr.write(`[lsp-proxy] failed to start ${serverCommand}: ${(e as Error).message}\n`);
  process.exit(127);
}

child.on('error', (e) => {
  process.stderr.write(`[lsp-proxy] failed to start ${serverCommand}: ${e.message}\n`);
  process.exit(127);
});

// ---- client (extension host) → server: pass through verbatim ----
// stdio is ['pipe','pipe','pipe'], so these are always streams, not null.
const childStdin = child.stdin;
const childStdout = child.stdout;
const childStderr = child.stderr;
if (!childStdin || !childStdout || !childStderr) {
  process.stderr.write('[lsp-proxy] server stdio was not available\n');
  process.exit(127);
}
process.stdin.on('data', (chunk: Buffer) => {
  if (!childStdin.destroyed) {
    childStdin.write(chunk);
  }
});
process.stdin.on('end', () => {
  childStdin.end();
});
process.stdin.on('error', (e: Error) => {
  process.stderr.write(`[lsp-proxy] stdin error: ${e.message}\n`);
});

// ---- server → client: frame, repair, re-frame ----
let passthrough = false;
let pending: Buffer = Buffer.alloc(0);
let repairs = 0;
let passthroughAnnounced = false;

// Optional repair-activity log. Set KARKAIN_LSP_REPAIR_LOG=/path/to/file to
// append one line per repaired response (used by the extension's health
// check). Best-effort: any failure is reported once and then ignored; the
// repair path itself never depends on the log being writable.
const repairLogPath = process.env.KARKAIN_LSP_REPAIR_LOG;
let repairLogBroken = false;
function noteRepair(note: string | undefined): void {
  if (!repairLogPath || repairLogBroken) {
    return;
  }
  try {
    appendFileSync(repairLogPath, `${new Date().toISOString()} ${note ?? 'repair'}\n`);
  } catch (e) {
    repairLogBroken = true;
    process.stderr.write(`[lsp-proxy] repair log unwritable (${(e as Error).message}); disabling it\n`);
  }
}

childStdout.on('data', (chunk: Buffer) => {
  const input = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);

  if (passthrough) {
    process.stdout.write(input);
    pending = Buffer.alloc(0);
    return;
  }

  const { bodies, remaining, malformed } = extractFrames(input);
  if (malformed) {
    if (!passthroughAnnounced) {
      passthrough = true;
      passthroughAnnounced = true;
      process.stderr.write(
        '[lsp-proxy] stream could not be framed; forwarding bytes verbatim (repair disabled for this session)\n',
      );
      process.stdout.write(input);
      pending = Buffer.alloc(0);
      return;
    }
    process.stdout.write(input);
    pending = Buffer.alloc(0);
    return;
  }

  for (const body of bodies) {
    const result = repairServerMessageBody(body);
    if (result.outcome === 'repaired') {
      repairs += 1;
      noteRepair(result.note);
      process.stderr.write(
        `[lsp-proxy] repaired malformed server response: ${result.note} (repair #${repairs})\n`,
      );
      process.stdout.write(frameMessage(result.body));
    } else {
      // 'unchanged' and 'invalid-json' both forward the body as received.
      process.stdout.write(frameMessage(result.body));
    }
  }
  pending = remaining;
});

// Server stderr belongs to the client's output channel.
childStderr.on('data', (chunk: Buffer) => process.stderr.write(chunk));

function forwardSignal(signal: NodeJS.Signals): void {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill(signal);
  }
}
process.on('SIGTERM', () => forwardSignal('SIGTERM'));
process.on('SIGINT', () => forwardSignal('SIGINT'));
// Windows: VS Code may close the pipe instead of signaling; EOF handling above covers it.

child.on('exit', (code, signal) => {
  if (repairs > 0) {
    process.stderr.write(`[lsp-proxy] session ended with ${repairs} repaired response(s)\n`);
  }
  if (signal) {
    // Mirror the death-by-signal shape as closely as possible.
    process.exit(1);
    return;
  }
  process.exit(code === null ? 1 : code);
});

// If the child dies, flush nothing: the client notices the closed pipe and
// handles it (its own error/close paths), same as if the server had died.
process.stdout.on('error', (e: Error) => {
  process.stderr.write(`[lsp-proxy] stdout error: ${e.message}\n`);
});
