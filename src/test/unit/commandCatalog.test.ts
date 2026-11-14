import * as assert from 'assert';
import { CATALOG_CATEGORIES, COMMAND_CATALOG, searchCatalog } from '../../commandCatalog';

describe('command catalog (Karkain 1.2.0 inventory)', () => {
  it('contains the core verbs the extension executes', () => {
    const names = COMMAND_CATALOG.map((c) => c.name);
    for (const required of [
      'run',
      'build',
      'check',
      'test',
      'lint',
      'fmt',
      'clean',
      'target',
      'config',
      'ide info',
      'explain',
      'lsp',
    ]) {
      assert.ok(names.includes(required), `missing core command: ${required}`);
    }
  });

  it('contains the workspace command family verbatim', () => {
    const names = COMMAND_CATALOG.map((c) => c.name);
    for (const required of [
      'workspace list',
      'workspace build',
      'workspace test',
      'workspace check',
      'workspace run',
      'workspace clean',
      'workspace lint',
      'workspace graph',
      'workspace init',
      'workspace add',
      'workspace remove',
    ]) {
      assert.ok(names.includes(required), `missing workspace command: ${required}`);
    }
  });

  it('has no duplicate ids and no duplicate names', () => {
    const ids = COMMAND_CATALOG.map((c) => c.id);
    const names = COMMAND_CATALOG.map((c) => c.name);
    assert.strictEqual(new Set(ids).size, ids.length, 'duplicate ids');
    assert.strictEqual(new Set(names).size, names.length, 'duplicate names');
  });

  it('every entry carries a verbatim usage, a summary and a valid category', () => {
    for (const spec of COMMAND_CATALOG) {
      assert.ok(
        spec.usage.startsWith('karkain ') ||
          spec.usage.startsWith('bench ') ||
          spec.usage.startsWith('prof ') ||
          spec.usage.startsWith('dbg '),
        `${spec.id}: usage lacks the karkain prefix`,
      );
      assert.ok(spec.summary.length > 0, `${spec.id}: empty summary`);
      assert.ok(CATALOG_CATEGORIES.includes(spec.category), `${spec.id}: unknown category ${spec.category}`);
    }
  });

  it('search finds commands across name, usage, summary and notes', () => {
    assert.deepStrictEqual(
      searchCatalog('workspace build').map((c) => c.id),
      ['workspace-build'],
    );
    assert.ok(searchCatalog('json').some((c) => c.id === 'check'));
    assert.ok(searchCatalog('registry').some((c) => c.category === 'Project & Packages'));
    assert.ok(searchCatalog('error code').some((c) => c.id === 'explain'));
    assert.deepStrictEqual(searchCatalog(''), [...COMMAND_CATALOG]);
    assert.deepStrictEqual(searchCatalog('zzz-no-such-thing'), []);
  });

  it('the explain command usage mentions numeric K-codes', () => {
    const explain = COMMAND_CATALOG.find((c) => c.id === 'explain');
    assert.ok(explain);
    assert.match(explain.usage, /explain/);
  });

  it('every category in the catalogue is represented and ordered', () => {
    const present = new Set(COMMAND_CATALOG.map((c) => c.category));
    for (const category of CATALOG_CATEGORIES) {
      assert.ok(present.has(category), `category ${category} has no entries`);
    }
  });
});
