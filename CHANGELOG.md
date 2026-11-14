# Changelog

All notable changes follow Semantic Versioning. The extension stayed pre-1.0
until core language support, diagnostics, build, run, IntelliSense, tests, green
CI, VSIX packaging, complete docs and understood cross-platform behavior — the
1.0.0 entry below is an **unpublished release candidate**, so the 1.0 bar is
carried forward until macOS/Linux legs and real-world validation exist.

## [1.0.0] — 2026-11-14 (release candidate — not published)

Metadata for the intended v1.0.0 release. **Not released and not release-ready:**
the integration job has not run in CI yet (Phase 14), the toolchain smoke gate
is blocked on a machine without a working kcc/gcc (see `docs/ROADMAP.md`), and
the project's own release bar (cross-platform behaviour understood + real-world
validation) is not met. No tag, no GitHub release, no Marketplace publish —
those are owner actions. The content below is what v1.0.0 would ship.

Karkain Language Tools 1.0.0 collects the Phase 1 foundation, Phases 12, 14
and 15, and the v1.0.0 recovery milestone (LSP reliability + Karkain 1.2.0
compatibility) into one release candidate. Everything below marked "verified"
was executed live against the real `karkain` v1.2.0 binary on Windows AMD64.

### v1.0.0 recovery — LSP reliability (root cause established and fixed)

- **Root cause of `Request textDocument/hover failed. The received response
has neither a result nor an error property.` is a Karkain server defect,
  conclusively established.** Karkain's Go LSP (`pkg/lsp`) emits
  `{"jsonrpc":"2.0","id":N}` — no `result`, no `error` — whenever a handler
  returns no value (`JSONRPCResponse.Result` is `interface{}` with
  `omitempty`). vscode-jsonrpc classifies that envelope as neither a response
  nor a notification and rejects the pending request with exactly the reported
  message. Verified live on v1.2.0 against the real binary: every `shutdown`
  (unconditional) and every hover over an unresolvable position. The hover
  failure was timing/position dependent — "flaky" — because scope-model
  availability and cursor position decide which handler result you get.
- **Fix: `out/lsp-proxy.js`, a protocol-repair shim the extension spawns
  between itself and `karkain lsp`.** It rewrites ONLY the empty envelope to
  `"result": null` (what JSON-RPC 2.0 and the LSP mandate); all other traffic
  passes through byte-for-byte. Verified end-to-end with the real v1.2.0
  binary: initialize, diagnostics push, hover (resolved and unresolvable),
  completion, definition, documentSymbol, semanticTokens, shutdown all return
  valid envelopes; the server exits 0 on stdin EOF after the `exit`
  notification. The shim needs no Karkain changes and degrades to a zero-effect
  pipe once Karkain fixes the server. Its repairs are logged to the Karkain
  Language Server output channel.
- **Shutdown path hardened:** `deactivate()` no longer throws when the client
  cannot stop cleanly, and the stop-path failure (which also skipped the
  `exit` notification and left the pipe to break abnormally — observed as exit
  code 1) cannot take the extension host down.
- **Server startup is bounded** (`next.start()` raced against 20s) and
  restarts are serialized, so a silent server cannot wedge commands and
  overlapping restarts cannot interleave for the single client slot. Both
  were part of the recovered work.
- **Focused unit tests** cover the repair logic (empty envelope, falsy
  result/error presence, notifications, server-initiated requests, null/absent
  ids, malformed JSON, frame extraction incl. multibyte bodies), and the
  manual gate was rewritten (`scripts/lsp-smoke.mjs`): strict Content-Length
  framing, sequential request/response validation with exact ids, notifications
  sent as notifications, and two modes — raw (evidence; the two known-defect
  assertions fail with the raw frames shown) and `--through-proxy`
  (the release gate; passes 22/22 with the real v1.2.0 binary).

### Karkain 1.2.0 compatibility (verified live, Windows AMD64)

