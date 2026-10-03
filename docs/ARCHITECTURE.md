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
  project.ts      pure: karkain.toml root detection
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
