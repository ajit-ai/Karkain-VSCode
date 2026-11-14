# Karkain Inspection (source of truth: `main` @ 2026-09-23)

Inspection date: 2026-09-23. Local probe toolchain: `Karkain Compiler v1.0.0
(windows/amd64, LSP Engine & IDE Tooling)` at `C:\Users\Lenovo\go\bin\karkain.exe`.
Remote `main` identifies as **Karkain 1.1.0 (Stable)**. The drift between the two
is recorded at the bottom; the extension targets **1.1.0**.

## 1. Language facts

- Source extension: `.kark` (verified: `ValidateKarFile`, `examples/*.kark`).
- Entry point: `func main()`. Minimal program (`examples/01-fundamentals/01_hello_world.kark`):
  `func main() { print("Hello, Karkain!") }`.
- Comments: `//` line comments and `/* ... */` block comments, both present in
  the released 1.1.0 lexer (`pkg/lexer/lexer.go`, Phase 112 — nested block
  comments with depth tracking). SPEC.md §1.3 still says block comments are
  undefined; that spec text is stale and the lexer supersedes it.
  The extension's TextMate grammar highlights the ordinary begin/end form
  (`comment.block.karkain`); TextMate cannot model arbitrary recursive
  nesting, so a nested block comment ends at its first `*/`.
- Authoritative keywords (SPEC.md §1.2 + Appendix A): `func fn print println let
var return if else import matrix alloc free addr qreg gate measure actor spawn
receive channel send macro quote unquote comptime while for type struct bool
bigint bigfloat true false kernel device global_id barrier mut raw move Some
None Ok Err match linear packed enum in break continue`. `Some Ok Err` are
  capitalized; everything else is lowercase.
- Primitive types: `int float64 bool string bigint bigfloat`; composites: arrays,
  maps, slices, structs, enums, `*T` / `&T` / `&mut T`, `Option<T>`, `Result<T,E>`.

## 2. CLI (cmd/karkain/main.go on main)

`karkain [command] [options] <file.kark>`

| Command                                                                                                                                       | Real on main | Notes                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------- |
| `run <file>`                                                                                                                                  | yes          | compile + run, default command                                |
| `build <file>` (+ `-o`, `-g`, `--target`, `--incremental`)                                                                                    | yes          | native exe via C23 + host C compiler                          |
| `transpile <file>`                                                                                                                            | yes          | keep generated C                                              |
| `check <file>` (+ `--format=json`)                                                                                                            | yes          | syntax + semantics; exit 3 on error                           |
| `test <path>` (+ `--filter`, `--compile`)                                                                                                     | yes          | discovers `*_test.kark`                                       |
| `bench`, `prof`, `debug`/`dbg`, `lint`, `explain`                                                                                             | yes          | `debug` = opt-in trace (Go engine); `prof` = text/json/folded |
| `fmt <file>` (+ `--check`)                                                                                                                    | yes          | canonical formatter                                           |
| `kir <file>` (+ `--verify`)                                                                                                                   | yes          | self-hosted KIR v1 text (kcc only)                            |
| `target`, `config`, `clean`, `wit`, `lsp`/`language-server`, `ide info`                                                                       | yes          | `lsp` = stdio JSON-RPC server                                 |
| `workspace <list\|build\|test\|check\|run\|clean\|lint\|graph\|init\|add\|remove>`                                                            | yes          | dependency-ordered                                            |
| `pkg` (+ `init/add/remove/fetch/update/upgrade/deps/list/tree/search/info/publish/login/logout/whoami/audit/verify/cache/registry/workspace`) | yes          | local-only registry in 1.1.0                                  |
| `init/new/add/remove/fetch/update/list/tree` (top-level aliases)                                                                              | yes          | project scaffolding                                           |

Exit codes: 0 success, 1 program failure, 2 usage, 3 compile/check, 4 test
failure, 5 package/dependency, 6 infrastructure (no C compiler).

## 3. Project model

