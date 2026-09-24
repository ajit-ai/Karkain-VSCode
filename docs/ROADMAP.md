# Roadmap (internal, numbered)

Status: Phases 1–3 complete. No phase is skipped; each lands with tests,
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
- [ ] **Phase 4 — Build / Run / Toolchain**: `karkain.toml` project-root
      detection, Tasks integration (build/clean/workspace), PATH + multi-install
      selection, `showEnvironment` expansion, terminal/output refinement.
- [ ] **Phase 5 — Formatting / Testing**: `fmt --check` + format-on-save matrix,
      error/cancellation paths, Testing API over `karkain test` (`*_test.kark`
      discovery, `--filter`, output + source navigation).
- [ ] **Phase 6 — Debugging**: `build -g` + `cppdbg`/GDB launch/attach
      templates, `tasks.json` pre-launch build, breakpoint/stepping/variables
      verification against real binaries. No custom debug UI.
- [ ] **Phase 7 — Target / Heterogeneous**: `karkain target` matrix picker,
      `--target`-aware build/diagnostics, experimental targets labeled as such.
- [ ] **Phase 8 — Production Hardening**: security review, cancellation,
      cross-platform (win/linux/mac) validation, performance, UX refinement.
- [ ] **Phase 9 — Packaging / Release**: `.vsix` verification matrix, icon,
      publisher decision, Marketplace metadata, release automation, install docs.