- `--version` reports `Karkain Compiler v1.2.0 (windows/amd64, Stable Build)`;
  the version probe, structured-diagnostics gate (1.1.0+) and server-version
  gate all accept it.
- `karkain ide info` **exists in v1.2.0** (schemaVersion 1, machine-readable
  toolchain contract) — the prior "no `ide info` at all" note (v1.0.0) is
  outdated; see `docs/KARKAIN-INSPECTION.md` §8.2. Consuming it (Phase 13)
  remains unimplemented in this milestone by design.
- `check` routing re-verified: the default kcc engine does not honour
  `--format=json` (and on a machine without gcc/kcc it cannot run at all);
  the extension's two-engine probe (default, then `KARKAIN_ENGINE=go`) yields
  structured diagnostics where the toolchain can produce them and raw output
  otherwise. `target`, `config`, `explain`, `fmt`, `help` all work; `test`
  requires a working C toolchain.
- Compiler discovery through `karkain.compilerPath` unchanged; missing toolchain
  paths are surfaced (probe outcome notFound/unrecognized/failed) rather than
  guessed.

### Testing (v1.0.0 gates, this tree)

- Unit suite: 188/188 passing (was 166 at recovery baseline).
- Extension-host suite: 20/20 passing against a local VS Code on Windows
  (`npm run test:integration`), covering multi-root windows.
- `test:lsp-smoke` (raw): 20/22 — exactly the two known server-defect
  assertions fail, with raw frames as evidence.
- `test:lsp-smoke:proxy` (release gate): **22/22 PASS** with the real v1.2.0
  binary, including a clean server exit (code 0).
- `test:toolchain-smoke` could not run here (no gcc; the self-hosted kcc
  engine crashes with `0xC000014D` on this machine, and it must never be run
  with CWD inside the compiler repository because it can trigger a rebuild of
  `kcc.exe` there). CI legs for the other two OSes are unverified.

### Phase 1 foundation (testability), Phase 12, Phase 14, Phase 15

This increment is user-visible from Phase 15 onwards: a multi-root window now
resolves each file against its own folder's project, target and toolchain. The
Phase 1 portion is a testability change with no user-visible behaviour effect,
and it closes the testability gap that the audit identified as the root blocker
for the rest of Phase 1. Phases 12 and 14 are covered in their own sections
below.

### Phase 12 — LSP capability negotiation and project model

- The negotiation helpers in `src/lsp.ts` were written but never called; they
  are now wired into `startLanguageClient` through `reportServerCapabilities`,
  which inspects the real `InitializeResult` the client holds after `start()`
  resolves. Compatibility is decided **only** from the server's own
  `serverInfo.version`, never from the CLI `--version` probe — the two can
  diverge, and conflating them let a stale toolchain version stand in for the
  server's. A missing or unparseable server version is reported as unverifiable,
  never as supported.
- A reduced capability set warns and names what is missing but never stops a
  working server: a missing capability degrades one feature, it does not make
  language intelligence unusable.
- **Changing `karkain.compilerPath` now restarts the language server.** The
  running server was spawned from the previous executable and would otherwise
  keep answering for a toolchain the user has moved away from, while the status
  bar happily showed the new path. The restart is serialized behind a single
  in-flight promise, so the manual `Karkain: Restart Language Server` command and
  an automatic one cannot interleave for the one client slot. It is logged and
  confirmed in the status bar rather than happening silently.

### Project model (`karkain.toml`)

- `src/project.ts` previously only located a manifest; `manifestPath` was dead
  code outside its own test. It now parses the manifest into a real project
  model (`parseManifest`, `readManifest`, `loadProject`, `describeProject`),
  giving `manifestPath`, `name`, `version`, `description`, `license` and
  `targets` a consumer.
- The parser is a deliberately small TOML subset: top-level `key = value`
  assignments, matching the flat output of Karkain 1.1.0 `pkg init` (not the
  SPEC §10.1 `[package]` table). It is quote-aware, so a `//` inside a string
  value is data rather than a comment.
