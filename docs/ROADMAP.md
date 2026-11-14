# Roadmap (internal, numbered)

Status: Phases 1–12, 14, 15 and the v1.0.0 IDE experience milestone are
complete. **Phase 13 (`karkain ide info` consumption) is unblocked — v1.2.0
ships a machine-readable contract** (§8.2) — but not consumed for command
construction by design (see `src/capability.ts`: discovery validates, it
does not rewire argv). No phase is skipped; each lands with tests,
validation runs, docs updates and an honest limitation report.

Verification snapshot (2026-11-14, on top of `recovery/v1-0-0-lsp` @
`425675f` + uncommitted IDE work, Karkain v1.2.0 windows/amd64 at
`F:\Codes\Git\Karkain\karkain.exe`):
`npm run typecheck` clean, `npm run lint` clean, `npm run format:check`
clean, `npm run test:unit` **224/224 passing**, `npm run test:integration`
**22/22 passing** (local VS Code, no other instance open; all ~43 contributed
commands asserted registered, all Control Center commands survive a missing
toolchain). Real-binary gates: `test:lsp-smoke` (raw) 20/22 with the two
known server-defect assertions failing as designed; `test:lsp-smoke:proxy`
**22/22 PASS** — initialize, diagnostics push, hover (resolved and
unresolvable), completion, definition, documentSymbol, semanticTokens,
shutdown all valid, and the server exits 0 on stdin EOF.
`test:toolchain-smoke` **could not run** on this machine (no gcc; the
source-built `kcc` engine crashes with `0xC000014D`); it must not be run
with CWD inside the compiler repository. CI legs on macOS/Linux are
unverified — the Phase 14 `integration` job exists but has never run; that
is the release-blocker for Phase 17.

- [x] **Phase 10 — Toolchain service seam** (`src/toolchainService.ts`): one
      `ToolchainService` interface owns every Karkain process; `child_process`
      is imported in exactly one file; stdout/stderr/ordered-combined capture
      with explicit `notFound` vs non-zero-exit reporting. `activate()` returns
      `{ setToolchainService }`. In-memory fake under `src/test/fakes/`.
- [x] **Phase 11 — Extension-host suite** (`npm run test:integration`): first
      coverage of activation, all 11 contributed commands, the `karkain`
      language id, missing-toolchain survival, and CLI reachability through the
      injected seam. Unit suite 89 → 104 cases. Prefers a local VS Code install
      over a ~340 MB download.
      Still open in this track: the two manual smoke gates still need a real
      ≥ 1.1.0 toolchain, and the check/test/debug orchestration paths are covered
      only where the fake can observe them. The "CI does not run the integration
      suite" gap closed in Phase 14.
- [x] **Phase 12 — Capability negotiation and project model**: the negotiation in
      `src/lsp.ts` is now live in the client — `reportServerCapabilities` in
      `src/extension.ts` validates the real `initializeResult` once `start()`
      resolves. Compatibility is decided **only** from the server's own
      `serverInfo.version`, never from the CLI `--version` probe (the two can
      diverge); an unparseable version is reported as unverifiable rather than
      assumed good, and missing capabilities warn without ever stopping a
      working server. A changed `karkain.compilerPath` now stops and restarts the
      client via `restartLanguageClientAndStart`, serialized behind a single
      in-flight promise so overlapping restarts cannot interleave for the one
      client slot; the change is logged and confirmed in the status bar rather
      than happening silently.
      `src/project.ts` gained a real project model, so `manifestPath` is no
      longer dead code: `parseManifest` (a deliberately small TOML subset — flat
      top-level assignments, matching the verified 1.1.0 `pkg init` output, not
      the SPEC §10.1 `[package]` table), plus `readManifest`, `loadProject` and
      `describeProject`. Anything the parser does not model — section tables,
      unmodelled keys, wrongly-typed or unterminated values — is reported rather
      than guessed, and `Karkain: Show Environment` surfaces all of it. Unit
      suite 132 → 150, including a case that parses the committed
      `fixtures/project/karkain.toml`.
