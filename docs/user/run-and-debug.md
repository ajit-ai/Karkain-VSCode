# Run & Debug Guide

## Run

`Karkain: Run File` (Ctrl+Alt+R) compiles and executes the active `.kark`
file in the integrated terminal.

- The working directory is the nearest `karkain.toml` root, else the owning
  workspace folder.
- `--target` is honoured from your scoped `karkain.target` setting.
- **Program arguments are not forwarded by the v1.2.0 CLI.**
  `karkain run file.kark a b c` silently drops `a b c` (verified: the CLI
  collects `extraArgs` but never consumes it). Pass
  flags for the compiler CLI itself only (e.g. `--verbose` via
  `karkain.runArgs`).
- The process lives in the terminal: `Ctrl+C` there — or
  **Karkain: Stop Run** — interrupts it. Exit codes are visible in the terminal.

## Re-run and history

**Karkain: Re-run Last Run** re-executes the last run with the same file,
scope and args. **Karkain: Recent Actions** lists the last runs/checks/builds
you launched from the extension.

## Debug

There is **no native Karkain Debug Adapter**. `Karkain: Debug File`:

1. builds the current file with `karkain build -g` (debug symbols + `#line`
   directives),
2. launches the result under **GDB** via Microsoft's `cppdbg`,
3. breakpoints, stepping, variables, call stack and watch — through GDB.

Prerequisites (all checked by **Karkain: Check Debug Prerequisites**):

- GDB on PATH (or `karkain.debuggerPath` set to the binary),
- The **C/C++ extension** (`ms-vscode.cpptools`) providing `cppdbg`,
- A working `karkain build -g` (i.e. a C toolchain).

If any is missing, the command fails loudly with the specific reason —
nothing is faked. Test files (`*_test.kark`) cannot be debugged (no `main`).
Debugging always uses a host build regardless of `--target`.
