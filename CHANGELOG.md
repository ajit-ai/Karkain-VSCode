# Changelog

All notable changes follow Semantic Versioning. The extension stays pre-1.0
until core language support, diagnostics, build, run, IntelliSense, tests, green
CI, VSIX packaging, complete docs and understood cross-platform behavior.

## [0.7.0] — 2026-09-24 (Phase 7 targets)

- `Karkain: Select Target` backed by the live `karkain target` matrix:
  platform triples plus compute targets (`cpu`/`simd` implemented,
  `gpu`/`npu` experimental, `quantum` research, wasm experimental) with the
  CLI's own maturity labels and per-target detail views.
- `karkain.target` setting appended as `--target` to build/run (empty = host
  default, byte-identical argv); status-bar indicator with click-to-select;
  debugging stays host-only by design and says so.
- Verified live: `build --target wasm32-wasi` emits a module; foreign `run`
  refused (exit 6); unknown targets and missing cross-linkers fail with
  actionable messages (exit 6/2), surfaced never swallowed.

## [0.6.0] — 2026-09-24 (Phase 6 debugging)

- `Karkain: Debug File (gdb)`: verified `karkain build -g` of the active file,
  then GDB launch via cppdbg — never on a stale or missing binary (build
  failure or missing output aborts with a `Karkain Debug` channel report).
- Launch + attach configurations (`cppdbg`, `MIMode: gdb`, configurable
  `miDebuggerPath`, Value pretty-printing) with unit-tested builders;
  `templates/launch.json` + `templates/tasks.json` for workspace setup.
- Verified live: `-g` binary runs (prints 42); GDB resolves `karkain_user_add`,
  breaks, backtraces and exits normally; `karkain debug` emits the
  `karkain:<file>:enter/leave` trace on stderr (verified: it also removes a
  same-directory `.exe` and leaves generated `.c` — build immediately before
  launching).
- Debug-test profile resolved as unsupported: test-only files have no `main`
  and fail to link (`undefined reference to WinMain`, exit 6), so no Debug
  test profile is offered rather than a broken one.

## [0.5.0] — 2026-09-24 (Phase 5 formatting/testing)

- Testing API integration: Test Explorer tree of `*_test.kark` files and
  `test_*` functions, discovered semantically via document symbols with a
  logged textual fallback; per-file `karkain test` runs mapped by exact name
  (the runner's `--filter` is substring-based, so it is not used for
  single-test scoping); `PASS/FAIL` + totals parsing; assertion detail attached
  with navigation to the test declaration; cancellation kills the runner;
  dedicated `Karkain Test` output channel; `Karkain: Test` command (active file
  or whole workspace); refresh on save and on file create/change/delete.
- Formatting: provider honors cancellation (kills `fmt`); `fmt --check`
  verified (`already formatted.`, exit 0); range formatting intentionally absent
  (neither CLI nor server offers it).
- Debug-test profile deferred to Phase 6: no debug adapter exists yet.

## [0.4.0] — 2026-09-24 (Phase 4 build/run/toolchain)

- `karkain.toml` project-root detection with `src/main.kark` + `tests/` layout
  recorded from real `pkg init` output (`fixtures/project/`).
- VS Code Tasks provider: `build` (default build group, `$gcc` matcher),
  `check`, `run` for the active file, project-scoped `clean`; usable from
  `tasks.json` via the `karkain` task definition.
- Toolchain discovery across PATH with `Karkain: Select Toolchain` picker
  (workspace-scoped setting) and `Karkain: Clean` command.
- Terminals and `Show Environment` now report the project root, the resolved
  executable and every toolchain on PATH.
- Verified: bare `run/check/build` exit 2 (file always required); flat
  `karkain.toml` keys (not the `[package]` table from SPEC §10.1).

## [0.3.0] — 2026-09-24 (Phase 3 language intelligence)

- Hardened `karkain lsp` client: dedicated `Karkain Language Server` output
  channel (output + trace), 1.1.0 version gate with warning,
  initialization-failure surfacing instead of silent disablement.
- New pure `lsp.ts`: capability negotiation, server version gate, LSP 3.17
  SymbolKind names, all unit-tested.
- `fixtures/lsp/smoke.kark` with position-stable symbols; manual
  `scripts/lsp-smoke.mjs` gate (`npm run test:lsp-smoke -- <karkain-bin>`)
  asserting handshake, push diagnostics, completion, hover, definition,
  document symbols and semantic tokens — 17/17 PASS against source-built 1.1.0.
- Inspection doc records the live-verified capability matrix; rename,
  references, code actions and workspace symbols confirmed absent server-side
  and not faked.

## [0.2.0] — 2026-09-24 (Phase 2 language foundation)

- TextMate grammar covers the full SPEC §1.2 surface: core control keywords,
  `print/println` builtins, `Some/None/Ok/Err`, primitive types, memory/unsafe
  and heterogeneous (`kernel/device/actor/spawn/channel/qreg/gate/measure`)
  keywords, `fn` function definitions, `struct/enum/type/matrix` type
  definitions, escape-aware strings, `& @ . ?` operators.
- 12 snippets (`main`, `func`, `if`, `while`, `for`, `forin`, `match`, `struct`,
  `enum`, `import`, `println`, `let`), all using verified core syntax.
- Language configuration: ASCII `wordPattern`, brace `indentationRules`,
  `//` onEnter continuation.
- New unit suite (`language.test.ts`): every SPEC §1.2 word asserted against
  the grammar regexes, all regexes compile-tested, snippet/config validation.
- `fixtures/syntax/showcase.kark` exercising the grammar surface, verified
  `check`-clean and `run`-golden on a source-built 1.1.0 toolchain.
- Verified CLI contracts fixed in the extension: `check --format=json` schema v1
  arrives only via a `KARKAIN_ENGINE=go` probe (default engine renders human
  text; both are now attempted in order); `karkain fmt` rewrites in place, so
  the formatting provider saves, formats, then reloads disk content, with a
  save-loop guard on format-on-save. Fixtures/snippets corrected to real syntax
  (untyped funcs, `type X struct`, comma enums) after the toolchain rejected
  SPEC §3.2 `->` returns and typed params on both engines.

## [0.1.0] — 2026-09-23 (Phase 1 foundation)

- Standalone TypeScript extension scaffold (activation, output channel,
  Problems collection, guarded `karkain lsp` client).
- Commands `check/build/run/formatDocument/showEnvironment/restartLanguageServer`
  mapped 1:1 to the real Karkain 1.1.0 CLI.
- `check --format=json` schema-v1 parsing with 1.1.0 version gating and honest
  fallback for older toolchains.
- `.kark` language registration, TextMate grammar and language configuration
  ported from the in-tree `editors/vscode` prototype.
- Settings `compilerPath/debuggerPath/formatOnSave` with safe defaults.
- Unit tests (toolchain, diagnostics), fixtures, docs
  (inspection/boundary/architecture/roadmap), CI
  (install/lint/format/typecheck/unit/package on win+linux+mac).
