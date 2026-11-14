// Argv-style flag splitting, shared by run/build and unit-tested without vscode.
// Quoted segments are honoured (`--target "x86_64-windows"` → one arg). Shell
// semantics are deliberately not supported: everything is argv, never a shell.

export function splitFlags(raw: string): string[] {
  const out: string[] = [];
  const re = /(?:[^\s"]|"[^"]*")+/g;
  for (const m of raw.matchAll(re)) {
    out.push(m[0].replace(/^"|"$/g, ''));
  }
  return out;
}