- It reports what it cannot model instead of guessing: section tables, unmodelled
  keys, wrongly-typed values, and arrays left unterminated at EOF are all
  recorded, so a partial read is visible rather than silently believed.
- `Karkain: Show Environment` now reports the project name, version, license and
  targets, and names any manifest sections or keys it does not model.

### Phase 14 — CI integration job

- `.github/workflows/ci.yml` gained an `integration` job that runs
  `npm run test:integration` on the same 3-OS matrix as `validate`, closing the
  Phase 11 note that the extension-host suite never ran in CI. It is a separate
  job so the fast unit suite is never blocked behind an Electron start, and uses
  `fail-fast: false` so one OS failing still reports the other two.
- Linux wraps the runner in `xvfb-run` (Electron cannot start without a
  display); Windows and macOS need no wrapper, so a single conditional `run:`
  covers all three. `KARKAIN_VSCODE_DOWNLOAD=1` forces the pinned VS Code build
  in CI instead of whatever is installed on the runner, and failure logs are
  uploaded as artifacts.

### Phase 15 — Multi-root workspace support

- **A multi-root window now works properly.** Project-root and configuration
  resolution are per-folder and per-document instead of assuming one project,
  so a window holding a `.kark` file per folder — each with its own
  `karkain.toml` — builds, runs, checks and formats each one in its own
  project, with its own target and its own toolchain.
- New `src/workspace.ts` owns the ownership rule as pure code, unit-tested
  without Electron. The **longest** containing root wins, so a nested root
  beats its parent; matching is segment-boundary aware, so `/proj/app` never
  claims `/proj/application`; case folds only on the case-insensitive
  filesystems, so distinct-case roots stay distinct on Linux; and a file
  outside every root resolves to nothing rather than to an arbitrary root.
- **Settings are read per folder.** All four `karkain.*` settings now take a
  resource scope and are declared `"scope": "resource"`, so each can be set per
  folder. This matters because an _unscoped_ `getConfiguration` returns the
  first folder's value for every file — the previous behaviour would have
  silently given root B root A's compiler path, target and format-on-save.
- The toolchain picker and target picker are now honest in a multi-root
  window: with an active file they write a **folder-scoped** value, so choosing
  a toolchain in root A does not change root B, and the confirmation says
  which root it applied to. With no active file they fall back to the
  workspace-level setting rather than to an arbitrary root's.
- `Karkain: Show Environment` names the active folder, reports a multi-root
  window as such, and says plainly when the active file is outside every root
  rather than implying a project it does not belong to.
- Adding or removing a folder is observed (`onDidChangeWorkspaceFolders`), so
  folder-scoped status and toolchain facts are recomputed against the new root
  set instead of going stale.
- **Known limitation, deliberate:** the language server remains a single
  window-wide client spawned from the workspace-wide `karkain.compilerPath`. A
  per-folder compiler path therefore governs CLI commands, tasks and
  formatting decisions, but not the language server's own executable — running
  two toolchains concurrently would mean a per-root client, duplicating the
  server, its output channel and the diagnostics stream. This is stated in
  `docs/ARCHITECTURE.md` rather than left to be discovered.

### Testing (Phase 15)

- The extension-host suite now opens `fixtures/multiroot.code-workspace`, a
  genuine **two-root** window over two deliberately different Karkain projects
  (`fixtures/project` and a new `fixtures/project-other` with its own name,
  version and targets). `src/test/suite/multiroot.test.ts` asserts folder
  ownership, that a file outside both roots gets no fabricated association, and
  that folder-scoped settings do not leak between roots. The existing
  single-root assertions in `activation.test.ts` were kept and now run _inside_
  that two-root window, so "one client, one set of registrations,
  root-count-independent commands" is enforced rather than assumed.
- Unit suite: 150 → 166 cases, covering the root-ownership rule including the
  segment-boundary and case-folding edge cases, and the single-root
  compatibility that existing users depend on.