- Manifest `karkain.toml` uses **flat keys** as generated (`name, version,
description, license, targets`), not the `[package]` table sketched in
  SPEC §10.1. Layout: `src/main.kark`, `tests/*_test.kark`, `.karkain/cache/`
  (see `fixtures/project/`). Lockfile `karkain.lock`, auth `~/.karkain/auth.json`.
- File commands always need a file: bare `run/check/build` in a project dir
  exit 2 (`No input .kark file specified`). `test <path>` discovers
  `*_test.kark` and runs `test_*` funcs: `=== Running tests in <staged> ===`,
  interleaved program output, `␣␣PASS name` / `␣␣FAIL name` lines, assertion
  detail (`assertion failed: assert_eq: …` + `expected:`/`actual:` lines),
  `=== Test Summary: … ===` plus `N passed; M failed; S skipped; T total`;
  exit 0 all-pass, 4 on any failure. On Windows the kcc runner also prints
  non-fatal Winsock linker noise that never alters the result lines.
- Multi-file units: sibling files in one directory, root file last;
  `import math` + `public func/type/enum` gating (SPEC.md §15).
- Stdlib modules: `std.string collections io encoding crypto testing numerics
net http db` (both engines byte-identical).

## 4. LSP (pkg/lsp on main, v2 Phase 136)

- Transport: JSON-RPC 2.0 over stdio with `Content-Length` framing (server.go).
- Methods: `initialize/initialized/shutdown/exit`,
  `textDocument/didOpen|didChange|didSave|didClose`,
  `textDocument/completion|hover|definition|documentSymbol|formatting|semanticTokens/full`,
  `textDocument/publishDiagnostics` (protocol.go).
- Capabilities: completion (scoped + member), hover (typed), definition
  (same-doc lexical, member, cross-file incl. disk siblings), document symbols
  (12 decl kinds + enum), semantic tokens (lexer-driven, delta-encoded),
  push diagnostics. Server version 1.0.0.
- NOT provided: rename, references, code actions, code lens, inlay hints, call
  hierarchy, workspace symbols (absent from ServerCapabilities).
- Verified live (source-built 1.1.0, `scripts/lsp-smoke.mjs`, 17/17 PASS):
  handshake reports `serverInfo {karkain-lsp, 1.1.0}`, full sync + save
  `includeText`, completion triggers `.`/`:`, hover markdown with range
  (keyword + symbol), definition usage→declaration, documentSymbol with
  Function/Struct+Field children/Enum+EnumMember, semanticTokens delta data,
  full-document formatting edit, `publishDiagnostics` `[]` on clean open and a
  ranged `severity:1, source:karkain` error on `let = 42`.

## 5. Diagnostics

- `check --format=json` emits schema v1:
  `[{file,line(1-based),column(1-based),severity,code,message}]`
  (contract cited by the in-tree prototype `editors/vscode/extension.js`).
- Runtime errors: `runtime error: <kind> at <file>:<line>` + stack traces.

## 6. Targets / toolchain

- `karkain target`: `native c23 wasm32-wasi` (+ experimental
  `cpu/simd/gpu-experimental/npu-experimental/quantum-experimental` catalog,
  Phase 124). Cross via `--target <triple>`; missing cross-linker = exit 6
  diagnostic, never silent fallback. `run --target <foreign>` is refused.
- Build requires Go 1.21+ (to build Karkain) and GCC/Clang/MSVC (for Karkain to
  emit binaries). `-lws2_32` Winsock contract on Windows.
- Debug model: `karkain build -g` (DWARF + `#line`) then GDB via `cppdbg`
  (in-tree `editors/vscode/launch.json` + `runDebug`). No Debug Adapter
  Protocol server exists in the compiler.
- Verified live: `-g` binary runs and prints correctly; GDB resolves
  `karkain_user_*` symbols, sets breakpoints, backtraces and exits normally.
  `karkain debug <file>` prints the program output plus
  `karkain:<file>:enter/leave <func>` trace lines on stderr (exit 0), but it
  also deletes a same-directory `.exe` and leaves generated `.c` beside the
  source — the extension therefore builds immediately before launching.
  `karkain build` of a test-only file fails to link (`undefined reference to
WinMain`, exit 6): no debuggable test binary exists.

