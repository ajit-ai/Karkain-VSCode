// Manual LSP gate: replays the language-server handshake against a REAL
// `karkain` binary and asserts the verified capability surface. Not run in CI
// (CI has no toolchain); run locally:
//   npm run test:lsp-smoke -- <path-to-karkain>
//   npm run test:lsp-smoke:proxy -- <path-to-karkain>
// Exits non-zero with clear evidence on the first failing assertion.
//
// Modes:
//   (default)       raw server, no shim. Reports the Karkain empty-envelope
//                   defect as evidence: `shutdown` (and any unresolvable
//                   hover/definition) will FAIL the envelope assertion. That
//                   failure is expected on Karkain 1.x and documents the
//                   defect against this binary.
//   --through-proxy the same handshake through out/lsp-proxy.js (the shim the
//                   extension ships). Every assertion must pass; this is the
//                   release gate. Exits 0 only when the full surface is clean.
//   --proxy-path P  override the proxy location (defaults to out/lsp-proxy.js
//                   next to this script's package root).
//
// Protocol handling is strict on purpose: a server that answers with neither
// result nor error is reported with the raw frame, never "passes" silently.
import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const bin = positional[0];
const throughProxy = args.includes('--through-proxy');
const proxyPathFlag = args.find((a) => a.startsWith('--proxy-path='));
const proxyPath = proxyPathFlag
  ? proxyPathFlag.slice('--proxy-path='.length)
  : join(root, 'out', 'lsp-proxy.js');
const smokeFile = positional[1] ?? join(root, 'fixtures', 'lsp', 'smoke.kark');
const brokenFile = positional[2] ?? join(root, 'fixtures', 'diagnostics', 'bad.kark');
if (!bin) {
  console.error(
    'usage: node scripts/lsp-smoke.mjs <path-to-karkain> [smoke.kark] [bad.kark] [--through-proxy] [--proxy-path=P]',
  );
  process.exit(2);
}
if (throughProxy) {
  const { existsSync } = await import('fs');
  if (!existsSync(proxyPath)) {
    console.error(`proxy not found at ${proxyPath}; run \`npm run compile\` first (or pass --proxy-path=P)`);
    process.exit(2);
  }
}

