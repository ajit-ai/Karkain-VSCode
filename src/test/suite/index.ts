// Extension-host suite entry point.
//
// Loaded by VS Code inside the extension host, not by `npm run test:unit`.
// The unit suite (mocha over out/test/unit) stays host-free and fast; this
// suite covers the part that only a real extension host can exercise:
// activation, command registration and provider registration.
import * as fs from 'fs';
import * as path from 'path';
import Mocha from 'mocha';

function collectTests(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectTests(full, out);
    } else if (entry.name.endsWith('.test.js')) {
      out.push(full);
    }
  }
  return out;
}

export async function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'tdd', color: true, timeout: 60000 });
  const suiteRoot = __dirname;

  collectTests(suiteRoot)
    .sort()
    .forEach((f) => mocha.addFile(f));

  await new Promise<void>((resolve, reject) => {
    try {
      mocha.run((failures) => {
        if (failures > 0) {
          reject(new Error(`${failures} extension-host test(s) failed.`));
        } else {
          resolve();
        }
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
