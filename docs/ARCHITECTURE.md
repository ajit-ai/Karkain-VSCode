# Architecture

Lightweight TypeScript extension, no frameworks, no WebViews, no bundled runtime.

```
package.json (manifest: language, grammar, commands, settings)
language-configuration.json / syntaxes/karkain.tmLanguage.json
src/
  extension.ts    activation, commands, terminals, Problems wiring,
                  formatting provider, LSP client lifecycle, output channels
  toolchain.ts    pure: version parse/compare, .kark match, argv builders
  diagnostics.ts  pure: check --format=json schema-v1 parsing/validation
  lsp.ts          pure: server capability negotiation, version gate, symbol kinds
  config.ts       settings access (compilerPath/debuggerPath/formatOnSave)
  test/unit/      mocha unit tests for the pure modules
fixtures/         real .kark programs (hello-world, diagnostics negatives,
                  syntax showcase, lsp smoke)
scripts/          manual gates requiring a real toolchain (lsp-smoke, not in CI)
docs/             inspection, boundary, roadmap, architecture
```

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
`showEnvironment`) and `Karkain Language Server` (client output + trace, init
failure surfacing). Build/Test/Debug channels arrive with the phases that own
those integrations (4/5/6).

## Language intelligence (Phase 3)

The client talks to the real `karkain lsp` over stdio. Verified live against
1.1.0: full-sync + save, completion (`.`/`:`), hover, definition,
documentSymbol (func/type+fields/enum+variants), semanticTokens/full,
formatting, push `publishDiagnostics` with source ranges. Absent server-side
(and therefore never faked): rename, references, code actions, workspace
symbols, inlay hints, code lens, call hierarchy. `scripts/lsp-smoke.mjs`
(`npm run test:lsp-smoke -- <karkain-bin>`) replays the handshake against a
real binary; it is a manual gate, not CI, because CI has no toolchain.
