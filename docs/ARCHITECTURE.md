# Architecture

Lightweight TypeScript extension, no frameworks, no WebViews, no bundled runtime.

```
package.json (manifest: language, grammar, commands, settings)
language-configuration.json / syntaxes/karkain.tmLanguage.json
src/
  extension.ts    activation, commands, terminals, Problems wiring,
                  formatting provider, LSP client lifecycle, output channels
  toolchainService.ts  the only importer of child_process: ToolchainService
                  interface + Node implementation (run/exec seam)
  toolchain.ts    pure: version parse/compare, .kark match, argv builders
  diagnostics.ts  pure: check --format=json schema-v1 parsing/validation
  lsp.ts          pure: server capability negotiation, version gate, symbol kinds
  project.ts      pure: karkain.toml root detection + manifest parsing
  workspace.ts    pure: multi-root ownership (which root contains this path)
  tasks.ts        pure: task argv/label/group builders
  testing.ts      pure: test discovery + PASS/FAIL/summary parsing
  debug.ts        pure: -g build argv, program path, cppdbg launch/attach configs
  targets.ts      pure: target-matrix/detail parsing, --target argv insertion
  config.ts       settings access (compilerPath/debuggerPath/formatOnSave/target)
  test/unit/      mocha unit tests for the pure modules + the toolchain service
  test/fakes/     in-memory ToolchainService (never spawns; out/test is
                  excluded from the VSIX)
  test/suite/     extension-host suite (mocha `tdd`) run by
                  `npm run test:integration` via scripts/run-integration.mjs
fixtures/         real .kark programs (hello-world, diagnostics negatives,
                  syntax showcase, lsp smoke)
scripts/          manual gates requiring a real toolchain (lsp-smoke,
                  toolchain-smoke) plus the extension-host runner
docs/             inspection, boundary, roadmap, architecture
```

## Testability boundary

`src/toolchainService.ts` is the single seam between the extension and the
`karkain` executable; nothing else imports `child_process`. `activate()`
returns `{ setToolchainService }`, so the extension-host suite can substitute a
fake and exercise activation, command registration and the CLI-backed commands
with no Karkain toolchain installed.

Two suites, deliberately separate:

- `npm run test:unit` — mocha over `out/test/unit`, no editor process, no
  download. Covers pure logic plus the real `NodeToolchainService` (which
  spawns `node -e` and the local editor-independent paths).
- `npm run test:integration` — real VS Code extension host. Covers activation
  and provider/command registration. Prefers a locally installed VS Code and
  falls back to downloading a pinned build; set `KARKAIN_VSCODE_PATH` to point
  at a specific editor, or `KARKAIN_VSCODE_DOWNLOAD=1` to force the download.

## Lifecycle

`activate` → create `Karkain` output channel + `karkain` diagnostic collection
→ probe `karkain --version` (record semver for capability gating) → start
`karkain lsp` client (guarded: missing `vscode-languageclient` only disables
intelligence, never the shell-out commands) → register commands/providers →
re-probe on `karkain.*` setting changes. `deactivate` stops the client.

## Process model (security)

- All spawning uses argv APIs (`execFile`/`spawn`), never shell strings.
- Terminal commands are user-visible `karkain <args>` lines with double-quote
  file wrapping (same convention as the in-tree prototype).
- No network access, no telemetry, no secret handling. Executable resolution is
  PATH + explicit setting only; no auto-download of toolchains.
- `capabilities.untrustedWorkspaces.supported: false`: the extension spawns a
  compiler and requires a trusted workspace.

## Output

Channels: `Karkain` (activation, probe results, check/format failures,
`showEnvironment`), `Karkain Language Server` (client output + trace, init
failure surfacing) and `Karkain Test` (per-file `$ karkain test …` runs with
raw output and exit codes). Build/Debug channels arrive with the phases that
own those integrations (4 done via terminals, 6).

## Language intelligence (Phase 3)

The client talks to the real `karkain lsp` over stdio. Verified live against
1.1.0: full-sync + save, completion (`.`/`:`), hover, definition,
documentSymbol (func/type+fields/enum+variants), semanticTokens/full,
formatting, push `publishDiagnostics` with source ranges. Absent server-side
(and therefore never faked): rename, references, code actions, workspace
symbols, inlay hints, code lens, call hierarchy. `scripts/lsp-smoke.mjs`
(`npm run test:lsp-smoke -- <karkain-bin>`) replays the handshake against a
real binary; it is a manual gate, not CI, because CI has no toolchain.