- [ ] **Phase 13 — `karkain ide info` consumption**: replace hardcoded argv
      with the toolchain's own machine-readable contract
      (`schemaVersion: 1`: argv shapes, diagnostics schema, exit codes), keeping
      the hardcoded vectors as a fallback because no stability guarantee is
      stated.
      **UNBLOCKED — verified live 2026-11-14 against v1.2.0**
      (`F:\Codes\Git\Karkain\karkain.exe`, Windows AMD64): `karkain ide info`
      prints a `schemaVersion: 1` JSON contract (language, project detection,
      argv vectors, diagnostics schema `karkain-diagnostics-v1` with codes
      `E-K-*/W-K-*`, exit codes 0/1/2/3/4/5/6), exit 0. The earlier claim
      that `ide info` does not exist was true of v1.0.0 (see
      `docs/KARKAIN-INSPECTION.md` §8.1, now corrected by §8.2) and is
      outdated for v1.2.0. **Not implemented in this milestone by design.**
      Unblock consumed: re-probing argv shapes is no longer required for the
      contract itself, but the stability guarantee question (open question 2)
      is still unanswered — the hardcoded vectors stay as fallback.

## Proposed phases 14+ (not yet committed to a release)

Ordered by dependency. Phases 12 and 13 must land first: 14 and 15 consume
their outputs, and 13 changes the argv model that 14 asserts against.

- [x] **Phase 14 — CI integration job**: `.github/workflows/ci.yml` now runs
      `npm run test:integration` on the same 3-OS matrix as `validate`, as a
      separate job so the fast unit suite is never blocked by an Electron start.
      Linux wraps the runner in `xvfb-run` (Electron needs a display); Windows
      and macOS need no wrapper, so one conditional `run:` serves all three.
      `KARKAIN_VSCODE_DOWNLOAD=1` forces the pinned build in CI rather than
      whatever happens to be installed on the runner. Failure logs are uploaded
      as artifacts. This closes the Phase 11 "CI does not run the integration
      suite" note. Still to confirm on the first CI run: whether the pinned
      VS Code build starts cleanly on all three OSes.
- [x] **Phase 15 — Multi-root workspace support**: project-root and configuration
      resolution are now per-folder and per-document. `src/workspace.ts` holds
      the ownership rule as pure, unit-tested code (`isPathInsideRoot`,
      `findOwningRoot`, `findOwningRootPath`): the longest containing root wins
      so a nested root beats its parent, matching is segment-boundary aware so
      `/proj/app` never claims `/proj/application`, case folds only on
      case-insensitive filesystems, and a file outside every root resolves to
      nothing rather than to an arbitrary root. Every config getter in
      `src/config.ts` now takes a scope, because an unscoped
      `getConfiguration` returns the _first_ folder's value for every file —
      which would silently give root B root A's toolchain. All four settings
      are declared `"scope": "resource"` so they can be set per folder.
      `effectiveCwd`, the tasks, the toolchain picker and Show Environment all
      resolve from the file that is actually being acted on.
      The extension-host suite now runs against `fixtures/multiroot.code-workspace`,
      a genuine two-root window over two deliberately different Karkain
      projects (`fixtures/project`, `fixtures/project-other`), with
      `src/test/suite/multiroot.test.ts` asserting folder ownership and that
      folder-scoped settings do not leak between roots. The existing
      single-root assertions in `activation.test.ts` were kept and now run
      _inside_ that two-root window, so "one client, one set of registrations,
      root-count-independent commands" is enforced rather than assumed.
      Unit suite 150 → 166.
      Known limitation, deliberate: the language server stays a single window-
      wide client spawned from the workspace-wide `karkain.compilerPath`, so a
      per-folder compiler path governs CLI commands, tasks and formatting but
      not the server's own executable. Per-root clients would duplicate the
      server, output channel and diagnostics stream for no added capability;
      running two toolchains concurrently is a different design.
