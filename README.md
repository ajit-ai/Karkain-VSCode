# Karkain for Visual Studio Code

Professional development environment for the [Karkain programming
language](https://github.com/ajit-ai/Karkain) (`.kark`): Control Center
sidebar, syntax highlighting, `karkain check` Problems integration, `build` /
`run` terminal workflows, `karkain fmt` formatting, and Karkain Language
Server (`karkain lsp`) intelligence with a protocol-repair shim for the
server's empty-envelope defect. This is an integration layer only — the
compiler, runtime, formatter, test runner and language server live in the
Karkain repository.

Target release: **1.0.0** (unpublished release candidate; see "Release status"
below).

## Requirements

- Karkain **1.1.0+** toolchain (`karkain` on `PATH` or `karkain.compilerPath`);
  every claim below was re-verified live against **Karkain 1.2.0** (Windows,
  AMD64). Structured `check` diagnostics need `--format=json` (1.1.0+, Go
  engine); older toolchains get raw-output fallback, never fabricated
  diagnostics.
- VS Code **1.75+** (desktop; the toolchain spawns native processes).
- A C compiler (GCC/Clang/MSVC) for `build`/`run`/`test`; GDB + the Microsoft
  C/C++ extension (`ms-vscode.cpptools`) for native debugging. On a
  source-built Karkain (no released binary), `check`/`build`/`run`/`test`
  need either a `gcc` on `PATH` (to bootstrap the self-hosted engine) or
  `KARKAIN_KCC` pointing at a prebuilt `kcc` engine — or `KARKAIN_ENGINE=go`.

## Install (local `.vsix`)

```sh
npm install
npm run package
code --install-extension karkain-1.0.0.vsix
```

Release builds are attached to GitHub Releases (see `docs/RELEASE.md`); the
Marketplace step is a separate, manual owner decision.

## The Control Center

The **Karkain** activity-bar entry hosts seven views:

- **Overview** — compiler version/status, language server, workspace, active
  project (`karkain.toml`), scoped target, last check/build/run/test outcomes,
  last health result.
- **Quick Actions** — the daily verbs in one place.
- **Projects & Files** — every workspace folder, its manifest (name/version,
  declared targets, unmodelled keys), its folder-scoped toolchain and target.
- **Compiler Commands** — the verified v1.2.0 inventory (~full `--help`
  surface) with search; runs what the extension wires, copies verbatim usage
  otherwise. Nothing is invented.
- **Standard Library** — browse a local `stdlib/` checkout via
  `karkain.stdlibPath` (module list + descriptions from the source's own
  headers). Empty until configured — the extension cannot bundle the library.
- **Examples** — browse a local `examples/` checkout via
  `karkain.examplesPath`. Empty until configured.
- **Documentation** — bundled, verified user guides (offline; ships in the
  package): getting started, syntax, command reference, build & targets,
  run & debug, testing, configuration, toolchain setup, troubleshooting,
  release notes.

## Commands (highlights)

Palette: `Karkain: Check File`, `Build File`, `Run File`, `Run File with
Options…`, `Re-run Last Run`, `Stop Run`, `Recent Actions…`, `Lint File`,
`Explain Error Code…`, `Test`, `Debug File (gdb)`, `Format Document`,
`Verify Formatting (fmt --check)`, `Clean`, `New Project…`, `Open Project…`,
`Open Project Manifest`, `Select Toolchain`, `Select Compiler Engine`,
`Select Target`, `Workspace Build`, `Workspace Test`, `Workspace Check`,
`Workspace Dependency Graph`, `Add Package…`, `Fetch Dependencies`,
`Show Environment`, `Show Toolchain Configuration`, `Show Toolchain Contract
(ide info)`, `Run Health Check`, `Export/Copy Diagnostic Report`, `Check
Debug Prerequisites`, `Set Language Server Trace Level…`, `Open
Documentation`, `Restart Language Server`.

Editor shortcuts (on `.kark` files): `Ctrl+Alt+R` run · `Ctrl+Alt+B` build ·
`Ctrl+Alt+C` check · `Ctrl+Alt+T` test · `Ctrl+Alt+D` debug.

Context menus: editor/context (check/build/run/lint/explain/test/debug),
explorer/context (run/build/lint on `.kark`), and an editor toolbar with Run
and (when GDB + C/C++ extension are present) Debug buttons.

## Multi-root workspaces

Fully supported. Folder-scoped settings, per-folder project detection (the
longest containing root wins, segment-boundary aware), and folder-scoped
toolchain/target/format-on-save. A file outside every root resolves to no
root. The language server is one window-wide client (see Known Limitations).

## Testing

`Testing` view lists `*_test.kark` files and their `test_*` functions
(discovered via document symbols). Run files or individual tests; results,
assertion output and the totals line appear under each test and in the
`Karkain Test` channel. Note: `karkain test` links a native binary, so it
requires a C toolchain; on a machine without one the linker's own error is
surfaced verbatim.

## Tasks

`Terminal → Run Task` offers `karkain: build/check/run/clean` for the active
`.kark` file (build is the default build task with the `$gcc` matcher; clean
runs in the `karkain.toml` project root when detected).

## Debugging

Requires GDB and the C/C++ extension (`cppdbg`). `Karkain: Debug File` builds
the active file with `karkain build -g` and launches it under GDB —
breakpoints, stepping, variables, call stack, watch and evaluate all come from
GDB. **There is no native Karkain Debug Adapter**; debugging always uses a
host build. `Karkain: Check Debug Prerequisites` reports what is missing.
Test files (`*_test.kark`) cannot be debugged.

## Settings

All settings are `resource`-scoped (settable per folder in multi-root
windows):

`karkain.compilerPath` (default `karkain`) · `karkain.debuggerPath` (`gdb`) ·
`karkain.formatOnSave` (`false`) · `karkain.target` (empty = host default) ·
`karkain.engine` (`""` default, `kcc`, `go` — see the Build guide) ·
`karkain.runArgs`, `karkain.buildArgs` (extra CLI flags; note the v1.2.0 CLI
does **not** forward program arguments) · `karkain.env` (extra environment for
compiler processes and run terminals) · `karkain.workingDirectory` (empty =
auto: manifest root → folder) · `karkain.trace.server` (`off`/`messages`/
`verbose`) · `karkain.stdlibPath`, `karkain.examplesPath` (navigation paths).

Changing `karkain.compilerPath` restarts the language server (logged,
serialized).

## Compatibility matrix (verified live on Windows AMD64)

| Surface                                                                          | Status                                                             |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `--version`, `ide info` (schemaVersion 1)                                        | ✅ works                                                           |
| `check` clean file, default engine                                               | ⚠️ needs host where `kcc` can run (gcc or release `kcc`)           |
| `check` invalid file                                                             | ✅ exits 3 with diagnostics (Go preflight)                         |
| `check --format=json`                                                            | ✅ via Go engine only (kcc path ignores the flag)                  |
| `fmt`, `fmt --check`, `target`, `config`, `explain`                              | ✅ works                                                           |
| `lsp` (initialize/hover/completion/definition/symbols/semanticTokens/formatting) | ✅ works; empty-envelope defect repaired by the shipped shim       |
| `test`                                                                           | ⚠️ links a native binary — requires a C toolchain                  |
| `workspace …`, `build`, `run`                                                    | ⚠️ codegen/linking requires a C toolchain                          |
| `bench`, `prof`, `kir`, `dbg`, `wit`                                             | ✅ invocation verified; `kcc`-backed paths need the same toolchain |

## Known limitations

- The language server is a single window-wide client spawned from the
  workspace-wide `karkain.compilerPath`; per-folder compiler paths govern CLI
  commands, tasks and formatting but not the server's own executable.
- The **kcc** engine cannot bootstrap without a C compiler; on machines where
  `kcc` cannot run, clean `check` exits 3 with empty output. The extension's
  two-engine probe recovers diagnostics where possible.
- `karkain run` does **not** forward program arguments (verified in the v1.2.0
  source); `karkain.runArgs` is for compiler CLI flags only.
- Interactive run/build commands run in an integrated terminal; their exit
  codes are not observable to the extension, so the Control Center records
  "launched" (never a fabricated result). The spawn-based `check` records the
  real outcome.
- GPU/NPU/Quantum targets are model-only/research-grade per the toolchain;
  debugging targets are host-build only.
- No native Debug Adapter; debugging is GDB via `cppdbg`.
- Desktop VS Code only (native toolchain); `vscode.dev` unsupported.
- **macOS/Linux legs are unverified in this build**; the CI matrix is declared
  for all three OSes but has never run (see Release status).

## Release status

**1.0.0 is an unpublished release candidate.** Gates verified locally on
Windows AMD64: compile, typecheck, lint, format:check, **unit 224/224**,
**extension-host 22/22** (local VS Code), LSP smoke through the repair shim
**22/22** (raw mode shows the two known server-defect assertions failing as
designed). Not yet run: CI on macOS/Linux (the `integration` job exists but
has never executed), `test:toolchain-smoke` (this machine lacks a C compiler;
`kcc` crashes), real-world validation. Not tagged, not released, not
published. See `docs/RELEASE.md`.

## Development

```sh
npm install
npm run typecheck
npm run lint
npm run format:check
npm run test:unit
npm run test:integration   # extension host (uses a local VS Code if present,
                           # otherwise downloads a pinned build)
npm run package
# manual gates, need a 1.1.0+ binary (not in CI):
npm run test:lsp-smoke -- /path/to/karkain          # raw evidence: known server defects FAIL
npm run test:lsp-smoke:proxy -- /path/to/karkain    # release gate through the shim: must PASS
npm run test:toolchain-smoke -- /path/to/karkain    # blocked without gcc/kcc on the host
```

## Troubleshooting

- `cannot locate src/compiler` (exit 6): a source-built `karkain` needs its
  compiler tree — set `KARKAIN_KCC`, work inside it, or use a release binary.
- `check`/`build`/`test` fail with linker/engine errors: see
  [Toolchain Setup](docs/user/toolchain-setup.md).
- `Karkain: could not start the karkain executable`: set
  `karkain.compilerPath` or add karkain to PATH, then `Karkain: Show
Environment`.
- `Request textDocument/hover failed ... neither a result nor an error
property`: the Karkain server's empty-envelope defect. The shipped shim
  repairs it; if you still see it, a different defect is involved — capture
  the Karkain Language Server output channel and report it.
- `Karkain: the language server did not start`: the server never answered
  `initialize` (bounded at 20s) or the shim is missing. CLI commands still
  work; see the output channel for the reason.
- **Karkain: Run Health Check** diagnoses the common misconfigurations;
  **Karkain: Export/Copy Diagnostic Report** captures the details.

See `docs/KARKAIN-INSPECTION.md` (toolchain truth), `docs/INTEGRATION-BOUNDARY.md`
(capability claims), `docs/ARCHITECTURE.md` and `docs/ROADMAP.md`.

## License

MIT — see [LICENSE](LICENSE).
