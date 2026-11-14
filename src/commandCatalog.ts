// Authoritative Karkain v1.2.0 command inventory (Windows AMD64), captured
// live from `karkain --help` (2026-11-14). Pure data; consumed by the
// Compiler Commands tree, the command search, and the documentation topics.
//
// Honesty rules:
//   * `usage` is verbatim from the tool's own help text — never paraphrased.
//   * `safeToRunFromIde` is true only for commands that cannot modify the
//     filesystem or the network. Commands that create, delete or rewrite
//     files are marked mutates/destructive and are never auto-executed.
//   * A command absent from this catalogue does not exist in v1.2.0 and is
//     never synthesized into a UI action.

export type CatalogCategory = 'Core' | 'Project & Packages' | 'Workspace' | 'Tooling' | 'Inspection';

export interface CommandSpec {
  /** Stable identifier used as the tree item id and search key. */
  id: string;
  /** The actual verb, e.g. `check`, `workspace build`. */
  name: string;
  /** Verbatim syntax from `karkain --help`. */
  usage: string;
  summary: string;
  category: CatalogCategory;
  /** True when nothing on disk is created, removed or modified. */
  readOnly: boolean;
  /** True when the command can be meaningfully run on <file> from the editor. */
  operatesOnFile: boolean;
  /** True when the command typically needs an extra external toolchain. */
  needsExternalToolchain?: string;
  notes?: string;
}

