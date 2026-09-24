# Architecture

Lightweight TypeScript extension, no frameworks, no WebViews, no bundled runtime.

```
package.json (manifest: language, grammar, commands, settings)
language-configuration.json / syntaxes/karkain.tmLanguage.json
src/
  extension.ts    activation, commands, terminals, Problems wiring,
                  formatting provider, LSP client lifecycle, output channel
  toolchain.ts    pure: version parse/compare, .kark match, argv builders
  diagnostics.ts  pure: check --format=json schema-v1 parsing/validation
  config.ts       settings access (compilerPath/debuggerPath/formatOnSave)
  test/unit/      mocha unit tests for the pure modules
fixtures/         real .kark programs (hello-world, diagnostics negatives)
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

Phase 1 owns one channel: `Karkain` (activation, probe results, check/format
failures, `showEnvironment`). Build/Test/Debug/LSP channels arrive with the
phases that own those integrations (4/5/6/3).