const failures = [];
function check(name, cond, detail = '') {
  const suffix = detail ? ` -- ${detail}` : '';
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${suffix}`);
  if (!cond) failures.push(name);
}

// ---- JSON-RPC protocol validator (no server dependency) ----

const VALID_JSONRPC = '2.0';

function validateResponseEnvelope(msg, requestId) {
  const fail = (type, message) => ({ ok: false, violation: { type, message, raw: safeStringify(msg) } });
  if (msg === null || typeof msg !== 'object' || Array.isArray(msg)) {
    return fail('malformed-envelope', 'response body is not a JSON object');
  }
  if (Object.prototype.hasOwnProperty.call(msg, 'jsonrpc') && msg.jsonrpc !== VALID_JSONRPC) {
    return fail(
      'invalid-jsonrpc-version',
      `expected jsonrpc="${VALID_JSONRPC}", got ${JSON.stringify(msg.jsonrpc)}`,
    );
  }
  const hasId = Object.prototype.hasOwnProperty.call(msg, 'id');
  const hasResult = Object.prototype.hasOwnProperty.call(msg, 'result');
  const hasError = Object.prototype.hasOwnProperty.call(msg, 'error');
  if (hasId && msg.id !== requestId) {
    return fail('mismatched-response-id', `expected request id=${requestId}, got ${JSON.stringify(msg.id)}`);
  }
  if (hasResult && hasError) {
    return fail('unexpected-both-result-and-error', 'response has both result and error');
  }
  if (!hasResult && !hasError) {
    return fail('response-with-neither-result-nor-error', 'response has neither result nor error');
  }
  if (hasError && msg.error !== null && (typeof msg.error !== 'object' || Array.isArray(msg.error))) {
    return fail('invalid-error-structure', 'error is not a JSON object');
  }
  if (hasError && msg.error !== null && typeof msg.error === 'object' && !Array.isArray(msg.error)) {
    const e = msg.error;
    const codeOk = Object.prototype.hasOwnProperty.call(e, 'code') && typeof e.code === 'number';
    const messageOk = Object.prototype.hasOwnProperty.call(e, 'message') && typeof e.message === 'string';
    if (!codeOk || !messageOk) {
      return fail('invalid-error-structure', `error missing numeric code=${!codeOk}, message=${!messageOk}`);
    }
  }
  return { ok: true, violation: null };
}

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function frame(obj) {
  const b = Buffer.from(JSON.stringify(obj));
  return Buffer.concat([Buffer.from(`Content-Length: ${b.length}\r\n\r\n`, 'utf8'), b]);
}

// ---- Content-Length frame parser ----

function parseFrames(buf) {
  const messages = [];
  let offset = 0;
  for (;;) {
    const rest = buf.subarray(offset);
    const headerEnd = rest.indexOf('\r\n\r\n');
    if (headerEnd < 0) {
      if (rest.length > 64 * 1024) return { messages, remaining: Buffer.alloc(0), malformed: true };
      return { messages, remaining: Buffer.from(rest), malformed: false };
    }
    const headerText = rest.subarray(0, headerEnd).toString('utf8');
    const m = /(?:^|\r?\n)[ \t]*Content-Length:[ \t]*(\d+)/i.exec(headerText);
    if (!m) return { messages, remaining: Buffer.alloc(0), malformed: true };
    const len = Number.parseInt(m[1], 10);
    if (!Number.isFinite(len) || len > 64 * 1024 * 1024) {
      return { messages, remaining: Buffer.alloc(0), malformed: true };
    }
    const bodyStart = offset + headerEnd + 4;
    if (buf.length < bodyStart + len) {
      return { messages, remaining: Buffer.from(buf.subarray(offset)), malformed: false };
    }
    const body = buf.subarray(bodyStart, bodyStart + len);
    try {
      messages.push(JSON.parse(body.toString('utf8')));
    } catch {
      return { messages, remaining: Buffer.alloc(0), malformed: true };
    }
    offset = bodyStart + len;
  }
}

// ---- stdio session over a spawned LSP server ----

class LspSession {
  constructor(proc) {
    this.proc = proc;
    this.buf = Buffer.alloc(0);
    this.nextId = 1;
    this.pending = new Map();
    this.stderr = '';
    this.notifications = [];
    this.protocolError = null;
    this.finished = false;
    this.exitCode = null;
    proc.stdout.on('data', (d) => {
      this.buf = Buffer.concat([this.buf, d]);
      const { messages, remaining, malformed } = parseFrames(this.buf);
      if (malformed) {
        this.protocolError = 'malformed Content-Length or JSON frame detected';
        this.rejectPending(this.protocolError);
        this.buf = Buffer.alloc(0);
        return;
      }
      this.buf = remaining;
      for (const msg of messages) {
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const entry = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          entry.resolve(msg);
        } else if (msg.method) {
          this.notifications.push(msg);
        } else {
          this.protocolError = `response without id, method, result or error: ${safeStringify(msg).slice(0, 200)}`;
          this.rejectPending(this.protocolError);
        }
      }
    });
    proc.stderr.on('data', (d) => {
      this.stderr += d.toString();
    });
    proc.on('error', (e) => {
      this.protocolError = `spawn error: ${e.message}`;
      this.rejectPending(this.protocolError);
    });
    proc.on('close', (code) => {
      this.finished = true;
      this.exitCode = code;
      this.rejectPending(`server exited (code ${code})`);
    });
  }

  rejectPending(reason) {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(reason));
    }
    this.pending.clear();
  }

  request(method, params, timeoutMs = 20000) {
    return new Promise((resolvePromise, rejectPromise) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          rejectPromise(new Error(`timeout waiting for ${method}`));
        }
      }, timeoutMs);
      this.pending.set(id, {
        resolve: resolvePromise,
        reject: rejectPromise,
        timer,
      });
      try {
        this.proc.stdin.write(frame({ jsonrpc: '2.0', id, method, params }));
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        rejectPromise(new Error(`failed to send ${method}: ${e.message}`));
      }
    });
  }

  notify(method, params) {
    try {
      this.proc.stdin.write(frame({ jsonrpc: '2.0', method, params }));
    } catch (e) {
      this.protocolError = `failed to send notification ${method}: ${e.message}`;
    }
  }

  async finish() {
    if (this.finished) return;
    try {
      this.proc.stdin.end();
    } catch {
      // Already closed; fall through to SIGKILL below.
    }
    const closed = await new Promise((r) => {
      const t = setTimeout(() => {
        try {
          this.proc.kill('SIGKILL');
        } catch {
          // Ignore: process already gone.
        }
        r(false);
      }, 2000);
      this.proc.once('close', () => {
        clearTimeout(t);
        r(true);
      });
    });
    this.finished = true;
    return closed;
  }
}

const toUri = (f) => 'file:///' + resolve(f).replace(/\\/g, '/');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- harness ----

const args0 = ['lsp'];
const proc = throughProxy
  ? spawn(process.execPath, [proxyPath, bin, ...args0], { stdio: ['pipe', 'pipe', 'pipe'] })
  : spawn(bin, args0, { stdio: ['pipe', 'pipe', 'pipe'] });
const session = new LspSession(proc);

console.log(`mode: ${throughProxy ? `through proxy (${proxyPath})` : 'raw server'}`);
console.log(`server: ${bin}`);

try {
  const init = await session.request(
    'initialize',
    { processId: process.pid, rootUri: null, capabilities: {} },
    20000,
  );
  const envelopeOk = validateResponseEnvelope(init, 1);
  check('initialize response envelope valid', envelopeOk.ok, envelopeOk.violation?.message);
  check(
    'server identifies as karkain-lsp',
    init.result?.serverInfo?.name === 'karkain-lsp',
    safeStringify(init.result?.serverInfo),
  );
  const version = init.result?.serverInfo?.version ?? '';
  check(
    'server version >= 1.1.0',
    /^1\.(\d+)\./.test(version) && compareVersions(version, '1.1.0') >= 0,
    version,
  );

  const caps = init.result?.capabilities ?? {};
  for (const [key, label] of [
    ['completionProvider', 'completion'],
    ['hoverProvider', 'hover'],
    ['definitionProvider', 'definition'],
    ['documentSymbolProvider', 'documentSymbol'],
    ['semanticTokensProvider', 'semanticTokens'],
    ['formattingProvider', 'formatting'],
  ]) {
    check(`capability ${label}`, caps[key] !== undefined && caps[key] !== null && caps[key] !== false);
  }

  session.notify('initialized', {});
  await sleep(300);

  const smokeUri = toUri(smokeFile);
  const smokeText = readFileSync(smokeFile, 'utf8');
  session.notify('textDocument/didOpen', {
    textDocument: { uri: smokeUri, languageId: 'karkain', version: 1, text: smokeText },
  });
  await sleep(2500);

  const push = session.notifications.find(
    (n) => n.method === 'textDocument/publishDiagnostics' && n.params?.uri === smokeUri,
  );
  check('push diagnostics received for clean file', !!push);
  check(
    'clean file reports zero diagnostics',
    Array.isArray(push?.params?.diagnostics),
    safeStringify(push?.params),
  );
  await sleep(200);

  const brokenUri = toUri(brokenFile);
  session.notify('textDocument/didOpen', {
    textDocument: {
      uri: brokenUri,
      languageId: 'karkain',
      version: 1,
      text: readFileSync(brokenFile, 'utf8'),
    },
  });
  await sleep(2500);

  const badPush = session.notifications.find(
    (n) =>
      n.method === 'textDocument/publishDiagnostics' &&
      n.params?.uri === brokenUri &&
      n.params.diagnostics?.length > 0,
  );
  check('broken file pushes diagnostics', !!badPush);
  const d0 = badPush?.params?.diagnostics?.[0];
  check(
    'pushed diagnostic carries range+severity+source',
    !!d0?.range && typeof d0?.severity === 'number' && typeof d0?.source === 'string',
    safeStringify(d0)?.slice(0, 200),
  );

  const comp = await session.request(
    'textDocument/completion',
    { textDocument: { uri: smokeUri }, position: { line: 11, character: 4 } },
    15000,
  );
  check('completion returns items', Array.isArray(comp.result?.items) && comp.result.items.length > 0);

  // Hover over a RESOLVED symbol: every Karkain 1.x build answers with a
  // valid MarkupContent result.
  const hov = await session.request(
    'textDocument/hover',
    { textDocument: { uri: smokeUri }, position: { line: 11, character: 11 } },
    15000,
  );
  const hoverEnvelope = validateResponseEnvelope(hov, 3);
  check('hover (resolved) response envelope valid', hoverEnvelope.ok, hoverEnvelope.violation?.message);
  const contents = hov.result?.contents;
  const hoverValue = typeof contents?.value === 'string' ? contents.value : '';
  check(
    'hover returns real MarkupContent mentioning the declaration',
    hoverValue.includes('func add(a, b)'),
    safeStringify(hov.result)?.slice(0, 200),
  );

  // Hover over a blank line: the Karkain server answers with NEITHER result
  // NOR error (empty envelope). Raw mode must surface that as a failure with
  // evidence; proxy mode must repair it to result: null.
  const blank = await session.request(
    'textDocument/hover',
    { textDocument: { uri: smokeUri }, position: { line: 6, character: 0 } },
    15000,
  );
  const blankEnvelope = validateResponseEnvelope(blank, 4);
  if (throughProxy) {
    check(
      'hover (unresolvable) repaired to result:null by the shim',
      blankEnvelope.ok && blank.result === null,
      safeStringify(blank),
    );
  } else {
    check(
      'hover (unresolvable) envelope valid [expected to FAIL raw: known server defect]',
      blankEnvelope.ok,
      safeStringify(blank),
    );
  }

  const def = await session.request(
    'textDocument/definition',
    { textDocument: { uri: smokeUri }, position: { line: 11, character: 11 } },
    15000,
  );
  check(
    'definition jumps to the declaration',
    def.result?.range?.start?.line === 3,
    safeStringify(def.result || def.error)?.slice(0, 200),
  );

  const syms = await session.request(
    'textDocument/documentSymbol',
    { textDocument: { uri: smokeUri } },
    15000,
  );
  const names = safeStringify(syms.result ?? []);
  check('documentSymbol lists add and Counter', names.includes('"add"') && names.includes('"Counter"'));

  const toks = await session.request(
    'textDocument/semanticTokens/full',
    { textDocument: { uri: smokeUri } },
    15000,
  );
  check('semanticTokens returns delta data', Array.isArray(toks.result?.data) && toks.result.data.length > 0);

  const shutdownId = session.nextId;
  const shut = await session.request('shutdown', {}, 15000);
  const shutdownEnvelope = validateResponseEnvelope(shut, shutdownId);
  if (throughProxy) {
    check(
      'shutdown envelope carries result (repaired by the shim)',
      shutdownEnvelope.ok && shut.result === null,
      safeStringify(shut),
    );
    // With the repair in place the client can complete the LSP teardown:
    // exit notification, then a clean process end.
    session.notify('exit', {});
    const closed = await session.finish();
    check(
      'server exits cleanly once stdin closes (exit code 0)',
      closed === true && session.exitCode === 0,
      `closed=${closed} code=${session.exitCode}`,
    );
  } else {
    check(
      'shutdown envelope valid [expected to FAIL raw: known server defect]',
      shutdownEnvelope.ok,
      safeStringify(shut),
    );
    session.notify('exit', {});
    await session.finish();
  }

  if (session.protocolError) {
    failures.push('protocol');
    console.error(`FAIL protocol: ${session.protocolError}`);
  }
} catch (e) {
  console.error(`FAIL exception: ${e.message}`);
  failures.push('exception');
  await session.finish().catch(() => {});
} finally {
  try {
    session.proc.kill('SIGKILL');
  } catch {
    // Already gone.
  }
}

if (failures.length === 0) {
  console.error('\nLSP smoke gate: PASS');
  process.exitCode = 0;
} else {
  console.error(`\nLSP smoke gate: FAIL (${failures.length} failing assertion(s): ${failures.join(', ')})`);
  if (session.stderr.trim()) {
    console.error(`Server stderr (tail):\n${session.stderr.slice(-4000)}`);
  }
  console.error(
    throughProxy
      ? 'The release gate requires every assertion to pass through the shim. See the failures above.'
      : 'Raw-mode failures on shutdown/unresolvable-hover are EXPECTED on Karkain 1.x (server emits an empty envelope). Re-run with --through-proxy for the release gate.',
  );
  process.exitCode = 1;
}

function compareVersions(a, b) {
  const pa = a.split('.').map((s) => parseInt(s, 10));
  const pb = b.split('.').map((s) => parseInt(s, 10));
  for (let i = 0; i < 3; i++) {
    const x = Number.isFinite(pa[i]) ? pa[i] : 0;
    const y = Number.isFinite(pb[i]) ? pb[i] : 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}
