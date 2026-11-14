# Release Notes — Karkain Language Tools 1.0.0 (candidate)

**Not published.** v1.0.0 is an unpublished release candidate: Windows gates
are verified locally; macOS/Linux legs and real-world validation are pending.
See the repository `CHANGELOG.md` and `docs/RELEASE.md`.

## Highlights

- **Karkain Control Center** — activity-bar entry with: Overview (compiler,
  language server, target, last check/build/run/test, project manifest), Quick
  Actions, Projects & Files, Compiler Commands (the full v1.2.0 inventory with
  search), Standard Library and Examples navigation (path-configured), and an
  integrated Documentation centre.
- **Protocol repair for the Karkain LSP defect** — `out/lsp-proxy.js`
  rewrites only the server's empty-envelope responses; the hover
  "neither result nor error" failure and the shutdown/exit-code-1 chain are
  fixed at the source boundary without touching the compiler.
- **LSP reliability** — bounded start (20s), serialized restarts, restart on
  `compilerPath` change, deactivate never throws.
- **Multi-root correctness** — folder-scoped settings, per-folder project
  detection, longest-root/segment-boundary ownership.
- **Structured diagnostics** — `karkain check --format=json` via a two-engine
  probe; honest raw-output fallback otherwise.
- **New commands** — Lint, Explain Error Code, Toolchain Configuration,
  Toolchain Contract (`ide info`), Workspace Build/Test/Check/Graph,
  New Project, Add Package, Fetch, Run Health Check, Diagnostic Report
  export/copy, Debug Prerequisites, Set LSP Trace Level.
- **Run experience** — terminal run with scoped target and env, re-run last
  run, recent-action history, and a stop action that interrupts the run
  terminal.

## Honest notes

- No native Karkain **Debug Adapter** exists; debugging works through GDB
  (`cppdbg`) when GDB + the C/C++ extension are installed.
- The **Self-hosted (kcc) engine** cannot bootstrap without a C compiler and
  may crash it on memory-constrained machines; the Go engine is the verified
  fallback. `karkain test` links a native binary and therefore needs a linker.
- Program arguments are **not forwarded** by the v1.2.0 `run` command.