## 7. In-tree prototype (editors/vscode on main)

JS extension v0.1.0 (`package.json`: publisher `karkain`, engine `^1.75.0`,
`vscode-languageclient ^9.0.1`): language id `karkain`, `.kark`,
`source.karkain` grammar (subset of §1 keywords), language-configuration
(`//`, brackets, `func` folding), commands check/compile/run/debug/format,
settings `compilerPath/debuggerPath/formatOnSave`, guarded LSP client to
`karkain lsp`. Limitation (its README): diagnostics via notification channel,
not the Problems panel. This standalone repo ports that surface to TypeScript
and closes the Problems-panel gap via `check --format=json`.

## 8. Local (v1.0.0) vs main (1.1.0) drift — verified live

| Behavior              | Local v1.0.0                                    | Main 1.1.0                                        |
| --------------------- | ----------------------------------------------- | ------------------------------------------------- |
| `check --format=json` | `Unknown flag` (exit 2)                         | supported                                         |
| `fmt` command         | absent (`Input file must be a .kark file: fmt`) | supported                                         |
| `let = 42` in `check` | passes (exit 0)                                 | rejected (exit 3, Phase 117 hardening)            |
| `explain K002`        | expects `E-*-*` codes                           | `K001..K114+K121/K122/K127` numeric               |
| `ide info`            | not a subcommand at all in v1.0.0               | **present in v1.2.0** (schemaVersion 1, see §8.2) |
| `lsp`                 | present                                         | present (v2 semantic, Phase 136)                  |

Consequence: structured Problems integration requires ≥ 1.1.0; the extension
probes `karkain --version` at activation and degrades honestly on older
toolchains (warning + raw output channel, never fabricated diagnostics).

### 8.1 `ide info` is absent in v1.0.0, not merely differently shaped

Re-verified 2026-10-03 against `C:\Users\Lenovo\go\bin\karkain.exe`, which
reports `Karkain Compiler v1.0.0 (windows/amd64, LSP Engine & IDE Tooling)`:

| Invocation                       | Result                                        | Exit |
| -------------------------------- | --------------------------------------------- | ---- |
| `karkain ide info`               | `Input file must be a .kark file: ide`        | 2    |
| `karkain ide`                    | `Input file must be a .kark file: ide`        | 2    |
| `karkain ide info <file>.kark`   | `Input file must be a .kark file: ide`        | 2    |
| `karkain ide info --format=json` | `Error: Unknown flag '--format=json'` + usage | 2    |

The error text is the decisive evidence: v1.0.0 parses `ide` as the **input
filename**, not as a subcommand. Passing a real `.kark` path still fails the
same way, and `ide` appears nowhere in `karkain --help` (109 lines; the only
`info` verb is `pkg info <pkg>`).

So the drift row above is misleading as written: v1.0.0 does not implement a
variant `ide info` contract — the command does not exist. There is therefore
**no local vector to derive a `schemaVersion: 1` contract from**, which is why
Phase 13 cannot be implemented from this machine and the hardcoded argv vectors
remain the only source of truth. Re-verify against a ≥ 1.1.0 build before
attempting it.

The same probe also confirms two extension behaviours against a real toolchain:
`parseVersionString` reads the v1.0.0 banner (including its distinct
`LSP Engine & IDE Tooling` suffix) and `supportsStructuredDiagnostics('1.0.0')`
is `false`, so structured diagnostics stay correctly gated off;
`parseTargetOutput` degrades honestly on the v1.0.0 `karkain target` shape
(`c23`/`native`/`wasm32-wasi`, no `Host:` line, no compute section) into an
empty-host matrix with three targets and no invented compute entries.

### 8.2 `ide info` EXISTS in v1.2.0 — §8.1 is outdated (verified live 2026-11-14)

