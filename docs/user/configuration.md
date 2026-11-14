# Configuration Reference

All `karkain.*` settings can be set per workspace folder (recommended in
multi-root windows) in addition to globally. Unscoped reads see the first
folder's value — prefer scoping.

| Setting                    | Type    | Default   | Scope    | Meaning                                                                                                           |
| -------------------------- | ------- | --------- | -------- | ----------------------------------------------------------------------------------------------------------------- |
| `karkain.compilerPath`     | string  | `karkain` | resource | Compiler executable (absolute path or PATH name).                                                                 |
| `karkain.debuggerPath`     | string  | `gdb`     | resource | GDB binary for `cppdbg` debugging.                                                                                |
| `karkain.formatOnSave`     | boolean | `false`   | resource | Format `.kark` on save via the formatter (language server).                                                       |
| `karkain.target`           | string  | `""`      | resource | `--target` triple. Empty = host default.                                                                          |
| `karkain.engine`           | string  | `""`      | resource | `KARKAIN_ENGINE` for spawned processes: `""` (default/kcc), `kcc`, `go`.                                          |
| `karkain.runArgs`          | string  | `""`      | resource | Extra CLI flags appended to `karkain run` (e.g. `--verbose`). **Program arguments are not forwarded by the CLI.** |
| `karkain.buildArgs`        | string  | `""`      | resource | Extra CLI flags appended to `karkain build`.                                                                      |
| `karkain.env`              | object  | `{}`      | resource | Extra environment variables for compiler processes and run terminals.                                             |
| `karkain.workingDirectory` | string  | `""`      | resource | Override the cwd used by run/build (empty = auto: manifest root → folder).                                        |
| `karkain.trace.server`     | string  | `off`     | resource | Language-server trace: `off`, `messages`, `verbose` (logs to the output channel).                                 |
| `karkain.stdlibPath`       | string  | `""`      | resource | Path to a local `stdlib/` checkout (Standard Library view).                                                       |
| `karkain.examplesPath`     | string  | `""`      | resource | Path to a local `examples/` checkout (Examples view).                                                             |

## Which settings change what

- Commands, tasks and terminals resolve the **folder-scoped** value for the
  file they act on; the language server is a single window-wide client and
  therefore uses the **workspace-wide** `compilerPath` (known limitation).
- Changing `karkain.compilerPath` restarts the language server automatically
  (logged, serialized).
- `karkain.env` is applied to spawned processes **and** to run terminals you
  launch from the extension.

## Multi-root behavior

Ownership is "longest containing root wins" (segment-boundary aware). A file
outside every root resolves to nothing rather than to an arbitrary root;
folder-scoped settings never leak across folders.
