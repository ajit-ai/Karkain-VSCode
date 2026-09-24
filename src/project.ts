// Pure Karkain project-model helpers: karkain.toml root detection.
// Verified shape (karkain 1.1.0 `pkg init`): flat keys (name, version,
// description, license, targets), src/main.kark, tests/*_test.kark.
import * as fs from 'fs';
import * as path from 'path';

export const MANIFEST_FILE = 'karkain.toml';

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

// True when dir directly contains a karkain.toml project manifest file.
export function isProjectRoot(dir: string): boolean {
  return isFile(path.join(dir, MANIFEST_FILE));
}

// Walks up from startDir (file or directory) to the nearest karkain.toml.
// Returns null outside a project or on any filesystem error.
export function findProjectRoot(start: string): string | null {
  let dir: string;
  try {
    const st = fs.statSync(start);
    dir = st.isDirectory() ? start : path.dirname(start);
  } catch {
    return null;
  }
  for (;;) {
    if (isProjectRoot(dir)) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

export function manifestPath(root: string): string {
  return path.join(root, MANIFEST_FILE);
}