Re-verified against the v1.2.0 binary actually required by this milestone,
`F:\Codes\Git\Karkain\karkain.exe`, which reports
`Karkain Compiler v1.2.0 (windows/amd64, Stable Build)`. The 2026-10-03 probe
tested the v1.0.0 binary at `C:\Users\Lenovo\go\bin\karkain.exe`; the two
conclusions were both correct — for the binaries tested. Do not cite §8.1 to
claim v1.2.0 lacks the contract.

| Invocation         | Result                                | Exit |
| ------------------ | ------------------------------------- | ---- |
| `karkain ide info` | schemaVersion 1 JSON contract (below) | 0    |

Verbatim contract (trimmed to the load-bearing keys):

```json
{
  "schemaVersion": 1,
  "language": { "name": "Karkain", "id": "karkain", "extensions": [".kark"], "defaultFilename": "main.kark" },
  "projectDetection": { "manifest": "karkain.toml", "marker": "main.kark" },
  "toolchain": {
    "binary": "karkain",
    "check": ["karkain", "check", "<file>"],
    "checkJSON": ["karkain", "check", "--format=json", "<file>"],
    "build": ["karkain", "build", "<file>"],
    "run": ["karkain", "run", "<file>"],
    "test": ["karkain", "test", "<path>"],
    "format": ["karkain", "fmt", "<file>"],
    "formatCheck": ["karkain", "fmt", "--check", "<file>"],
    "lint": ["karkain", "lint", "<file>"],
    "lsp": ["karkain", "lsp"]
  },
  "diagnostics": { "format": "json", "schema": "karkain-diagnostics-v1", "code": "E-K-*/W-K-*" },
  "exitCodes": { "success": 0, "failure": 1, "usage": 2, "compile": 3, "test": 4, "package": 5, "env": 6 }
}
```

**Qualification (still required):** v1.2.0's `--help` output DOES include the
`ide info` verb; the v1.0.0 `--help` (109 lines) did not. Phase 13's
"no local vector" blocker is dissolved for v1.2.0. What remains unknown is
whether `schemaVersion: 1` is a stability-guaranteed contract (open question
2), so the hardcoded argv vectors remain the fallback; consuming the
contract is Phase 13, not this milestone.

### 8.3 v1.2.0 vs v1.1.0 vs v1.0.0 — extension-facing behaviour (2026-11-14)

Live probes against the required v1.2.0 binary:

- `check` on a **clean** file with the default (kcc) engine from outside the
  Karkain source tree: **exit 6**, `cannot locate src/compiler to build the
self-hosted engine (set KARKAIN_KCC)` — unchanged from source-built 1.1.0.
  On a machine where the source-built `kcc` engine cannot bootstrap (no gcc;
  observed here as `0xC000014D` STATUS_FATAL_MEMORY_EXHAUSTION), clean `check`
  exits 3 with **empty output** — a silent pass/fail the extension papers over
  only by its two-engine probe (default, then `KARKAIN_ENGINE=go`).
- `check` on an invalid file: **exit 3** with human diagnostics (Go-side
  syntax preflight), exit 0/PASS via `KARKAIN_ENGINE=go` on clean files, and
  **`--format=json` is ignored on the kcc path entirely** (parsed, then
  dropped) — structured JSON diagnostics flow only via the Go engine
  (`[{"file":...,"line":5,"column":9,...}]`, exit 3).
- `karkain test` on this machine cannot link the test binary: **exit 4**,
  "no cross-linker available for target 'x86_64-windows'…" (no gcc/clang/cl.exe
  on PATH), matching the target matrix's own demands. Not an extension bug.
- `fmt`, `fmt --check`, `target`, `config`, `explain <code>`, `ide info`,
  `--version`, `--help` all exit 0 and work as documented.
- `lsp`: initialize returns `serverInfo {name: "karkain-lsp", version: 1.2.0}`
  with capabilities completion/hover/definition/documentSymbol/
  semanticTokens/formatting; hover and definition over resolved bindings
  return correct MarkupContent; **every `shutdown` returns the empty envelope
  `{"jsonrpc":"2.0","id":N}`** (server defect, repaired client-side by
  `out/lsp-proxy.js`); after `exit` + stdin EOF the server exits **0**; on a
  broken pipe it exits **1** (`handleLSP` → `os.Exit(ExitFailure)`) — the
  source of the historical "exit code 1" observation.
