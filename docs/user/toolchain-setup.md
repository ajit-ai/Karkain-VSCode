# Toolchain Setup (Karkain from source)

If `karkain --version` works but `check`/`build`/`test` fail, you are almost
certainly on a **source-built** Karkain without a usable engine on this
machine.

## Symptoms and cures

| Symptom                                                                                 | Cause                                                         | Fix                                                                                                              |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `cannot locate src/compiler to build the self-hosted engine (set KARKAIN_KCC)` (exit 6) | Running outside a Karkain source checkout; `kcc` not prebuilt | Build `kcc` (needs gcc) and set `KARKAIN_KCC=<path-to-kcc.exe>`, or `KARKAIN_ENGINE=go`, or use a release binary |
| `check` exits 3 with **no output**                                                      | `kcc` cannot run on this machine (e.g. `0xC000014D`)          | Use `KARKAIN_ENGINE=go`; the extension's two-engine probe does this automatically for diagnostics                |
| `test` prints `no cross-linker available for target …` (exit 4)                         | No C linker found (`gcc`, `clang`, `cl.exe`)                  | Install a C toolchain                                                                                            |
| `build` fails with "gcc not available to link the self-hosted engine output" (exit 6)   | gcc missing                                                   | Install GCC/MinGW-w64 or MSVC, or use `KARKAIN_ENGINE=go` for pure validation                                    |

## Never do this

- Do not run the extension's smoke gates with CWD inside the Karkain source
  tree: `scripts/toolchain-smoke.mjs` can trigger a **rebuild of `kcc.exe`**
  there. Point it at a released binary instead.
- Do not copy `kcc.exe` around by hand; the CLI rebuilds it when stale.

## The Go engine

`KARKAIN_ENGINE=go` selects the in-tree Go front end. It is what the LSP and
the test runner use, and it is what `check --format=json` requires. It does
not need the compiler tree to be locatable, but it still needs a C linker
for building/running binaries.
