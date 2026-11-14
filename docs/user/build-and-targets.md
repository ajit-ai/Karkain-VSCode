# Build & Targets Guide

## Engines (verified on 1.2.0)

| Engine        | Select via                       | Behavior                                                                                                                                                     |
| ------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| kcc (default) | default, or `KARKAIN_ENGINE=kcc` | Self-hosted compiler; emits C23 and links through gcc. **Cannot bootstrap without gcc** — from a source tree it needs `src/compiler` + gcc or `KARKAIN_KCC`. |
| Go front end  | `KARKAIN_ENGINE=go`              | In-tree Go implementation; used by the LSP, test runner and `check --format=json`.                                                                           |

The extension probes the Go engine automatically when it needs structured
diagnostics and the default engine cannot produce them. It never silently
swaps the engine for anything except that narrow fallback.

## Targets

`karkain target` prints the supported `--target` values, a default, and a
maturity-labelled compute section (cpu, simd, gpu-experimental — research).

- **native** — host default.
- **c23** — C23 source output.
- **native-x86_64-linux / -macos / -windows** — C-free self-hosted output.
- **wasm32-wasi** — WebAssembly WASI module.
- Aliases are canonicalized by `--target` (e.g. x86_64-windows ≈ native on this host).

The extension offers `Karkain: Select Target`, scoped per workspace folder,
and appends `--target` to `build`/`run` only when set.

## Flags for build

| Flag                    | Meaning                            |
| ----------------------- | ---------------------------------- |
| `-o <path>`             | Output binary path                 |
| `-g` / `--debug`        | Debug symbols + `#line` directives |
| `-c` / `--compile-only` | Keep the generated `.c23` artifact |
| `--target <triple>`     | Select output target               |
| `--verbose`             | Detailed pipeline logs             |

## In this extension

- **Karkain: Build File** uses your scoped `--target`.
- **Karkain: Clean** removes generated artifacts only (sources are never touched by the toolchain).
- Builds cannot be awaited by the extension when sent to a terminal; terminal output is the truth — watch for the exit code shown there.
