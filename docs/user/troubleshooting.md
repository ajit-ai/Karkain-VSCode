# Troubleshooting

## "Request textDocument/hover failed. The received response has neither a result nor an error property."

Root-caused: the Karkain LSP server emits an **empty envelope** (no `result`,
no `error`) for every response with no value — **every** `shutdown`, and any
hover/definition with no resolvable target. The extension repairs this in a
stdio shim (`out/lsp-proxy.js`) that rewrites only that exact envelope to
`"result": null`. Repairs are logged to the **Karkain Language Server**
output channel as `[lsp-proxy] repaired …`.

- If you see it anyway: you are on an old build — update, or check the output
  channel for shim-repair lines (and consider filing a bug if a _different_
  message shape is involved).
- This shim is temporary. Once Karkain fixes `pkg/lsp` (drop `omitempty` from
  `JSONRPCResponse.Result`), it degrades to a no-op.

## Language server won't start / exit code 1

- `Karkain: Restart Language Server` re-spawns it (logged, serialized).
- Check the **Karkain Language Server** output channel.
- The server exits 1 on abnormal pipe breaks (read error) — usually preceded
  by a crash line in stderr, also shown there.

## `check` reports errors in a clean file

- Expected on a machine where `kcc` cannot run: clean `check` exits 3 with
  **no output**. The Run-Check diagnostics path probes the Go engine
  automatically and shows real diagnostics or silence with a log line — never
  fabricated messages.
- See [Toolchain Setup](toolchain-setup.md).

## Nothing in the Testing view

- Test files must match `**/*_test.kark` and define `test_*` functions.
- Discovery uses document symbols; a transient failure falls back to textual
  scanning (logged).

## Manifest shows "unmodelled keys/sections"

- The parser is a deliberate TOML subset (flat `key = value`). Sections like
  `[package]` are reported, never merged. See `docs/ARCHITECTURE.md`.

## Multi-root: settings seem to leak

- Settings are folder-scoped (`resource`). Files in root B get root B's
  compilerPath/target/formatOnSave. If not, please report with a minimal
  reproduction.

## Quick fixes

- `Karkain: Run Health Check` diagnoses the common 90% of misconfigurations.
- `Karkain: Show Environment` prints resolved paths, target and project data.
