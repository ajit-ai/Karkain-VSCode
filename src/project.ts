// Pure Karkain project-model helpers: karkain.toml root detection and manifest
// parsing. Verified shape (karkain 1.1.0 `pkg init`): flat keys (name, version,
// description, license, targets), src/main.kark, tests/*_test.kark — NOT the
// `[package]` table sketched in SPEC §10.1 (docs/KARKAIN-INSPECTION.md §3).
//
// The parser below is a deliberately small TOML subset: top-level `key = value`
// assignments only. It implements what the 1.1.0 generator actually emits and
// reports everything else it meets instead of guessing, because a manifest the
// extension misreads is worse than one it declines to read.
import * as fs from 'fs';
import * as path from 'path';

export const MANIFEST_FILE = 'karkain.toml';

/** Top-level keys the verified 1.1.0 manifest carries as strings. */
export type ManifestStringKey = 'name' | 'version' | 'description' | 'license';

export interface KarkainManifest {
  name?: string;
  version?: string;
  description?: string;
  license?: string;
  /** `targets = [...]`; empty when absent or not a string array. */
  targets: string[];
  /**
   * Top-level keys that are not part of the verified surface, plus keys whose
   * value type was not the expected one. Recorded rather than dropped so a
   * caller can tell "absent" from "present but unread".
   */
  extraKeys: string[];
  /**
   * Section headers seen, e.g. `['package']`. The 1.1.0 generator emits none;
   * a non-empty list means the manifest is not the shape this parser claims to
   * support. Assignments inside a section are ignored, never merged.
   */
  sections: string[];
}

export interface KarkainProject {
  root: string;
  manifest: KarkainManifest;
}

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

// Removes a trailing `#` or `//` comment — the comment syntax this toolchain's
// own generated manifests use. Quote-aware: a `//` inside a string value
// (e.g. "https://example") is data, not a comment.
function stripComment(line: string): string {
  let quote = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === quote) {
        quote = '';
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '#') {
      return line.slice(0, i);
    }
    if (ch === '/' && line[i + 1] === '/') {
      return line.slice(0, i);
    }
  }
  return line;
}

// Basic-string escapes. An unrecognised escape is kept verbatim rather than
// throwing the whole value away.
function unescapeBasic(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '\\') {
      out += s[i];
      continue;
    }
    const next = s[++i];
    switch (next) {
      case 'n':
        out += '\n';
        break;
      case 't':
        out += '\t';
        break;
      case 'r':
        out += '\r';
        break;
      case '"':
        out += '"';
        break;
      case '\\':
        out += '\\';
        break;
      default:
        out += `\\${next ?? ''}`;
        break;
    }
  }
  return out;
}

type ParsedValue =
  { kind: 'string'; value: string } | { kind: 'stringArray'; value: string[] } | { kind: 'other' };

// Parses one TOML value. Only strings and arrays of strings are recognised,
// because those are the only types the verified manifest uses. Numbers,
// booleans, dates and inline tables return 'other' so the caller records the
// key as unread instead of coercing it into a string.
function parseValue(raw: string): ParsedValue {
  const t = raw.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    return { kind: 'string', value: unescapeBasic(t.slice(1, -1)) };
  }
  // Literal (single-quoted) strings carry no escapes in TOML.
  if (t.length >= 2 && t.startsWith("'") && t.endsWith("'")) {
    return { kind: 'string', value: t.slice(1, -1) };
  }
  if (t.startsWith('[') && t.endsWith(']')) {
    const items: string[] = [];
    const body = t.slice(1, -1);
    let i = 0;
    while (i < body.length) {
      while (i < body.length && (body[i] === ' ' || body[i] === '\t' || body[i] === ',')) {
        i++;
      }
      if (i >= body.length) {
        break;
      }
      const q = body[i];
      if (q !== '"' && q !== "'") {
        // A non-string element is outside the verified surface, so the whole
        // array is reported unread rather than partially believed.
        return { kind: 'other' };
      }
      i++;
      let value = '';
      while (i < body.length && body[i] !== q) {
        if (body[i] === '\\' && q === '"') {
          i++;
        }
        value += body[i];
        i++;
      }
      i++;
      items.push(q === '"' ? unescapeBasic(value) : value);
    }
    return { kind: 'stringArray', value: items };
  }
  return { kind: 'other' };
}

function assign(manifest: KarkainManifest, key: string, value: ParsedValue): void {
  switch (key) {
    case 'name':
    case 'version':
    case 'description':
    case 'license':
      if (value.kind === 'string') {
        manifest[key] = value.value;
      } else {
        manifest.extraKeys.push(key);
      }
      return;
    case 'targets':
      if (value.kind === 'stringArray') {
        manifest.targets = value.value;
      } else {
        manifest.extraKeys.push(key);
      }
      return;
    default:
      manifest.extraKeys.push(key);
  }
}

/**
 * Parses manifest text into the verified project model.
 *
 * Duplicate top-level keys resolve last-wins. TOML itself rejects duplicates;
 * being lenient here means a hand-edited manifest still yields a usable model
 * instead of no model at all.
 */
export function parseManifest(text: string): KarkainManifest {
  const manifest: KarkainManifest = { targets: [], extraKeys: [], sections: [] };
  const lines = text.split(/\r?\n/);
  let inSection = false;
  // Accumulator for an array TOML allows to span multiple lines.
  let pendingKey: string | null = null;
  let pendingValue = '';

  for (const rawLine of lines) {
    const line = stripComment(rawLine).trim();

    if (pendingKey !== null) {
      pendingValue += ` ${line}`;
      if (pendingValue.includes(']')) {
        assign(manifest, pendingKey, parseValue(pendingValue));
        pendingKey = null;
        pendingValue = '';
      }
      continue;
    }

    if (line === '') {
      continue;
    }
    if (/^\[.*\]$/.test(line)) {
      manifest.sections.push(line.slice(1, -1).trim());
      inSection = true;
      continue;
    }
    const eq = line.indexOf('=');
    if (eq <= 0) {
      // Not an assignment we can attribute. Ignore rather than invent a key.
      continue;
    }
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (!key || inSection) {
      // Inside a `[table]`; the verified manifest is flat. Recorded via
      // sections, never merged into the top-level model.
      continue;
    }
    if (value.startsWith('[') && !value.includes(']')) {
      pendingKey = key;
      pendingValue = value;
      continue;
    }
    assign(manifest, key, parseValue(value));
  }

  // An array left open at EOF is unread, not silently empty.
  if (pendingKey !== null) {
    manifest.extraKeys.push(pendingKey);
  }
  return manifest;
}

/**
 * Reads and parses the manifest for a project root.
 * Returns null when it is missing or unreadable — callers must not treat that
 * as "a project with no metadata".
 */
export function readManifest(root: string): KarkainManifest | null {
  try {
    return parseManifest(fs.readFileSync(manifestPath(root), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Resolves the project containing `start` (file or directory) together with its
 * parsed manifest. Returns null when there is no project root, or the manifest
 * cannot be read.
 */
export function loadProject(start: string): KarkainProject | null {
  const root = findProjectRoot(start);
  if (!root) {
    return null;
  }
  const manifest = readManifest(root);
  if (!manifest) {
    return null;
  }
  return { root, manifest };
}

/** `name@version` when both are known, else whichever exists, else undefined. */
export function describeProject(manifest: KarkainManifest): string | undefined {
  if (manifest.name && manifest.version) {
    return `${manifest.name}@${manifest.version}`;
  }
  return manifest.name ?? manifest.version;
}