## Formatting ownership (single provider)

`karkain lsp` advertises `formattingProvider` (`pkg/lsp/handler.go`), so the
language client is the **only** formatting provider for `.kark`. The extension
deliberately registers no `DocumentFormattingEditProvider`: the previous
extension-side `karkain fmt` provider competed with the server for the same
operation. `karkain.formatDocument` and `karkain.formatOnSave` both route
through `editor.action.formatDocument`, which resolves to the language client.
When no language server is running there is no formatter — no CLI fallback is
faked. Formatting remains whole-document; range formatting does not exist in
the toolchain.

## Diagnostics mapping (Phase 1)

`karkain check --format=json` is parsed into `vscode.Diagnostic` objects by the
pure helpers in `src/diagnostics.ts`:

- **File attribution** — the schema carries a per-diagnostic `file`, and
  `karkain check` reports per-file spans, so one invocation can describe several
  files. `resolveDiagnosticFile` resolves each `file` to an absolute path
  (relative paths against the effective cwd, absolute paths normalized and
  preserved, blank values falling back to the checked document) and diagnostics
  are grouped per resolved file. They are never all pinned to the active
  editor.
- **Ranges** — `toDiagnosticRange` converts 1-based `line`/`column` to 0-based
  and uses the schema's optional `endColumn` when it is usable. The schema has
  no end-line field, so spans never cross a line. Missing, zero, non-numeric or
  non-advancing `endColumn` values yield a single-position diagnostic rather
  than an inverted or fabricated range.
- **Working directory** — `runCheck` uses the same `effectiveCwd` model as every
  other file command (karkain.toml project root, else workspace folder, else
  undefined), which also anchors relative diagnostic paths.

## Language client lifecycle

There is exactly one language client, held in a single module-level slot. Every
path that replaces it goes through `restartLanguageClientAndStart`, which
serializes stop-then-start behind one in-flight promise: concurrent callers
share the same run instead of interleaving for the slot, and a stop can never
race the next start. It is reached from two places:

- the `Karkain: Restart Language Server` command, and
- `onDidChangeConfiguration`, when `karkain.compilerPath` changes.

The second case matters because the server is spawned from the resolved
executable at start time: without a restart, a changed `compilerPath` would
leave the old toolchain's server answering while the UI reported the new path.
The restart is logged and confirmed in the status bar — a brief loss of language
intelligence is never silent.

`deactivate()` must never reject: it stops the client inside an explicit
rejection handler and logs the failure instead of throwing. A server that
cannot stop cleanly must not take extension-host teardown down with it.

### Protocol repair shim (`out/lsp-proxy.js`)

`karkain lsp` answers responses with **neither `result` nor `error`** for
every handler that produces no value (unresolvable hover/definition, and
**every** `shutdown` — always, unconditionally; see
`docs/KARKAIN-INSPECTION.md` §8.3). vscode-languageclient classifies that
envelope as neither a response nor a notification and rejects the pending
request with "The received response has neither a result nor an error
property.", which on the stop path ALSO prevents the `exit` notification,
leaving the server to break its stdin pipe abnormally (observed as exit code 1
from the Go side: `cmd/karkain` `handleLSP` exits `ExitFailure` on any
non-EOF read error).

The extension therefore spawns the server through a standalone, dependency-free
shim (`src/lsp-proxy.ts`, compiled to `out/lsp-proxy.js`, shipped in the VSIX):

- It frames the server→client byte stream (Content-Length) and rewrites ONLY
  envelopes that carry an `id` but neither `result` nor a non-null `error`,
  adding `"result": null` — the JSON-RPC 2.0 / LSP-spec answer. Notifications,
  requests, valid responses and error responses pass through byte-for-byte.
- All other bytes are forwarded unmodified; an unframable stream is passed
  through verbatim with a one-time stderr notice (never guessed at).
- Repairs are logged to **stderr**, which the client forwards to the Karkain
  Language Server output channel — the repair is visible, never silent.
- The client spawns the shim as `node out/lsp-proxy.js <karkain exe> lsp` via
  the extension host's own Electron binary with `ELECTRON_RUN_AS_NODE=1`
  (no separate Node runtime on user machines). Verified on this machine with
  the local VS Code Electron against the real v1.2.0 binary.
