// Pure debug helpers for native debugging of Karkain programs.
// Verified model (docs/KARKAIN-INSPECTION.md §6): `karkain build -g` emits a
// binary with Karkain runtime symbols (karkain_user_*), debugged via GDB
// through the standard cppdbg configuration. No debug adapter exists in the
// toolchain, so the extension drives cppdbg directly and never invents one.

export function debugBinaryPath(file: string, platform: NodeJS.Platform): string {
  const withoutExt = file.toLowerCase().endsWith('.kark') ? file.slice(0, -'.kark'.length) : file;
  return platform === 'win32' ? `${withoutExt}.exe` : withoutExt;
}

// `karkain build -g <file> -o <program>`: debug symbols + #line directives.
export function debugBuildArgs(file: string, program: string): string[] {
  return ['build', '-g', file, '-o', program];
}

export interface CppdbgLaunchConfig {
  name: string;
  type: 'cppdbg';
  request: 'launch';
  program: string;
  args: string[];
  stopAtEntry: boolean;
  cwd: string;
  MIMode: 'gdb';
  miDebuggerPath: string;
  setupCommands: { description: string; text: string; ignoreFailures: boolean }[];
}

export function cppdbgLaunchConfig(program: string, debuggerPath: string): CppdbgLaunchConfig {
  return {
    name: 'Karkain: Debug current file (gdb)',
    type: 'cppdbg',
    request: 'launch',
    program,
    args: [],
    stopAtEntry: false,
    cwd: '${workspaceFolder}',
    MIMode: 'gdb',
    miDebuggerPath: debuggerPath,
    setupCommands: [
      {
        description: 'Pretty-print Karkain Value cells',
        text: '-enable-pretty-printing',
        ignoreFailures: true,
      },
    ],
  };
}

export interface CppdbgAttachConfig {
  name: string;
  type: 'cppdbg';
  request: 'attach';
  program: string;
  processId: string;
  MIMode: 'gdb';
  miDebuggerPath: string;
}

export function cppdbgAttachConfig(program: string, debuggerPath: string): CppdbgAttachConfig {
  return {
    name: 'Karkain: Attach to process (gdb)',
    type: 'cppdbg',
    request: 'attach',
    program,
    processId: '${command:pickProcess}',
    MIMode: 'gdb',
    miDebuggerPath: debuggerPath,
  };
}
