# Changelog

All notable changes follow Semantic Versioning. The extension stays pre-1.0
until core language support, diagnostics, build, run, IntelliSense, tests, green
CI, VSIX packaging, complete docs and understood cross-platform behavior.

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
