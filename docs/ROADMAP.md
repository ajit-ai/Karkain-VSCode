# Roadmap (internal, numbered)

Status: Phases 1–8 complete. No phase is skipped; each lands with tests,
validation runs, docs updates and an honest limitation report.

- [x] **Phase 1 — Repository Foundation & Architecture**: Karkain inspection
      (docs/KARKAIN-INSPECTION.md), boundary (docs/INTEGRATION-BOUNDARY.md),
      TypeScript + `vscode-languageclient` + `@vscode/vsce` stack, manifest 0.1.0,
      pure-logic unit tests, CI (install/lint/format/typecheck/unit/package).
- [x] **Phase 2 — Language Foundation**: TextMate grammar expanded to the full
      SPEC §1.2 keyword/type/operator surface (+ `fn` definitions, type
      definitions, escapes, `& @ . ?` operators), 12 snippets, word pattern,
      indentation and `//` onEnter rules, `fixtures/syntax/showcase.kark`,
      grammar/snippet/config unit tests.
- [x] **Phase 3 — Language Intelligence**: hardened `karkain lsp` client
      (dedicated output channel, 1.1.0 version gate, init-failure surfacing),
      capability-negotiation + SymbolKind helpers with unit tests,
      `fixtures/lsp/smoke.kark`, manual `scripts/lsp-smoke.mjs` gate (17/17
      PASS live: handshake, push diagnostics, completion, hover, definition,
      symbols, semantic tokens).
- [x] **Phase 4 — Build / Run / Toolchain**: `karkain.toml` project-root
      detection (`src/project.ts`), Tasks provider (`build` in the build group
      with `$gcc`, `check`/`run`/`clean`), PATH toolchain discovery with a
      `Select Toolchain` picker, expanded `Show Environment`, terminal cwd set
      to the project root. Verified: file commands always need a file (bare
      `run/check/build` exit 2); `pkg init` shape recorded in
      `fixtures/project/`.
- [x] **Phase 5 — Formatting / Testing**: formatter cancellation support
      (`fmt --check` documented, no fake range formatting — the server and CLI
      are whole-document only); Testing API over `karkain test` (semantic
      discovery via document symbols with logged textual fallback, per-file
      runs mapped by exact name, `PASS/FAIL` + summary parsing, assertion
      detail with source navigation, cancellation, `Karkain Test` channel,
      `Karkain: Test` command, save/watch refresh). No debug-test profile:
      test-only files cannot link (resolved in Phase 6).
- [x] **Phase 6 — Debugging**: `Karkain: Debug File` (verified `build -g` then
      cppdbg/GDB launch, never on a stale binary), launch + attach
      configurations, `templates/launch.json` + `templates/tasks.json`,
      `Karkain Debug` channel, `karkain.debuggerPath` wiring. Breakpoints,
      stepping, variables, call stack, watch and evaluate come from GDB itself.
      Debug-test profile resolved as unsupported: test-only files have no
      `main` and fail to link (`undefined reference to WinMain`, exit 6).
- [x] **Phase 7 — Target / Heterogeneous**: `Karkain: Select Target` over the
      real `karkain target` matrix (platform triples + compute targets with
      CLI-reported maturities, never invented), `karkain.target` setting wired
      into build/run, status-bar indicator, host-only debugging documented.
      Verified: wasm32-wasi builds a runnable-module file, foreign `run` is
      refused (exit 6), unknown targets and missing cross-linkers fail loudly.
- [x] **Phase 8 — Production Hardening**: `docs/SECURITY.md` (argv-only
      spawning audit, terminal quoting with trailing-backslash hardening,
      workspace-trust refusal, no telemetry); `quoteTerminalArg` extracted with
      unit tests; case-sensitive PATH dedupe on Linux; guarded test discovery;
      editor context menus for file commands; manual
      `scripts/toolchain-smoke.mjs` gate (15/15 PASS live) beside the LSP
      smoke gate. No bundler: the vsce size hint is documented, startup cost
      is negligible at this size, and the toolchain call stays dependency-free.
- [ ] **Phase 9 — Packaging / Release**: `.vsix` verification matrix, icon,
      publisher decision, Marketplace metadata, release automation, install docs.
