# Security

Karkain for VS Code is a security-sensitive developer tool: it spawns a
compiler toolchain. The rules below are enforced in code and reviewed every
phase (see `docs/ROADMAP.md` Phase 8).

## Process spawning

- Every spawn uses argv APIs (`child_process.execFile`/`spawn`) with argument
  vectors built in `src/toolchain.ts` (`checkArgs`, `buildArgs`, …). There is
  no `shell: true`, no `exec`, and no shell-string concatenation anywhere in
  `src/` (audited; CI would fail lint on new violations only by review).
- Terminal lines (`karkain build/run/clean`) are user-visible and double-quoted
  with `quoteTerminalArg`, which escapes inner quotes and doubles trailing
  backslashes so a path cannot escape its quotes on Windows shells.

## Executables and paths

- Resolution order: explicit `karkain.compilerPath` setting, else PATH lookup
  over `candidateExecutableNames` — no hard-coded install directories and no
  automatic toolchain downloads, ever.
- `Select Toolchain` lists only files that exist at pick time and re-checks
  before saving. A missing executable surfaces as an actionable error, never a
  silent fallback.
- `karkain.toml` detection requires a manifest _file_ (a same-named directory
  is rejected); upward search stops at the filesystem root and treats every
  filesystem error as "no project".

## Workspace trust

- `capabilities.untrustedWorkspaces.supported: false`: the extension refuses to
  activate compiler spawning in untrusted workspaces.

## Environment and data

- The only environment override the extension sets is `KARKAIN_ENGINE=go` for
  the structured-diagnostics probe (the one path the toolchain documents for
  schema-v1 JSON). Everything else inherits the ambient environment.
- No network access, no telemetry, no source-code collection, no credentials
  or secrets handling. `Show Environment` prints only local toolchain facts
  into a local output channel.

## Source-built toolchains

- Release-installed toolchains are CWD-independent. A source-built `karkain`
  additionally needs its compiler tree (`KARKAIN_KCC` or CWD inside the
  Karkain tree); without it, commands fail with the toolchain's own exit-6
  diagnostic, which the extension reports verbatim.

## Reporting

Report a security issue via
[GitHub issues](https://github.com/ajit-ai/Karkain-VSCode/issues) (do not post
secrets). Toolchain vulnerabilities belong to
[the Karkain repository](https://github.com/ajit-ai/Karkain/security).
