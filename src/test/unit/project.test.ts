import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MANIFEST_FILE, findProjectRoot, isProjectRoot, manifestPath } from '../../project';

function makeTree(): { root: string; sub: string; file: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'karkain-proj-'));
  const sub = path.join(root, 'src');
  fs.mkdirSync(sub, { recursive: true });
  const file = path.join(sub, 'main.kark');
  fs.writeFileSync(path.join(root, MANIFEST_FILE), 'name = "sample"\n');
  fs.writeFileSync(file, 'func main() { print("hi") }\n');
  return { root, sub, file };
}

describe('project', () => {
  describe('findProjectRoot', () => {
    it('finds the root from a nested file and directory', () => {
      const { root, sub, file } = makeTree();
      assert.strictEqual(findProjectRoot(file), root);
      assert.strictEqual(findProjectRoot(sub), root);
      assert.strictEqual(findProjectRoot(root), root);
      fs.rmSync(root, { recursive: true, force: true });
    });

    it('returns null outside a project or on missing paths', () => {
      const lonely = fs.mkdtempSync(path.join(os.tmpdir(), 'karkain-lonely-'));
      assert.strictEqual(findProjectRoot(lonely), null);
      assert.strictEqual(findProjectRoot(path.join(lonely, 'nope.kark')), null);
      fs.rmSync(lonely, { recursive: true, force: true });
    });

    it('ignores a karkain.toml directory masquerading as a manifest', () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'karkain-fake-'));
      fs.mkdirSync(path.join(root, MANIFEST_FILE));
      assert.strictEqual(isProjectRoot(root), false);
      assert.strictEqual(findProjectRoot(root), null);
      fs.rmSync(root, { recursive: true, force: true });
    });
  });

  describe('manifestPath', () => {
    it('points at karkain.toml under the root', () => {
      assert.strictEqual(manifestPath('/proj'), path.join('/proj', MANIFEST_FILE));
    });
  });
});
