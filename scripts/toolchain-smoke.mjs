// Manual toolchain gate: asserts every CLI contract the extension relies on
// against a REAL `karkain` binary. Not run in CI (CI has no toolchain):
//   npm run test:toolchain-smoke -- <path-to-karkain>
// Probes inherit this script's CWD on purpose: the default (kcc) engine
// resolves its compiler tree via the process working directory, so source
// builds need CWD inside the Karkain tree or KARKAIN_KCC set (the script
// aborts with setup instructions otherwise). Release-installed toolchains
// are CWD-independent. All file-mutating probes run on temp copies (fmt
// rewrites in place). Exits non-zero on the first failed assertion.
import { execFileSync, spawnSync } from 'child_process';
import { copyFileSync, existsSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bin = process.argv[2];
if (!bin || !existsSync(bin)) {
  console.error('usage: node scripts/toolchain-smoke.mjs <path-to-karkain>');
  process.exit(2);
}

const failures = [];
function check(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ' -- ' + detail}`);
  if (!cond) failures.push(name);
}

function run(args, extraEnv = {}) {
  return spawnSync(bin, args, { encoding: 'utf8', env: { ...process.env, ...extraEnv } });
}

function isolatedCopy(srcRel) {
  const dir = mkdtempSync(join(tmpdir(), 'karkain-smoke-'));
  const name = srcRel.split('/').pop();
  const dst = join(dir, name);
  copyFileSync(join(root, srcRel), dst);
  return { dir, dst };
}

// 1. Version banner shape the extension parses.
const ver = run(['--version']);
check(
  'version banner parses',
  ver.status === 0 && /Karkain Compiler v\d+\.\d+\.\d+ \(\S+\/\S+/.test(ver.stdout),
  ver.stdout.trim().slice(0, 120),
);
const verMatch = /Karkain Compiler v(\d+\.\d+\.\d+)/.exec(ver.stdout);
check('toolchain is 1.1.0+', !!verMatch && verMatch[1] >= '1.1.0', verMatch?.[1] ?? '(none)');

// 2. check exits: 0 clean, 3 invalid.
const good = isolatedCopy('fixtures/hello-world/hello.kark');
const bad = isolatedCopy('fixtures/diagnostics/bad.kark');
const goodCheck = run(['check', good.dst]);
if (goodCheck.status === 6 && /cannot locate src\/compiler/.test(goodCheck.stdout + goodCheck.stderr)) {
  console.error(
    'SETUP REQUIRED: this source-built toolchain needs its compiler tree: ' +
      'set KARKAIN_KCC to the Karkain source directory or run this script with CWD inside it. ' +
      'Release-installed toolchains do not need this.',
  );
  process.exit(3);
}
check('check clean exits 0', goodCheck.status === 0, `exit ${goodCheck.status}`);
const badCheck = run(['check', bad.dst]);
check('check invalid exits 3', badCheck.status === 3, `exit ${badCheck.status}`);

// 3. Structured diagnostics only via the Go engine.
const badJson = run(['check', '--format=json', bad.dst], { KARKAIN_ENGINE: 'go' });
let items = null;
try {
  items = JSON.parse(badJson.stdout);
} catch {
  items = null;
}
check(
  'go-engine check --format=json emits schema v1',
  badJson.status === 3 &&
    Array.isArray(items) &&
    items.length > 0 &&
    typeof items[0].file === 'string' &&
    typeof items[0].line === 'number' &&
    typeof items[0].message === 'string',
  badJson.stdout.slice(0, 200),
);
const goodJson = run(['check', '--format=json', good.dst], { KARKAIN_ENGINE: 'go' });
check('go-engine check --format=json passes clean', goodJson.status === 0, `exit ${goodJson.status}`);

// 4. fmt rewrites in place and reports status.
const fmtProbe = isolatedCopy('fixtures/hello-world/hello.kark');
const fmt = run(['fmt', fmtProbe.dst]);
check(
  'fmt exits 0 with a status line',
  fmt.status === 0 && /formatted\./.test(fmt.stdout),
  fmt.stdout.trim().slice(0, 80),
);
check('fmt --check verifies', run(['fmt', '--check', fmtProbe.dst]).status === 0);

// 5. Target matrix shape.
const tgt = run(['target']);
check(
  'target matrix reports host and defaults',
  tgt.status === 0 &&
    /Host:/.test(tgt.stdout) &&
    /Supported targets:/.test(tgt.stdout) &&
    /Default:/.test(tgt.stdout),
  tgt.stdout.slice(0, 120),
);

// 6. Cross behaviors.
const wasm = isolatedCopy('fixtures/hello-world/hello.kark');
const wasmOut = join(wasm.dir, 'hello.wasm');
const wb = run(['build', '--target', 'wasm32-wasi', wasm.dst, '-o', wasmOut]);
check('wasm32-wasi build emits a module', wb.status === 0 && existsSync(wasmOut), `exit ${wb.status}`);
const refuse = run(['run', '--target', 'x86_64-linux', wasm.dst]);
check(
  'foreign run is refused loudly',
  refuse.status !== 0 && /cross-run|emulator/.test(refuse.stdout + refuse.stderr),
);
const unknown = run(['build', '--target', 'nope-arch', wasm.dst]);
check(
  'unknown target fails loudly',
  unknown.status !== 0 && /unsupported target/.test(unknown.stdout + unknown.stderr),
);

// 7. Test runner shapes.
const pass = isolatedCopy('fixtures/testing/pass_test.kark');
const pt = run(['test', pass.dst]);
check(
  'test runner reports PASS lines and totals',
  pt.status === 0 && /PASS test_add/.test(pt.stdout) && /\d+ passed; \d+ failed/.test(pt.stdout),
  `exit ${pt.status}`,
);
const fail = isolatedCopy('fixtures/testing/fail_test.kark');
const ft = run(['test', fail.dst]);
check(
  'failing tests report FAIL plus assertion detail',
  ft.status === 4 && /FAIL test_bad/.test(ft.stdout) && /assertion failed/.test(ft.stdout),
  `exit ${ft.status}`,
);

// 8. Debug build emits a runnable binary.
const dbg = isolatedCopy('fixtures/debugging/hello.kark');
const exe = join(dbg.dir, process.platform === 'win32' ? 'hello.exe' : 'hello');
const db = run(['build', '-g', dbg.dst, '-o', exe]);
let ran = '';
if (db.status === 0 && existsSync(exe)) {
  try {
    ran = execFileSync(exe, { encoding: 'utf8', cwd: dbg.dir, timeout: 60000 });
  } catch (e) {
    ran = String(e.stdout ?? e.message);
  }
}
check(
  'build -g binary runs golden output',
  db.status === 0 && ran.trim() === '42',
  `exit ${db.status} out=${ran.trim()}`,
);

if (failures.length > 0) {
  console.error(`\n${failures.length} failing assertion(s): ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\nToolchain smoke gate: all assertions passed.');