- **The extension-host cases were executed locally on 2026-11-14** against a
  local VS Code on Windows (no other VS Code instance open): `npm run
test:integration` reports **20 passing**, including the multi-root suite
  above. They compile and type-check; the Phase 14 CI job is what covers the
  other two OSes.

### Correctness fixes found while writing the above

- Diagnostics: Karkain severities were mapped onto the wrong VS Code levels, so
  warnings and hints were displayed as errors. `toVscodeSeverityLevel` now owns
  the toolchain→VS Code decision and is unit-testable without an extension host.
- Grammar: the `const` keyword was not highlighted, and Karkain block comments
  were not recognized. Both are fixed in `syntaxes/karkain.tmLanguage.json` and
  `language-configuration.json`, with keyword-scope assertions added so a
  keyword silently losing its scope fails the suite.

### Testing

- Unit suite: 132 → 150 cases. The new cases cover the manifest parser (verified
  1.1.0 flat manifest, multi-line and empty arrays, comment handling, CRLF,
  escapes, duplicate keys, section tables, wrong value types, unterminated
  arrays) and a case that parses the committed `fixtures/project/karkain.toml`,
  so the parser is checked against real toolchain output rather than only
  synthetic strings.
- Three extension-host cases were added for the project model and the
  serialized restart path. **Executed locally on 2026-11-14: 20/20 passing**
  (`npm run test:integration`, local VS Code, Windows). Run it with no other
  VS Code instance open to reproduce.

### Phase 1 — toolchain seam

- **Toolchain seam** (`src/toolchainService.ts`): every Karkain process now
  starts through one `ToolchainService.run(args, {cwd, env, timeoutMs, token})`
  call. `child_process` is imported in exactly one file. The service captures
  stdout, stderr and an ordered `combined` transcript, and reports a missing
  executable (`notFound`) separately from a non-zero exit, so callers no longer
  re-derive that distinction.
- `extension.ts` refactored onto the seam. Behaviour preserved, including the
  two-engine `check --format=json` probe (both probes are required by the CLI
  contract and are documented in place). The previous 120 s probe timeout is now
  applied to `check`, `test` and the debug build as well as the version probe,
  so a hung compiler can no longer hang a command indefinitely.
- `activate()` now returns a small API (`{ setToolchainService }`) so the
  extension-host suite can substitute the seam.
- **In-memory fake** (`src/test/fakes/toolchainFake.ts`): programmable per
  invocation, records argv/cwd/env for assertions. Ships in neither the VSIX
  nor production paths (`out/test/**` is already excluded).
- **Extension-host suite** (`src/test/suite/`, `npm run test:integration`):
  asserts activation, registration of all 11 contributed commands, the `karkain`
  language id, survival of a completely missing toolchain, and that `--version`
  and `karkain target` are reached through the injected service. This is the
  first coverage of the activation path, which previously had none.
  The runner prefers a locally installed VS Code (`KARKAIN_VSCODE_PATH`,
  else the standard install locations) and only downloads a pinned build as a
  fallback, which avoids a ~340 MB download on developer machines.
- Unit suite: 89 → 104 cases. The new cases cover the real Node implementation
  (stdout/stderr separation, exit codes, ENOENT, env overlay, timeout kill,
  cancellation) and the fake (recording, per-call behaviour, combined output).
  Writing the fake surfaced a real defect in it — a response with an explicit
  `code: null` was coerced to `0` by `??` — which is now covered.

## [0.9.1] — 2026-10-02 (Phase 1 integration hardening)

Defect-fix release. No new features; nothing that previously worked was
removed. Every change below is a verified correctness or packaging fix.

- Manifest: removed the duplicated `contributes.menus` declaration (two
  byte-identical `editor/context` blocks). A duplicate JSON key is silently
  dropped by parsers, so the manifest looked correct while the source was
  ambiguous. Behaviour is unchanged; a new manifest test walks the raw
  `contributes` text and fails on any duplicated key.
