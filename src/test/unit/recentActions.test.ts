import * as assert from 'assert';
import { RecentActions } from '../../recentActions';

describe('RecentActions', () => {
  it('records and lists most-recent first', () => {
    const r = new RecentActions();
    r.record({ kind: 'build', summary: 'build a.kark', ok: null, at: 1000 });
    r.record({ kind: 'run', summary: 'run a.kark', ok: null, at: 2000 });
    const list = r.list();
    assert.strictEqual(list[0].summary, 'run a.kark');
    assert.strictEqual(list[1].summary, 'build a.kark');
  });

  it('caps the history at the capacity (oldest dropped)', () => {
    const r = new RecentActions(3);
    for (let i = 0; i < 5; i++) {
      r.record({ kind: 'check', summary: `check ${i}`, ok: true, at: i });
    }
    assert.deepStrictEqual(
      r.list().map((a) => a.summary),
      ['check 4', 'check 3', 'check 2'],
    );
  });

  it('latestOf returns the newest entry of a kind only', () => {
    const r = new RecentActions();
    r.record({ kind: 'run', summary: 'run 1', ok: null, at: 1000 });
    r.record({ kind: 'build', summary: 'build 1', ok: null, at: 1500 });
    r.record({ kind: 'run', summary: 'run 2', ok: true, at: 2000 });
    assert.strictEqual(r.latestOf('run')?.summary, 'run 2');
    assert.strictEqual(r.latestOf('test'), undefined);
  });

  it('format renders ok/FAILED/launched with a time', () => {
    assert.strictEqual(RecentActions.format(undefined), 'never run');
    assert.match(RecentActions.format({ kind: 'run', summary: 'x', ok: null, at: 1000000 }), /^launched · /);
    assert.match(RecentActions.format({ kind: 'check', summary: 'x', ok: true, at: 1000000 }), /^ok · /);
    assert.match(RecentActions.format({ kind: 'check', summary: 'x', ok: false, at: 1000000 }), /^FAILED · /);
  });

  it('omits ok from the summary when only launch was observed (never fabricates success)', () => {
    const r = new RecentActions();
    const entry = r.record({ kind: 'run', summary: 'run file', ok: null });
    assert.strictEqual(entry.ok, null);
    assert.strictEqual(RecentActions.format(entry).startsWith('launched'), true);
  });
});
