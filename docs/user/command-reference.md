# Compiler Command Reference (Karkain 1.2.0)

Captured verbatim from `karkain --help` and `karkain ide info` (schemaVersion 1)
on 2026-11-14. Exit codes: `0` success · `1` program failure · `2` CLI usage
error · `3` compile/type/sema · `4` test failure · `5` package/dependency ·
`6` infrastructure (e.g. no usable C compiler).

## Core

| Command | Syntax                         | Notes                                                                                              |
| ------- | ------------------------------ | -------------------------------------------------------------------------------------------------- |
| run     | `karkain run <file.kark>`      | Compiles then executes. Program arguments are **not** forwarded by the v1.2.0 CLI.                 |
| build   | `karkain build <file.kark>`    | `-o <path>`, `-g` (debug symbols), `-c` (compile only, .c23), `--target <triple>`                  |
| check   | `karkain check <file.kark>`    | Default kcc engine ignores `--format=json`; JSON only via `KARKAIN_ENGINE=go`.                     |
| test    | `karkain test <path>`          | Discovers `*_test.kark`; `--filter <pattern>`; `test --compile [dir]` runs the diagnostics corpus. |
| lint    | `karkain lint <file.kark>`     | Full front-end analysis incl. borrow checker.                                                      |
| fmt     | `karkain fmt <file.kark>`      | Rewrites in place. `fmt --check` verifies only.                                                    |
| clean   | `karkain clean [path] [--all]` | Removes generated artifacts; sources are never touched.                                            |
| bench   | `bench <path>`                 | Times `bench_*` functions.                                                                         |
| prof    | `prof <file.kark>`             | Compile, run and profile.                                                                          |

## Inspection

| Command  | Syntax                             | Notes                                                |
| -------- | ---------------------------------- | ---------------------------------------------------- |
| explain  | `karkain explain <code>`           | Numeric codes: K001… K114, K121/K122/K127.           |
| kir      | `karkain kir <file.kark>`          | Emits KIR v1 text; `kir --verify` checks structure.  |
| target   | `karkain target`                   | Lists supported `--target` values + compute targets. |
| config   | `karkain config`                   | Effective toolchain configuration.                   |
| ide info | `karkain ide info`                 | Machine-readable contract (schemaVersion 1).         |
| dbg      | `dbg <file.kark>`                  | Live gdb walk. Requires gdb.                         |
| wit      | `karkain wit [--stubs] <file.wit>` | Parses WIT interfaces.                               |

## Project & Packages

`init`, `new`, `add`, `remove`, `fetch`, `update`, `list`, `tree`,
`pkg init|add|remove|update|upgrade|fetch|deps|search|info|list|tree` —
dependencies are resolved against the registry; `pkg add --source git|local
--url <url>` adds non-registry deps.

## Workspace

`workspace list|build|test|check|run|clean|lint|graph|init|add|remove` —
dependency-ordered operations across the members listed by `workspace init`
and `workspace add <path>`.

## In this extension

The **Compiler Commands** view (Control Center) shows this inventory with
search; commands wired to actions run them (failures surface in the UI);
other entries copy the verbatim usage to the clipboard. Nothing is invented
or auto-executed behind your back.