- Formatting: the Karkain language server advertises `formattingProvider`, so
  the language client is now the **single** formatting provider. The competing
  extension-side `karkain fmt` `DocumentFormattingEditProvider` was removed
  (including its save-then-reload-into-an-edit workaround). No fallback
  formatter was faked: without a language server there is no formatter, and
  `Karkain: Format Document` now says so.
- Diagnostics: each `check --format=json` diagnostic is attributed to the file
  named by its own `file` field instead of the active editor. Relative paths
  resolve against the effective Karkain project root, absolute paths are
  normalized and preserved (Windows drive letters and forward slashes handled),
  and blank values fall back to the checked document. Multi-file checks no
  longer misreport another file's error in the open editor.
- Diagnostics: ranges now use the schema's optional `endColumn`, so
  span-aware findings are underlined instead of rendered as zero-width markers.
  Missing, zero, non-numeric or non-advancing end positions stay single-position
  diagnostics; ranges are never negative, inverted or fabricated. The schema has
  no end-line field, so spans never cross a line.
- Diagnostics: `Karkain: Check File` now runs from the same effective working
  directory as every other file command (the `karkain.toml` project root when
  detected, else the workspace folder), which also anchors relative diagnostic
  paths.
- Tasks: the `karkain` task provider now applies the configured `karkain.target`
  to `build`/`run`, exactly as the `Build File`/`Run File` commands do. The
  configured target no longer silently disappears depending on how the user
  invokes Build. With no target configured the argv is unchanged.
- Toolchain errors: a missing executable, an unrecognized version banner and a
  non-zero `--version` exit are now distinguished and each surfaces a
  user-facing message (previously log-only). Repeated probes on configuration
  changes notify once per distinct problem instead of on every probe. Logging,
  manual toolchain selection and the trusted-workspace policy are unchanged.
- Packaging: `.vscodeignore` now excludes developer-only `docs/`, `fixtures/`
  and `scripts/` from the VSIX. `templates/` is deliberately still shipped —
  the README instructs users to copy `templates/launch.json` and
  `templates/tasks.json` into their own workspace.
- Retained (investigated, not a defect): the two-engine `check --format=json`
  probe is a compatibility requirement, not redundancy. `KCCCheckCommand`
  takes no format argument and cannot emit JSON; only the Go backend's
  `CheckCommandFormatted(..., json)` writes the schema-v1 array. Both probes are
  now documented in `docs/ARCHITECTURE.md`.

## [0.9.0] — 2026-09-24 (Phase 9 release readiness)

- 128×128 extension icon (`images/karkain-icon.png`, generated and
  pixel-verified) wired into the manifest and the VSIX.
- Tag-gated release automation (`.github/workflows/release.yml`): tag/version
  match check, full validation, VSIX build, GitHub Release with the VSIX asset
  and CHANGELOG notes. Marketplace publication stays a manual owner step.
- `docs/RELEASE.md`: versioning policy, release runbook, verification
  checklist, Marketplace prerequisites with the `karkain` publisher placeholder
  called out as pending owner decision.
- Activation banner now reads the manifest version at runtime (no sync drift).

## [0.8.0] — 2026-09-24 (Phase 8 hardening)

- Security documented (`docs/SECURITY.md`) and audited: argv-only spawning, no
  `shell:true`/network/telemetry, quoted terminal lines with
  trailing-backslash hardening, workspace-trust refusal, no toolchain
  auto-download.
- `quoteTerminalArg` extracted from the terminal path with unit tests;
  PATH dedupe is case-sensitive on Linux; test discovery guards failures.
- Editor context menu for check/build/run/test/debug on `.kark` files.
- New manual `scripts/toolchain-smoke.mjs` gate (15/15 PASS live: version,
  check, schema-v1, fmt, targets, cross behaviors, tests, `-g` build).

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
