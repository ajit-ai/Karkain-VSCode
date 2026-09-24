// Manual LSP gate: replays the language-server handshake against a REAL
// `karkain` binary and asserts the verified 1.1.0 surface. Not run in CI
// (CI has no toolchain); run locally with a 1.1.0+ binary:
//   npm run test:lsp-smoke -- <path-to-karkain>
// Exits non-zero with a clear message on the first failed assertion.
import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bin = process.argv[2];
const smokeFile = process.argv[3] ?? join(root, 'fixtures', 'lsp', 'smoke.kark');
const brokenFile = process.argv[4] ?? join(root, 'fixtures', 'diagnostics', 'bad.kark');
if (!bin) {
  console.error('usage: node scripts/lsp-smoke.mjs <path-to-karkain> [smoke.kark] [bad.kark]');
  process.exit(2);
}

const failures = [];
function check(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail && cond ? '' : ' -- ' + detail}`);
  if (!cond) failures.push(name);
}

const proc = spawn(bin, ['lsp'], { stdio: ['pipe', 'pipe', 'ignore'] });
let buf = Buffer.alloc(0);
let nextId = 1;
const pending = new Map();
const notes = [];
const frame = (o) => {
  const b = Buffer.from(JSON.stringify(o));
  return Buffer.concat([Buffer.from(`Content-Length: ${b.length}\r\n\r\n`), b]);
};
const send = (o) => proc.stdin.write(frame(o));
const request = (method, params, timeoutMs = 20000) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    send({ jsonrpc: '2.0', id, method, params });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }
    }, timeoutMs);
  });
proc.stdout.on('data', (d) => {
  buf = Buffer.concat([buf, d]);
  for (;;) {
    const h = buf.indexOf('\r\n\r\n');
    if (h < 0) return;
    const m = /Content-Length: (\d+)/i.exec(buf.subarray(0, h).toString());
    if (!m) return;
    const len = +m[1];
    if (buf.length < h + 4 + len) return;
    const msg = JSON.parse(buf.subarray(h + 4, h + 4 + len).toString());
    buf = buf.subarray(h + 4 + len);
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id).resolve(msg);
      pending.delete(msg.id);
    } else if (msg.method) {
      notes.push(msg);
    }
  }
});
proc.on('error', (e) => {
  console.error(`FAIL spawn: ${e.message}`);
  process.exit(1);
});

const toUri = (f) => 'file:///' + resolve(f).replace(/\\/g, '/');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const init = await request('initialize', { processId: process.pid, rootUri: null, capabilities: {} });
  const caps = init.result?.capabilities ?? {};
  const info = init.result?.serverInfo ?? {};
  check('server identifies as karkain-lsp', info.name === 'karkain-lsp', JSON.stringify(info));
  check(
    'server version >= 1.1.0',
    /^1\.(\d+)\./.test(info.version ?? '') && info.version >= '1.1.0',
    info.version,
  );
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
  send({ jsonrpc: '2.0', method: 'initialized', params: {} });

  const smokeUri = toUri(smokeFile);
  const smokeText = readFileSync(smokeFile, 'utf8');
  send({
    jsonrpc: '2.0',
    method: 'textDocument/didOpen',
    params: { textDocument: { uri: smokeUri, languageId: 'karkain', version: 1, text: smokeText } },
  });
  await sleep(2500);
  const push = notes.find(
    (n) => n.method === 'textDocument/publishDiagnostics' && n.params?.uri === smokeUri,
  );
  check('push diagnostics received for clean file', !!push);
  check(
    'clean file reports zero diagnostics',
    Array.isArray(push?.params?.diagnostics),
    JSON.stringify(push?.params),
  );

  const brokenUri = toUri(brokenFile);
  send({
    jsonrpc: '2.0',
    method: 'textDocument/didOpen',
    params: {
      textDocument: {
        uri: brokenUri,
        languageId: 'karkain',
        version: 1,
        text: readFileSync(brokenFile, 'utf8'),
      },
    },
  });
  await sleep(2500);
  const badPush = notes.find(
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
    JSON.stringify(d0)?.slice(0, 200),
  );

  const comp = await request('textDocument/completion', {
    textDocument: { uri: smokeUri },
    position: { line: 11, character: 4 },
  });
  check('completion returns items', Array.isArray(comp.result?.items) && comp.result.items.length > 0);

  const hov = await request('textDocument/hover', {
    textDocument: { uri: smokeUri },
    position: { line: 11, character: 11 },
  });
  check(
    'hover resolves the add call',
    typeof hov.result?.contents?.value === 'string' && hov.result.contents.value.includes('func add(a, b)'),
    JSON.stringify(hov.result || hov.error)?.slice(0, 200),
  );

  const def = await request('textDocument/definition', {
    textDocument: { uri: smokeUri },
    position: { line: 11, character: 11 },
  });
  check(
    'definition jumps to the declaration',
    def.result?.range?.start?.line === 3,
    JSON.stringify(def.result || def.error)?.slice(0, 200),
  );

  const syms = await request('textDocument/documentSymbol', { textDocument: { uri: smokeUri } });
  const names = JSON.stringify(syms.result ?? []);
  check('documentSymbol lists add and Counter', names.includes('"add"') && names.includes('"Counter"'));

  const toks = await request('textDocument/semanticTokens/full', { textDocument: { uri: smokeUri } });
  check('semanticTokens returns delta data', Array.isArray(toks.result?.data) && toks.result.data.length > 0);

  await request('shutdown', {});
  send({ jsonrpc: '2.0', method: 'exit', params: {} });
} catch (e) {
  console.error(`FAIL exception: ${e.message}`);
  failures.push('exception');
}
proc.stdin.end();
setTimeout(() => proc.kill(), 1000);
await sleep(1500);
if (failures.length > 0) {
  console.error(`\n${failures.length} failing assertion(s): ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\nLSP smoke gate: all assertions passed.');
