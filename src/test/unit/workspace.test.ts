import * as assert from 'assert';
import { findOwningRoot, findOwningRootPath, isPathInsideRoot } from '../../workspace';

// Fixed POSIX-style paths keep these deterministic on every platform: the
// `platform` argument is passed explicitly wherever case matters, so no test
// depends on the machine it runs on.
const A = { fsPath: '/ws/alpha' };
const B = { fsPath: '/ws/beta' };

describe('workspace', () => {
  describe('isPathInsideRoot', () => {
    it('accepts the root itself and true descendants', () => {
      assert.strictEqual(isPathInsideRoot('/ws/alpha', '/ws/alpha', 'linux'), true);
      assert.strictEqual(isPathInsideRoot('/ws/alpha/src/main.kark', '/ws/alpha', 'linux'), true);
      assert.strictEqual(isPathInsideRoot('/ws/alpha/deep/nested/file.kark', '/ws/alpha', 'linux'), true);
    });

    it('rejects siblings, parents and unrelated paths', () => {
      assert.strictEqual(isPathInsideRoot('/ws/beta/main.kark', '/ws/alpha', 'linux'), false);
      assert.strictEqual(isPathInsideRoot('/ws', '/ws/alpha', 'linux'), false);
      assert.strictEqual(isPathInsideRoot('/elsewhere/x.kark', '/ws/alpha', 'linux'), false);
    });

    // The classic prefix bug: '/ws/alpha' must not claim '/ws/alpha-two'.
    it('matches on segment boundaries, not raw string prefixes', () => {
      assert.strictEqual(isPathInsideRoot('/ws/alpha-two/main.kark', '/ws/alpha', 'linux'), false);
      assert.strictEqual(isPathInsideRoot('/ws/application.kark', '/ws/app', 'linux'), false);
      assert.strictEqual(isPathInsideRoot('/ws/app/main.kark', '/ws/app', 'linux'), true);
    });

    it('tolerates a trailing separator on the root', () => {
      assert.strictEqual(isPathInsideRoot('/ws/alpha/main.kark', '/ws/alpha/', 'linux'), true);
      assert.strictEqual(isPathInsideRoot('/ws/alpha', '/ws/alpha/', 'linux'), true);
    });

    it('folds case only where the filesystem does', () => {
      // Windows and macOS filesystems are case-insensitive.
      assert.strictEqual(isPathInsideRoot('C:\\WS\\Alpha\\main.kark', 'c:\\ws\\alpha', 'win32'), true);
      assert.strictEqual(isPathInsideRoot('/WS/Alpha/main.kark', '/ws/alpha', 'darwin'), true);
      // Linux paths are case-sensitive: these are genuinely different trees.
      assert.strictEqual(isPathInsideRoot('/WS/Alpha/main.kark', '/ws/alpha', 'linux'), false);
    });

    it('normalizes backslash separators so Windows paths compare correctly', () => {
      assert.strictEqual(isPathInsideRoot('C:\\ws\\alpha\\src\\main.kark', 'C:/ws/alpha', 'win32'), true);
    });

    it('never lets an empty root claim a path', () => {
      assert.strictEqual(isPathInsideRoot('/ws/alpha', '', 'linux'), false);
      assert.strictEqual(isPathInsideRoot('/ws/alpha', '   ', 'linux'), false);
    });

    it('treats the filesystem root as containing every absolute path', () => {
      assert.strictEqual(isPathInsideRoot('/ws/alpha', '/', 'linux'), true);
    });
  });

  describe('findOwningRoot', () => {
    it('resolves a file to the root that contains it', () => {
      assert.strictEqual(findOwningRoot('/ws/alpha/src/main.kark', [A, B], 'linux'), A);
      assert.strictEqual(findOwningRoot('/ws/beta/src/main.kark', [A, B], 'linux'), B);
    });

    it('prefers the innermost root when roots are nested', () => {
      const outer = { fsPath: '/ws' };
      const inner = { fsPath: '/ws/alpha' };
      assert.strictEqual(findOwningRoot('/ws/alpha/main.kark', [outer, inner], 'linux'), inner);
      // Order must not matter: the longer root still wins.
      assert.strictEqual(findOwningRoot('/ws/alpha/main.kark', [inner, outer], 'linux'), inner);
    });

    it('returns null for a file outside every root (no fabricated association)', () => {
      assert.strictEqual(findOwningRoot('/elsewhere/main.kark', [A, B], 'linux'), null);
      assert.strictEqual(findOwningRoot('/elsewhere/main.kark', [], 'linux'), null);
      assert.strictEqual(findOwningRoot('/elsewhere/main.kark', [A, B], 'linux'), null);
    });

    it('does not confuse a sibling whose name shares the root prefix', () => {
      const app = { fsPath: '/ws/app' };
      const application = { fsPath: '/ws/application' };
      assert.strictEqual(
        findOwningRoot('/ws/application/main.kark', [app, application], 'linux'),
        application,
      );
    });

    it('keeps distinct-case roots distinct on Linux', () => {
      const lower = { fsPath: '/ws/alpha' };
      const upper = { fsPath: '/WS/Alpha' };
      assert.strictEqual(findOwningRoot('/WS/Alpha/main.kark', [lower, upper], 'linux'), upper);
      assert.strictEqual(findOwningRoot('/ws/alpha/main.kark', [lower, upper], 'linux'), lower);
    });
  });

  describe('findOwningRootPath', () => {
    it('returns the owning path, or undefined outside every root', () => {
      assert.strictEqual(findOwningRootPath('/ws/beta/x.kark', [A, B], 'linux'), '/ws/beta');
      assert.strictEqual(findOwningRootPath('/elsewhere/x.kark', [A, B], 'linux'), undefined);
      assert.strictEqual(findOwningRootPath('/elsewhere/x.kark', [], 'linux'), undefined);
    });

    it('is stable for a single root (single-root compatibility)', () => {
      assert.strictEqual(findOwningRootPath('/ws/alpha/x.kark', [A], 'linux'), '/ws/alpha');
      assert.strictEqual(findOwningRootPath('/ws/alpha', [A], 'linux'), '/ws/alpha');
    });
  });
});
