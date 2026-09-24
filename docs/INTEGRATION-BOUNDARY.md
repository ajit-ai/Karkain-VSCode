# Integration Boundary

The extension is an integration layer only. The Karkain compiler, runtime,
formatter, test runner, debugger and language server remain owned by
`ajit-ai/Karkain`. Nothing in `src/` parses, type-checks, optimizes, links,
formats or executes Karkain code; every result is produced by spawning the
real toolchain.

## Available now (implemented against Karkain 1.1.0 + VS Code APIs)

- `.kark` recognition, TextMate grammar (`source.karkain`), language
  configuration (comments/brackets/folding) — ported from the in-tree prototype.
- Commands `check/build/run/formatDocument/showEnvironment/restartLanguageServer`,
  all mapped 1:1 to real CLI invocations.
- Problems-panel diagnostics from `check --format=json` schema v1. Verified:
  the default (kcc) engine renders human text, so the extension attempts the
  default engine first and falls back to a `KARKAIN_ENGINE=go` probe, which
  emits the JSON array (empty + exit 0 on pass, exit 3 with items on failure).
- Document formatting via in-place `karkain fmt` (verified: rewrites the file,
  prints `formatted.`/`already formatted.`). The provider saves the buffer,
  runs `fmt`, then reloads disk content as the edit; dirty-buffer formatting
  without save is refused rather than misapplied.
- `karkain lsp` stdio client (completion/hover/definition/symbols/semantic
  tokens/diagnostics per pkg/lsp ServerCapabilities), verified live 17/17 via
  `scripts/lsp-smoke.mjs`, with a dedicated output channel, 1.1.0 version gate
  and init-failure surfacing.
- Terminal build/run, `build -g` + `cppdbg`/GDB debug template (no custom UI).
- Toolchain discovery via PATH + `karkain.compilerPath`, version probe,
  `target`/`config` environment reporting.
- Target selection over the live `karkain target` matrix (triples + compute
  targets with CLI-reported maturities), `karkain.target` wired into build/run,
  status-bar indicator; debugging stays host-only by design.

## Available through an existing interface (wired later, no Karkain change needed)

- Testing API over the real runner: `*_test.kark` discovery (semantic symbols
  first, logged textual fallback), per-file runs, `PASS/FAIL` + totals parsing,
  assertion detail with navigation, cancellation, `Karkain Test` channel. No
  invented test framework; `--filter` is not used for single-test scoping
  because it is substring-based; debug-test waits for Phase 6.
- Tasks integration for build/clean/workspace — Phase 4.
- Target selection (`karkain target` matrix + `--target` flag) — Phase 7 (only
  targets the installed toolchain reports; experimental ones labeled as such).
- `karkain.toml` project-root detection + workspace commands — Phase 4.

## Possible integration points (require 1.1.0 verification first)

- `karkain ide info` JSON contract for capability advertisement.
- `kir --verify` output for compiler-pipeline diagnostics.
- `prof`/`debug`-trace output channels.

## Future capability requiring Karkain changes (explicitly NOT claimed)

- Debug Adapter Protocol server (only GDB/`cppdbg` today).
- LSP rename/references/code actions/workspace symbols (absent from server capabilities).
- Registry network operations, GPU/NPU/Quantum run-debug, `vscode.dev` support
  (native toolchain processes are desktop-only).
- Formatter range formatting / selection (only whole-document `fmt` exists).

If an extension feature needs a missing Karkain capability, it is documented
here first; the Karkain repository is never modified from this project and no
capability is duplicated inside the extension to fake completeness.
