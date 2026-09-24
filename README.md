# Karkain for Visual Studio Code

Professional development environment for the [Karkain programming
language](https://github.com/ajit-ai/Karkain) (`.kark`): syntax highlighting,
`karkain check` Problems integration, `build`/`run` terminal workflows,
`karkain fmt` formatting, and Karkain Language Server (`karkain lsp`)
intelligence. This is an integration layer only — the compiler, runtime,
formatter, test runner and language server live in the Karkain repository.

## Requirements

- Karkain **1.1.0** toolchain (`karkain` on `PATH` or `karkain.compilerPath`).
  Structured `check` diagnostics need `--format=json` (1.1.0+); older
  toolchains get raw-output fallback, never fabricated diagnostics.
- VS Code **1.75+** (desktop; the toolchain spawns native processes).
- A C compiler (GCC/Clang/MSVC) for `build`/`run`; GDB + the Microsoft C/C++
  extension for native debugging.

## Install (local `.vsix`)

```sh
npm install
npm run package
code --install-extension karkain-0.6.0.vsix
```

## Commands

`Karkain: Check File` · `Build File` · `Run File` · `Clean` · `Test` ·
`Format Document` · `Show Environment` · `Select Toolchain` ·
`Restart Language Server`

## Testing

`Testing` view lists `*_test.kark` files and their `test_*` functions
(discovered via document symbols). Run files or individual tests; results,
assertion output and the totals line appear under each test and in the
`Karkain Test` channel. Debug-test arrives with Phase 6.

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
`gdb`) · `karkain.formatOnSave` (default `false`).

## Known limitations (Phase 6)

- `karkain fmt` whole-document formatting requires Karkain 1.1.0+.
- Semantic features follow the server: rename, references, code actions and
  workspace symbols are absent from `karkain lsp` and are not faked.
- No target-picker UI yet (Phase 7); no debug-test profile (test files do not
  link).
- Desktop VS Code only; `vscode.dev` is unsupported (native toolchain).

## Development

```sh
npm install
npm run typecheck
npm run lint
npm run format:check
npm run test:unit
npm run package
# manual gate, needs a 1.1.0+ binary (not in CI):
npm run test:lsp-smoke -- /path/to/karkain
```

See `docs/KARKAIN-INSPECTION.md` (toolchain truth), `docs/INTEGRATION-BOUNDARY.md`
(capability claims), `docs/ARCHITECTURE.md` and `docs/ROADMAP.md`.

## License

MIT — see [LICENSE](LICENSE).