- The shim mirrors process lifecycle: signals/EOF flow to the child, and the
  proxy exits with the child's exit code (verified: clean code 0 on stdin
  EOF after `exit`).
- Once Karkain fixes `JSONRPCResponse.Result` omitempty upstream, every
  message passes through unchanged — a harmless pipe, kept for safety.
- If `out/lsp-proxy.js` is missing, the extension spawns `karkain lsp`
  directly and logs the degraded state rather than failing activation.

## Project model

`src/project.ts` owns both halves of the project concept: locating a
`karkain.toml` and reading it. The parser is a deliberately small TOML subset
(flat top-level `key = value` assignments) because that is what Karkain 1.1.0
`pkg init` actually emits — not the `[package]` table sketched in SPEC §10.1.
It models `name`, `version`, `description`, `license` and `targets`, and records
everything else it meets (`sections`, `extraKeys`) rather than guessing, so
`Karkain: Show Environment` can distinguish "absent" from "present but unread".

## Multi-root windows

A workspace may have any number of roots, and two of them may be entirely
different Karkain projects. Nothing in the extension may therefore assume that
"the" project, "the" target or "the" compiler path is a single value.

**Ownership is one rule, in one place.** `src/workspace.ts` is pure and
vscode-free, and holds the whole decision:

- the **longest** containing root wins, so a nested root resolves to itself
  rather than to its parent;
- matching is **segment-boundary aware**, so `/proj/app` never claims
  `/proj/application` — the classic string-prefix bug;
- case folds only on the case-insensitive filesystems (`win32`, `darwin`), so
  distinct-case roots stay distinct on Linux;
- a file outside every root resolves to **nothing**. Falling back to
  `workspaceFolders[0]` would fabricate an association with an unrelated
  project, and the resulting `cwd` would silently be the wrong directory.

`isPathInsideRoot` handles the platform explicitly and is unit-tested without
Electron, which is why the rule can be tested exhaustively at all.

**Settings are resolved with a resource scope.** Every getter in
`src/config.ts` takes an optional `scope`. This is not a stylistic choice: an
unscoped `vscode.workspace.getConfiguration('karkain')` returns the **first
folder's** value for every file in the window, so the unscoped form silently
gave root B root A's toolchain, target and format-on-save. Call sites pass the
folder that owns the file being acted on (`configScopeFor` /
`configScopeForDoc`). All four settings are declared `"scope": "resource"` in
the manifest so they can be set per folder in the first place.

**Commands resolve from the acted-on file.** `effectiveCwd` walks up to the
nearest `karkain.toml`, falling back to the file's owning folder. Tasks,
`runInTerminal`, the toolchain picker and the target picker all derive their
scope from the file in question. The pickers _write_ folder-scoped in a
multi-root window, so a choice made for one root does not change another, and
they fall back to the workspace-level setting when there is no active file
rather than to an arbitrary root's.

**One language client, deliberately.** `karkain lsp` is a single stdio server,
and the client selects every `karkain` document regardless of root, so one
client already serves a multi-root window. The consequence is stated rather
than hidden: the server runs from the **workspace-wide**
`karkain.compilerPath`, so a per-folder compiler path governs CLI commands,
tasks and formatting but _not_ the server's own executable. Per-root clients
would duplicate the server, its output channel and the diagnostics stream, and
concurrently running two toolchains is a different design, not a bug fix.

Folder add/remove is observed via `onDidChangeWorkspaceFolders` so folder-scoped
status and toolchain facts are recomputed against the new root set instead of
going stale.

## Diagnostic engine probing (compatibility, not redundancy)

Two engines are probed for `check --format=json`, and both are required by the
Karkain 1.1.0 CLI contract:

- `cmd/karkain/main.go` routes `check` on the default (kcc) engine to
  `cli.KCCCheckCommand(nil, file, verbose)`, which takes **no format argument**
  and can only render the human report.
- The Go backend routes `check` to `cli.CheckCommandFormatted(..., json)`, the
  only path that writes a schema-v1 JSON array to stdout.

The first probe is therefore the fast path for a toolchain whose default engine
honours the flag, and the second is what yields structured diagnostics when it
does not. Removing the first would break a toolchain that honours the flag on
its default engine; removing the second would leave the extension with no
structured diagnostics at all. Unparseable output still falls back to the raw
compiler report in the `Karkain` channel — never fabricated diagnostics.
