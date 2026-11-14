// Pure workspace-root resolution for multi-root windows.
//
// VS Code already answers "which workspace folder owns this file" via
// `workspace.getWorkspaceFolder`, but several call sites in extension.ts need
// the same decision from plain path strings (diagnostic path anchoring, the
// Show Environment report, task cwd fallback). Re-deriving it there is how
// multi-root bugs get in, so the rule lives here once and is unit-tested
// without Electron.
//
// The rule is deliberately the same one VS Code uses: the **longest** workspace
// root that contains the file wins, so a nested root beats its parent. Matching
// is segment-boundary aware, so `/proj/app` never claims `/proj/application`.
//
// Vscode-free on purpose, matching the rest of src/.

/** One workspace root, as a filesystem path. */
export interface WorkspaceRootLike {
  /** Absolute path of the folder, e.g. `C:\\proj` or `/home/u/proj`. */
  fsPath: string;
}

function normalizeSeparators(p: string): string {
  return p.replace(/\\/g, '/');
}

function isCaseInsensitive(platform: NodeJS.Platform): boolean {
  // Matches the filesystem, and matches the `dedupeKey` rule in toolchain.ts.
  return platform === 'win32' || platform === 'darwin';
}

/**
 * Case-folds a path for comparison on case-insensitive filesystems.
 * Returns the input unchanged where case matters (Linux), so distinct-case
 * roots never collapse into one another there.
 */
function foldCase(p: string, platform: NodeJS.Platform): string {
  return isCaseInsensitive(platform) ? p.toLowerCase() : p;
}

/**
 * True when `file` is `root` itself or lives underneath it.
 *
 * Compares on segment boundaries so that a sibling whose name merely starts
 * with the root's name (`/proj/apple` vs `/proj/app`) is not treated as
 * contained. Trailing separators on the root are tolerated.
 */
export function isPathInsideRoot(
  file: string,
  root: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const f = foldCase(normalizeSeparators(file), platform);
  const r = foldCase(normalizeSeparators(root), platform);
  if (r === '') {
    // An empty root would otherwise claim every path.
    return false;
  }
  // Check the filesystem root BEFORE stripping: stripping turns '/' into ''.
  if (r === '/') {
    return f.startsWith('/');
  }
  const trimmed = r.replace(/\/+$/, '');
  if (trimmed === '') {
    return false;
  }
  if (f === trimmed) {
    return true;
  }
  return f.length > trimmed.length && f.startsWith(trimmed) && f[trimmed.length] === '/';
}

/**
 * The workspace root that owns `file`, or null when it belongs to none.
 *
 * Longest matching root wins, so nested roots resolve to the innermost one. An
 * empty or absent root list yields null: the caller must not invent a root for
 * a document that lives outside the workspace.
 */
export function findOwningRoot(
  file: string,
  roots: readonly WorkspaceRootLike[],
  platform: NodeJS.Platform = process.platform,
): WorkspaceRootLike | null {
  let best: WorkspaceRootLike | null = null;
  for (const root of roots) {
    if (!isPathInsideRoot(file, root.fsPath, platform)) {
      continue;
    }
    // Strictly longer only, so equal-length roots keep first-seen order and a
    // parent can never displace an already-matched child.
    if (!best || root.fsPath.length > best.fsPath.length) {
      best = root;
    }
  }
  return best;
}

/**
 * The owning root's path, or undefined when the file is outside every root.
 * This is the shape call sites actually need for a cwd.
 */
export function findOwningRootPath(
  file: string,
  roots: readonly WorkspaceRootLike[],
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  return findOwningRoot(file, roots, platform)?.fsPath;
}
