# Karkain for Visual Studio Code

Professional development environment for the [Karkain programming
language](https://github.com/ajit-ai/Karkain) (`.kark`): syntax highlighting,
`karkain check` Problems integration, `build`/`run` terminal workflows,
`karkain fmt` formatting, and Karkain Language Server (`karkain lsp`)
intelligence. This is an integration layer only — the compiler, runtime,
formatter, test runner and language server live in the Karkain repository.

## Requirements

- Karkain **1.1.0+** toolchain (`karkain` on `PATH` or `karkain.compilerPath`);
  every claim below was re-verified live against **Karkain 1.2.0** (Windows,
  AMD64). Structured `check` diagnostics need `--format=json` (1.1.0+, Go
  engine); older toolchains get raw-output fallback, never fabricated
  diagnostics.
- VS Code **1.75+** (desktop; the toolchain spawns native processes).
- A C compiler (GCC/Clang/MSVC) for `build`/`run`; GDB + the Microsoft C/C++
  extension for native debugging. On a source-built Karkain (no released
  binary), `check`/`build`/`run`/`test` need either a `gcc` on `PATH` (to
  bootstrap the self-hosted engine) or `KARKAIN_KCC` pointing at a prebuilt
  `kcc` engine — or `KARKAIN_ENGINE=go`.

## Install (local `.vsix`)

```sh
npm install
npm run package
code --install-extension karkain-1.0.0.vsix
```

Release builds are attached to GitHub Releases (see `docs/RELEASE.md`); the
Marketplace step is a separate, manual owner decision.

## Commands

`Karkain: Check File` · `Build File` · `Run File` · `Clean` · `Test` ·
`Debug File` · `Format Document` · `Show Environment` · `Select Toolchain` ·
`Select Target` · `Restart Language Server`

## Targets

`Karkain: Select Target` lists the matrix reported by `karkain target`
(platform triples plus compute targets with their real maturity labels).
The status bar shows the selection; build/run append `--target`. Debugging
always uses a host build. Foreign `run` is refused by the toolchain, and
missing cross-linkers fail loudly — both surface in the terminal.

## Testing

`Testing` view lists `*_test.kark` files and their `test_*` functions
(discovered via document symbols). Run files or individual tests; results,
assertion output and the totals line appear under each test and in the
`Karkain Test` channel. Test files cannot be debugged (they do not link).

## Tasks

`Terminal → Run Task` offers `karkain: build/check/run/clean` for the active
`.kark` file (build is the default build task with the `$gcc` matcher; clean
runs in the `karkain.toml` project root when detected).

## Debugging

Requires GDB and the Microsoft C/C++ extension (`cppdbg`). `Karkain: Debug
File` builds the active file with `karkain build -g` and launches it under
GDB — breakpoints, stepping, variables, call stack, watch and evaluate all
come from GDB. For manual `launch.json` setup, copy `templates/launch.json`
and `templates/tasks.json` to your workspace `.vscode/` and press F5.
`karkain.debuggerPath` selects the GDB binary. Test files cannot be debugged
(they have no `main` and do not link).

## Settings

`karkain.compilerPath` (default `karkain`) · `karkain.debuggerPath` (default
`gdb`) · `karkain.formatOnSave` (default `false`) · `karkain.target` (default
empty = host default).

## Language server protocol repair shim

`karkain lsp` answers responses with **neither `result` nor `error`** whenever
it has no value to return — every `shutdown`, and any hover/definition whose
target does not resolve (whether the server has finished indexing can change
which you get). vscode-languageclient classifies that envelope as neither a
response nor a notification and rejects the request with
"The received response has neither a result nor an error property."; on the
stop path this also prevented the `exit` notification, leaving the server's
pipe to break abnormally (observed as exit code 1).

The extension therefore spawns `karkain lsp` behind `out/lsp-proxy.js`, a
small, dependency-free shim that rewrites ONLY that exact envelope to
`"result": null` — which is what JSON-RPC 2.0 and the LSP mandate. Valid
traffic passes through byte-for-byte; the shim logs every repair to stderr,
which the client forwards to the **Karkain Language Server** output channel.
It needs no Karkain changes and degrades to a zero-effect pipe once Karkain
fixes the server. If `out/lsp-proxy.js` is missing, the extension spawns the
server directly and logs the degraded state.

If you see `Request textDocument/hover failed. The received response has
neither a result nor an error property.` with the shim in place, that is a
**different** defect — report it with the Karkain Language Server output
channel log attached.

## Known limitations

- `karkain fmt` whole-document formatting requires Karkain 1.1.0+ and is served
  by the language server (`karkain lsp`), the only registered formatting
  provider; with no language server there is no formatter.
- Semantic features follow the server: rename, references, code actions and
  workspace symbols are absent from `karkain lsp` and are not faked.
- GPU/NPU/Quantum targets are model-only or research-grade per the toolchain;
  only `cpu`/`simd`/`wasm32-wasi`/native triples execute today.
- Desktop VS Code only; `vscode.dev` is unsupported (native toolchain).

## Development

```sh
npm install
npm run typecheck
npm run lint
npm run format:check
npm run test:unit
npm run test:integration   # extension host; uses a local VS Code if present,
                           # otherwise downloads a pinned build
npm run package
# manual gates, need a 1.1.0+ binary (not in CI):
npm run test:lsp-smoke -- /path/to/karkain          # raw evidence: known server defects FAIL
npm run test:lsp-smoke:proxy -- /path/to/karkain    # release gate through the shim: must PASS
npm run test:toolchain-smoke -- /path/to/karkain    # blocked on this tree without gcc/kcc
```

## Troubleshooting

- `cannot locate src/compiler` (exit 6): a source-built `karkain` needs its
  compiler tree — set `KARKAIN_KCC` to the Karkain source directory or work
  inside it. Release-installed toolchains do not need this.
- `Karkain: could not start the karkain executable`: set
  `karkain.compilerPath` to the binary or put it on `PATH`, then
  `Karkain: Show Environment` to verify.
- `check`/`build`/`test` fail on a source-built toolchain on a machine with
  no C compiler, or `kcc` crashes: the self-hosted engine cannot bootstrap
  there (GCC required, or `KARKAIN_KCC` prebuilt, or `KARKAIN_ENGINE=go` for
  check/test semantics — diagnostics stay honest either way).
- `Request textDocument/hover failed ... neither a result nor an error
property`: this is the Karkain server's empty-envelope defect. The shipped
  shim repairs it; if you still see it, a different message reached the
  client — capture the Karkain Language Server output channel and report it.
- `Karkain: the language server did not start`: the server never answered
  `initialize` (bounded at 20s), crashed, or the shim is missing. The output
  channel carries the reason; CLI commands (`check`/`build`/`run`) still
  work without language intelligence.
- Exit code 1 on server teardown: this was the stop-path symptom of the
  empty-envelope defect on `shutdown`; the shim repairs the envelope and the
  server exits 0 on stdin EOF. If you still see exit code 1, the server died
  abnormally — the output channel carries its stderr.

See `docs/KARKAIN-INSPECTION.md` (toolchain truth), `docs/INTEGRATION-BOUNDARY.md`
(capability claims), `docs/ARCHITECTURE.md` and `docs/ROADMAP.md`.

## License

MIT — see [LICENSE](LICENSE).
