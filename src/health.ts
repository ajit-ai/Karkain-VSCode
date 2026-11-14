// Diagnostics & environment health for the Karkain extension.
//
// Two layers:
//   * `buildHealthReport` (this file, pure): renders the report from gathered
//     inputs. No I/O, no vscode, no process spawning — unit-tested.
//   * The extension gathers the inputs (fs checks, --version probe, target
//     matrix parse, manifest parse, gdb probe, shim presence) and renders.
//
// SECURITY: this module never receives or emits environment variable VALUES.
// Inputs carry booleans/labels/paths only. The report must stay free of
// credentials, so `includes` here means "labels and versions", never env.

export type HealthStatus = 'ok' | 'warn' | 'fail' | 'info';

export interface HealthLine {
  label: string;
  status: HealthStatus;
  detail: string;
  /** Concrete next step, present when status is not 'ok'. */
  remediation?: string;
}

export interface HealthInput {
  vscodeVersion: string;
  platform: string;
  extensionVersion: string;
  compilerPathSetting: string;
  compilerPathResolved: string | null;
  compilerExists: boolean;
  probe: { ok: boolean; version?: string; rawBanner?: string; detail?: string };
  engineSetting: string;
  targetSetting: string;
  lsp: { running: boolean; restarts: number; lastError?: string };
  shim: { present: boolean; repairsLogged?: number };
  workspaceRoots: string[];
  manifest: { found: boolean; summary?: string; problem?: string } | null;
  gdb: { pathSetting: string; found: boolean };
  stdlibPathSet: boolean;
  examplesPathSet: boolean;
  ideInfo: { kind: 'ok' | 'invalid' | 'unsupported' | 'not-probed'; detail?: string };
  /** Count of diagnostics pushed for open files; 0 when none observed. */
  diagnosticCount: number;
}

export interface HealthReport {
  overall: HealthStatus;
  text: string;
  lines: HealthLine[];
}

function mark(status: HealthStatus): string {
  switch (status) {
    case 'ok':
      return 'PASS';
    case 'warn':
      return 'WARN';
    case 'fail':
      return 'FAIL';
    case 'info':
      return 'INFO';
  }
}