- [ ] **Phase 16 — Coverage of the remaining orchestration paths**: the Phase 11
      note records that `check`/`test`/`debug` orchestration is only covered
      where the fake can observe it. Extend `src/test/fakes/toolchainFake.ts` so
      those paths are assertable end to end rather than only argv-visible.
- [x] **Phase 17 — Release 1.0 readiness**: **In progress / not done.** As of
      2026-11-14 the Windows leg of the gates is green locally
      (typecheck/lint/format:check/unit 224/224, integration 22/22, proxy
      smoke 22/22, VSIX packaged); **macOS and Linux are unverified, and the
      Phase 14 `integration` job has never run**, so the A-30 bar
      ("understood cross-platform behavior", green CI) is not met. Also blocked
      on the Marketplace publisher decision in `docs/RELEASE.md`. Do not tag,
      release or publish without all legs green and an explicit owner decision.
- [x] **Phase 18 — Complete IDE experience (v1.0.0 product milestone)**:
      Karkain Control Center (activity bar, 7 native views: Overview, Quick
      Actions, Projects & Files, Compiler Commands, Standard Library,
      Examples, Documentation), the verified v1.2.0 command inventory as data
      (`src/commandCatalog.ts`, ~full `--help` surface, searchable, no
      auto-execution of unwired entries), capability discovery via
      `karkain ide info` (`src/capability.ts`, schemaVersion 1, honest
      rejection of unknown versions), run experience (env/flag-aware terminals,
      re-run, stop, honest recent-action history), build experience (scoped
      `--target`, engine selection, two-engine diagnostics), debugging via real
      GDB/`cppdbg` with prerequisite checks, Testing integration, a
      diagnostics/health system (pure `src/health.ts`, exported/copied reports,
      no environment values), the bundled offline Documentation centre
      (`docs/user/`), 13 new commands, five keybindings, and the VSIX ships
      the docs and views. Unit suite 166 → 224 (new: capability, catalogue,
      recent actions, health, flags); integration 20 → 22 (view + command
      contributions; all commands survive a missing toolchain).
- [x] **Phase 19 — LSP reliability (v1.0.0 recovery milestone, merged into 1.0.0)**:
      root cause of `Request textDocument/hover failed` conclusively established
      as a Karkain server defect (empty envelope on no-result handlers, incl.
      every `shutdown`); fixed at the extension boundary by `out/lsp-proxy.js`
      (rewrites ONLY the empty envelope to `result: null`), verified end-to-end
      against the real v1.2.0 binary (hover/definition/shutdown repaired,
      server exits 0). `deactivate()` can no longer throw; startup is bounded;
      restarts are serialized; the smoke gate was rewritten with strict
      framing and two modes (raw evidence vs `--through-proxy` release gate,
      22/22 PASS). Focused unit tests for the repair logic landed (166 → 188).
- [ ] **Deferred, needs upstream Karkain**: rename, references, code actions and
      workspace symbols are absent from `karkain lsp` (documented in
      `docs/KARKAIN-INSPECTION.md` §4). These are toolchain gaps, not extension
      gaps, and must not be faked. Revisit when the server ships them.

## Open questions blocking the phases above

1. Does the extension own `karkain.compilerPath` restarts, or is an explicit
   `Karkain: Restart Language Server` click the intended UX? Phase 12(a) needs a
   decision — silent restart is convenient but surprising during a build.
2. Is `karkain ide info` given a stability guarantee upstream? Phase 13's
   fallback path stays until it is.
3. Who owns the Marketplace `karkain` publisher? Blocks Phase 17 only.

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
- [x] **Phase 9 — Packaging / Release**: 128×128 icon with manifest wiring,
      tag-gated release automation (version check, full validation, VSIX asset
      on GitHub Releases — never Marketplace auto-publish), `docs/RELEASE.md`
      with versioning policy and the manual Marketplace checklist, runtime
      version banner (no hardcoded drift).