export const COMMAND_CATALOG: readonly CommandSpec[] = [
  // ---- Core ----
  {
    id: 'run',
    name: 'run',
    usage: 'karkain run <file.kark>',
    summary: 'Compile and run (default)',
    category: 'Core',
    readOnly: true,
    operatesOnFile: true,
    notes:
      'Compiles then executes. Program arguments are NOT forwarded by the v1.2.0 CLI (verified: extraArgs is collected but never consumed by cmd/karkain/main.go).',
  },
  {
    id: 'build',
    name: 'build',
    usage: 'karkain build <file.kark>',
    summary: 'Compile to a native executable',
    category: 'Core',
    readOnly: false,
    operatesOnFile: true,
    needsExternalToolchain: 'gcc/clang/MSVC (kcc links C23 output)',
    notes:
      'Writes the executable next to the source by default; -o sets the path; -g adds debug info; --target selects the output.',
  },
  {
    id: 'check',
    name: 'check',
    usage: 'karkain check <file.kark>',
    summary: 'Validate syntax and semantics',
    category: 'Core',
    readOnly: true,
    operatesOnFile: true,
    notes:
      'Default kcc engine ignores --format=json; JSON diagnostics only via KARKAIN_ENGINE=go (verified). Clean files may exit 6/3 on source-built trees without a compiler tree.',
  },
  {
    id: 'test',
    name: 'test',
    usage: 'karkain test <path>',
    summary: 'Discover and run *_test.kark files',
    category: 'Core',
    readOnly: true,
    operatesOnFile: true,
    needsExternalToolchain: 'C linker (gcc/clang/MSVC)',
    notes:
      'test --compile [dir] runs the compile-pass/compile-fail corpus; --filter <pattern> limits to matching tests.',
  },
  {
    id: 'lint',
    name: 'lint',
    usage: 'karkain lint <file.kark>',
    summary: 'Full front-end analysis (incl. borrow checker)',
    category: 'Core',
    readOnly: true,
    operatesOnFile: true,
  },
  {
    id: 'fmt',
    name: 'fmt',
    usage: 'karkain fmt <file.kark>',
    summary: 'Canonicalize formatting (--check verifies only)',
    category: 'Core',
    readOnly: false,
    operatesOnFile: true,
    notes:
      'REWRITES the file in place without --check. Not used by formatOnSave without going through the formatter provider.',
  },
  {
    id: 'clean',
    name: 'clean',
    usage: 'karkain clean [path] [--all]',
    summary: 'Remove generated artifacts (sources never touched)',
    category: 'Core',
    readOnly: false,
    operatesOnFile: false,
    notes: 'touch nothing outside the path it is given; deletes generated artifacts only.',
  },
  {
    id: 'transpile',
    name: 'transpile',
    usage: 'karkain transpile <file.kark>',
    summary: 'Generate C or other backend output',
    category: 'Core',
    readOnly: true,
    operatesOnFile: true,
  },
  {
    id: 'bench',
    name: 'bench',
    usage: 'bench <path>',
    summary: 'Time bench_-prefixed functions (single run each)',
    category: 'Core',
    readOnly: true,
    operatesOnFile: true,
    needsExternalToolchain: 'C linker',
  },
  {
    id: 'prof',
    name: 'prof',
    usage: 'prof <file.kark>',
    summary: 'Compile, run and profile a program (see prof --help)',
    category: 'Core',
    readOnly: true,
    operatesOnFile: true,
    needsExternalToolchain: 'C linker',
  },

  // ---- Inspection ----
  {
    id: 'explain',
    name: 'explain',
    usage: 'karkain explain <code>',
    summary: 'Explain a toolchain error code',
    category: 'Inspection',
    readOnly: true,
    operatesOnFile: false,
    notes: 'K001..K114+K121/K122/K127 numeric codes; usage: karkain explain K001.',
  },
  {
    id: 'kir',
    name: 'kir',
    usage: 'karkain kir <file.kark>',
    summary: 'Emit KIR v1 text (--verify checks structure, self-hosted)',
    category: 'Inspection',
    readOnly: true,
    operatesOnFile: true,
  },
  {
    id: 'target',
    name: 'target',
    usage: 'karkain target',
    summary: 'List supported --target values',
    category: 'Inspection',
    readOnly: true,
    operatesOnFile: false,
  },
  {
    id: 'config',
    name: 'config',
    usage: 'karkain config',
    summary: 'Print effective toolchain configuration',
    category: 'Inspection',
    readOnly: true,
    operatesOnFile: false,
  },
  {
    id: 'ide-info',
    name: 'ide info',
    usage: 'karkain ide info',
    summary: 'Print machine-readable IDE/toolchain contract (JSON)',
    category: 'Inspection',
    readOnly: true,
    operatesOnFile: false,
    notes: 'schemaVersion 1; verified present in v1.2.0 (absent in v1.0.0).',
  },
  {
    id: 'dbg',
    name: 'dbg',
    usage: 'dbg <file.kark>',
    summary: 'Live gdb walk with Karkain-level backtrace',
    category: 'Inspection',
    readOnly: true,
    operatesOnFile: true,
    needsExternalToolchain: 'gdb',
    notes: 'Interactive debugger walk-through; the extension uses cppdbg (Karkain: Debug File) instead.',
  },
  {
    id: 'wit',
    name: 'wit',
    usage: 'karkain wit [--stubs] <file.wit>',
    summary: 'Parse WIT interfaces (--stubs emits Karkain types)',
    category: 'Inspection',
    readOnly: true,
    operatesOnFile: false,
  },

  // ---- Project & Packages ----
  {
    id: 'init',
    name: 'init',
    usage: 'karkain init [name]',
    summary: 'Create new project (in current dir)',
    category: 'Project & Packages',
    readOnly: false,
    operatesOnFile: false,
  },
  {
    id: 'new',
    name: 'new',
    usage: 'karkain new <name>',
    summary: 'Create a new project directory',
    category: 'Project & Packages',
    readOnly: false,
    operatesOnFile: false,
  },
  {
    id: 'add',
    name: 'add',
    usage: 'karkain add <pkg> [version]',
    summary: 'Add dependency',
    category: 'Project & Packages',
    readOnly: false,
    operatesOnFile: false,
  },
  {
    id: 'remove',
    name: 'remove',
    usage: 'karkain remove <pkg>',
    summary: 'Remove dependency',
    category: 'Project & Packages',
    readOnly: false,
    operatesOnFile: false,
  },
  {
    id: 'fetch',
    name: 'fetch',
    usage: 'karkain fetch',
    summary: 'Fetch resolved dependencies (lockfile)',
    category: 'Project & Packages',
    readOnly: false,
    operatesOnFile: false,
  },
  {
    id: 'update',
    name: 'update',
    usage: 'karkain update [pkg]',
    summary: 'Re-resolve versions, write karkain.lock',
    category: 'Project & Packages',
    readOnly: false,
    operatesOnFile: false,
  },
  {
    id: 'list',
    name: 'list',
    usage: 'karkain list',
    summary: 'List direct + transitive dependencies',
    category: 'Project & Packages',
    readOnly: true,
    operatesOnFile: false,
  },
  {
    id: 'tree',
    name: 'tree',
    usage: 'karkain tree',
    summary: 'Show recursive dependency graph',
    category: 'Project & Packages',
    readOnly: true,
    operatesOnFile: false,
  },
  {
    id: 'pkg-init',
    name: 'pkg init',
    usage: 'karkain pkg init [name]',
    summary: 'Create new project',
    category: 'Project & Packages',
    readOnly: false,
    operatesOnFile: false,
  },
  {
    id: 'pkg-add',
    name: 'pkg add',
    usage: 'karkain pkg add <pkg> [version]',
    summary: 'Add dependency (supports --source git|local)',
    category: 'Project & Packages',
    readOnly: false,
    operatesOnFile: false,
  },
  {
    id: 'pkg-remove',
    name: 'pkg remove',
    usage: 'karkain pkg remove <pkg>',
    summary: 'Remove dependency',
    category: 'Project & Packages',
    readOnly: false,
    operatesOnFile: false,
  },
  {
    id: 'pkg-update',
    name: 'pkg update',
    usage: 'karkain pkg update [pkg]',
    summary: 'Re-resolve versions',
    category: 'Project & Packages',
    readOnly: false,
    operatesOnFile: false,
  },
  {
    id: 'pkg-upgrade',
    name: 'pkg upgrade',
    usage: 'karkain pkg upgrade',
    summary: 'Update all to latest compatible',
    category: 'Project & Packages',
    readOnly: false,
    operatesOnFile: false,
  },
  {
    id: 'pkg-fetch',
    name: 'pkg fetch',
    usage: 'karkain pkg fetch',
    summary: 'Fetch resolved dependencies (lockfile)',
    category: 'Project & Packages',
    readOnly: false,
    operatesOnFile: false,
  },
  {
    id: 'pkg-deps',
    name: 'pkg deps',
    usage: 'karkain pkg deps [--tree|--outdated]',
    summary: 'List dependencies',
    category: 'Project & Packages',
    readOnly: true,
    operatesOnFile: false,
  },
  {
    id: 'pkg-search',
    name: 'pkg search',
    usage: 'karkain pkg search <query>',
    summary: 'Search package registry',
    category: 'Project & Packages',
    readOnly: true,
    operatesOnFile: false,
  },
  {
    id: 'pkg-info',
    name: 'pkg info',
    usage: 'karkain pkg info <pkg>',
    summary: 'Show package details',
    category: 'Project & Packages',
    readOnly: true,
    operatesOnFile: false,
  },
  {
    id: 'pkg-list',
    name: 'pkg list',
    usage: 'karkain pkg list',
    summary: 'List direct + transitive dependencies',
    category: 'Project & Packages',
    readOnly: true,
    operatesOnFile: false,
  },
  {
    id: 'pkg-tree',
    name: 'pkg tree',
    usage: 'karkain pkg tree',
    summary: 'Show recursive dependency graph',
    category: 'Project & Packages',
    readOnly: true,
    operatesOnFile: false,
  },

  // ---- Workspace ----
  {
    id: 'workspace-list',
    name: 'workspace list',
    usage: 'karkain workspace list',
    summary: 'List members in dependency order',
    category: 'Workspace',
    readOnly: true,
    operatesOnFile: false,
  },
  {
    id: 'workspace-build',
    name: 'workspace build',
    usage: 'karkain workspace build',
    summary: 'Build all members (dependency order)',
    category: 'Workspace',
    readOnly: false,
    operatesOnFile: false,
    needsExternalToolchain: 'gcc/clang/MSVC',
  },
  {
    id: 'workspace-test',
    name: 'workspace test',
    usage: 'karkain workspace test',
    summary: 'Test all members',
    category: 'Workspace',
    readOnly: true,
    operatesOnFile: false,
    needsExternalToolchain: 'C linker',
  },
  {
    id: 'workspace-check',
    name: 'workspace check',
    usage: 'karkain workspace check',
    summary: 'Validate all members (no binaries produced)',
    category: 'Workspace',
    readOnly: true,
    operatesOnFile: false,
  },
  {
    id: 'workspace-run',
    name: 'workspace run',
    usage: 'karkain workspace run',
    summary: 'Build and run all member entrypoints',
    category: 'Workspace',
    readOnly: true,
    operatesOnFile: false,
  },
  {
    id: 'workspace-clean',
    name: 'workspace clean',
    usage: 'karkain workspace clean [--all]',
    summary: 'Clean generated artifacts from all members',
    category: 'Workspace',
    readOnly: false,
    operatesOnFile: false,
  },
  {
    id: 'workspace-lint',
    name: 'workspace lint',
    usage: 'karkain workspace lint',
    summary: 'Full front-end analysis of all members',
    category: 'Workspace',
    readOnly: true,
    operatesOnFile: false,
  },
  {
    id: 'workspace-graph',
    name: 'workspace graph',
    usage: 'karkain workspace graph',
    summary: 'Show member dependency graph',
    category: 'Workspace',
    readOnly: true,
    operatesOnFile: false,
  },
  {
    id: 'workspace-init',
    name: 'workspace init',
    usage: 'karkain workspace init',
    summary: 'Initialize workspace root',
    category: 'Workspace',
    readOnly: false,
    operatesOnFile: false,
  },
  {
    id: 'workspace-add',
    name: 'workspace add',
    usage: 'karkain workspace add <path>',
    summary: 'Add member package',
    category: 'Workspace',
    readOnly: false,
    operatesOnFile: false,
  },
  {
    id: 'workspace-remove',
    name: 'workspace remove',
    usage: 'karkain workspace remove <path>',
    summary: 'Remove member package',
    category: 'Workspace',
    readOnly: false,
    operatesOnFile: false,
  },

  // ---- Tooling ----
  {
    id: 'lsp',
    name: 'lsp',
    usage: 'karkain lsp',
    summary: 'Start Language Server Protocol server (stdio)',
    category: 'Tooling',
    readOnly: true,
    operatesOnFile: false,
    notes: 'alias: language-server. Driven by the extension; do not run manually unless debugging.',
  },
  {
    id: 'fmt-check',
    name: 'fmt --check',
    usage: 'karkain fmt --check <file.kark>',
    summary: 'Verify canonical formatting without writing',
    category: 'Tooling',
    readOnly: true,
    operatesOnFile: true,
  },
];

export const CATALOG_CATEGORIES: readonly CatalogCategory[] = [
  'Core',
  'Inspection',
  'Project & Packages',
  'Workspace',
  'Tooling',
];

export function catalogQuery(spec: CommandSpec): string {
  return [spec.id, spec.name, spec.usage, spec.summary, spec.category, spec.notes ?? '']
    .join(' ')
    .toLowerCase();
}

/** Case-insensitive substring search across name, usage, summary, notes. */
export function searchCatalog(query: string, items: readonly CommandSpec[] = COMMAND_CATALOG): CommandSpec[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) {
    return [...items];
  }
  return items.filter((spec) => catalogQuery(spec).includes(q));
}

/** Commands the extension can safely surface as executable actions (never guessed). */
export const EXECUTABLE_CATALOG_IDS: readonly string[] = [
  'run',
  'build',
  'check',
  'lint',
  'test',
  'fmt',
  'fmt-check',
  'clean',
  'explain',
  'config',
  'target',
  'ide-info',
];