export function buildHealthReport(input: HealthInput): HealthReport {
  const lines: HealthLine[] = [];
  const push = (label: string, status: HealthStatus, detail: string, remediation?: string) =>
    lines.push({ label, status, detail, remediation });

  push('VS Code', 'info', `v${input.vscodeVersion} on ${input.platform}`);
  push('Extension', 'info', `karkain v${input.extensionVersion}`);

  push(
    'Compiler path (setting)',
    'info',
    input.compilerPathSetting.length > 0 ? input.compilerPathSetting : '(default: karkain)',
  );
  if (!input.compilerExists) {
    push(
      'Compiler executable',
      'fail',
      `not found at "${input.compilerPathResolved ?? input.compilerPathSetting}"`,
      'Install Karkain 1.1.0+ (verified 1.2.0) or set karkain.compilerPath to the binary.',
    );
  } else if (input.probe.ok) {
    push('Compiler executable', 'ok', `found; v${input.probe.version}`);
  } else {
    push(
      'Compiler executable',
      'warn',
      `found, but the version probe failed: ${input.probe.detail ?? 'unparseable banner'}`,
      'Point karkain.compilerPath at a real Karkain binary and re-run Karkain: Show Environment.',
    );
  }

  if (input.probe.ok && input.probe.rawBanner) {
    push('Compiler banner', 'info', input.probe.rawBanner.split('\n')[0]);
  }

  push(
    'Language server',
    input.lsp.running ? 'ok' : 'warn',
    input.lsp.running
      ? `running (restarts this session: ${input.lsp.restarts})`
      : `not running (restarts this session: ${input.lsp.restarts})${input.lsp.lastError ? ` — last error: ${input.lsp.lastError}` : ''}`,
    input.lsp.running
      ? undefined
      : 'Run Karkain: Restart Language Server; check the Karkain Language Server output channel.',
  );

  push(
    'Protocol repair shim',
    input.shim.present ? 'ok' : 'warn',
    input.shim.present
      ? `out/lsp-proxy.js present${input.shim.repairsLogged !== undefined ? ` (repairs logged: ${input.shim.repairsLogged})` : ''}`
      : 'out/lsp-proxy.js missing — server spawns directly; the Karkain empty-envelope defect (shutdown, unresolvable hover) will surface as errors.',
    input.shim.present ? undefined : 'Reinstall the extension or rebuild (npm run compile).',
  );

  if (input.engineSetting) {
    push('Compiler engine (setting)', 'info', `KARKAIN_ENGINE=${input.engineSetting}`);
  } else {
    push(
      'Compiler engine (setting)',
      'info',
      'toolchain default (kcc on 1.2.0; KARKAIN_ENGINE=go selects the Go front end)',
    );
  }
  push('Target (setting)', 'info', input.targetSetting.length > 0 ? input.targetSetting : '(host default)');

  if (input.workspaceRoots.length > 0) {
    push('Workspace roots', 'info', input.workspaceRoots.join(', '));
  } else {
    push(
      'Workspace roots',
      'warn',
      'no workspace folder open',
      'Open a folder containing a karkain.toml or a .kark file.',
    );
  }

  if (input.manifest === null) {
    push('Karkain project (karkain.toml)', 'info', 'no manifest in scope');
  } else if (!input.manifest.found) {
    push(
      'Karkain project (karkain.toml)',
      'warn',
      input.manifest.problem ?? 'not found or unreadable',
      'Create one with Karkain: New Project, or check that karkain.toml parses (flat keys only; see docs).',
    );
  } else {
    push('Karkain project (karkain.toml)', 'ok', input.manifest.summary ?? 'present');
  }

  push(
    'GDB debugger',
    input.gdb.found ? 'ok' : 'warn',
    input.gdb.found ? `found (${input.gdb.pathSetting})` : `not found at "${input.gdb.pathSetting}"`,
    input.gdb.found
      ? undefined
      : 'Install GDB or the MSYS2/mingw-w64 gdb, or set karkain.debuggerPath. Debug of all targets additionally requires a working `karkain build -g`.',
  );

  push(
    'Standard library navigation',
    'info',
    input.stdlibPathSet
      ? 'stdlib path configured'
      : 'not configured (set karkain.stdlibPath to the stdlib/ directory for module navigation)',
  );
  push(
    'Examples navigation',
    'info',
    input.examplesPathSet
      ? 'examples path configured'
      : 'not configured (set karkain.examplesPath to the examples/ directory for the catalogue)',
  );

  if (input.ideInfo.kind === 'ok') {
    push('ide info contract', 'ok', 'schemaVersion 1 accepted');
  } else if (input.ideInfo.kind === 'not-probed') {
    push('ide info contract', 'info', 'not probed this session');
  } else {
    push(
      'ide info contract',
      'warn',
      `not usable (${input.ideInfo.detail ?? input.ideInfo.kind})`,
      'The extension falls back to verified argv vectors; report the divergence if the toolchain claims schemaVersion 1.',
    );
  }

  push(
    'Open-file diagnostics',
    'info',
    input.diagnosticCount === 0 ? 'none reported' : `${input.diagnosticCount} diagnostic(s) currently pushed`,
  );

  const overall: HealthStatus = lines.some((l) => l.status === 'fail')
    ? 'fail'
    : lines.some((l) => l.status === 'warn')
      ? 'warn'
      : 'ok';

  const text = [
    'Karkain — Diagnostic Report',
    `Generated: ${new Date().toISOString()}`,
    '',
    ...lines.map((l) => {
      const head = `[${mark(l.status)}] ${l.label}: ${l.detail}`;
      return l.remediation ? `${head}\n      → ${l.remediation}` : head;
    }),
    '',
    'Notes:',
    '- This report contains no environment variable values and no credentials.',
    '- Compiler target/linker availability varies by engine and machine; a working',
    '  `karkain check` does not imply a working `karkain build` or `test`.',
    '- Known toolchain limitations (verified against Karkain 1.2.0): the default kcc',
    '  engine needs a C compiler to bootstrap and may emit empty output on failure;',
    '  `--format=json` is honoured only by the Go engine; `karkain test` links a',
    '  native binary, so no C linker means tests cannot run.',
  ].join('\n');

  return { overall, text, lines };
}