- The extension's own probes for all of the above are exercised in
  `scripts/toolchain-smoke.mjs` (designed to abort with setup instructions
  on source-built trees from outside the compiler repo) and
  `scripts/lsp-smoke.mjs` (raw vs `--through-proxy`).

## 9. Real accepted syntax (verified by executing 1.1.0 built from source)

A source-built `Karkain Compiler v1.1.0 (windows/amd64, Stable Build)` rejects
several shapes shown in SPEC.md §3.2 and the README "at a glance" example, on
**both** engines (`KARKAIN_ENGINE=go` included):

- `func add(a: int, b: int) -> int` → `error[K001]: unexpected token '>'`.
  Typed params (`n: int`) → `unexpected token ':' in function call arguments`.
- Bare `struct Name { ... }` at top level → `unexpected token 'struct'`.

Verified-real shapes (from `examples/language_foundation/` + live runs):

| Shape     | Real form                                                                                                                        |
| --------- | -------------------------------------------------------------------------------------------------------------------------------- |
| functions | `func add(a, b) { return a + b }` (untyped params, no return type)                                                               |
| structs   | `type Person struct { name string; age int }`, build `Person{name: "Alice", age: 30}`                                            |
| enums     | `enum Color {Red, Green, Blue}`, `Color.Red`, match arms `Color.Red => 100` + `_`                                                |
| let/var   | `let a: int = 5` scalar annotations OK; `var`/`let` reassignment OK                                                              |
| control   | parens conditions `while (i < 5)` / `if (n == 3)`; `for j in [...]`; C-style `for (; k < 3; k = k + 1)` and `for let i = 0; ...` |
| match     | `match x { 1 => "one", _ => "other" }`; `Some(v) =>` / `None =>` arms                                                            |

CLI contracts verified live on 1.1.0:

- `check --format=json` emits schema-v1 JSON **only via `KARKAIN_ENGINE=go`**
  (`[]` + exit 0 on pass; `[{file,line,column,excerpt,severity,code,message}]` +
  exit 3 on failure). The default (kcc) engine renders human text (`[ok] …`
  / `N parse error(s)` blocks). The extension tries default first, then the
  Go-engine probe.
- `karkain fmt <file>` rewrites the file **in place** and prints only
  `formatted.` / `already formatted.` (`--check` verifies). The formatting
  provider therefore saves, formats, and reloads disk content.
- `karkain run` from outside the toolchain tree fails with exit 6
  (`cannot locate src/compiler …`); `check` works from any CWD.
- Never run single-file probes in a directory with sibling `.kark` files:
  the CLI assembles siblings into one unit and errors cross-attribute.

## 10. Targets (verified live on 1.1.0, host x86_64-windows)

`karkain target` reports `Host:` + `Supported targets:` (c23, native,
native-link, wasm32-wasi, x86_64/aarch64-windows, x86_64/aarch64/riscv64-linux,
x86_64/aarch64-macos, each with a description) + `Default: native` + a
`Compute targets` catalog with CLI-reported maturities: `cpu`/`simd`
implemented, `gpu-experimental`/`npu-experimental`/`wasm32-wasi` experimental,
`quantum-experimental` research. `karkain target <name>` renders a detail view
(Family/Maturity/Host triple/Memory model/Execution model/Description/
Capabilities).

Verified behaviors:

- `build --target wasm32-wasi -o hello.wasm` → exit 0, runnable-module file.
- `run --target <foreign>` is refused with a build-only hint (exit 6).
- Unknown targets fail (`unsupported target …`, usage-class exit); foreign
  builds without a cross-linker fail with the exact searched list (exit 6).
- GPU/NPU/quantum have no executable backend: compile-only model surface at
  best, research spec at worst. The extension exposes exactly what the matrix
  reports, with maturities quoted verbatim.
