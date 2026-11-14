// Recent-action tracking for the Control Center ("last build/run/test status").
//
// Honesty rule: the interactive commands run in an integrated terminal, whose
// exit codes are NOT observable. Recording "launched at …" is what actually
// happened; inventing "build succeeded" would be a fabricated status. Spawn-
// based paths (check) do know the exit code and record ok/fail precisely.
//
// Pure logic only — unit-tested without vscode.

export type ActionKind = 'check' | 'build' | 'run' | 'test' | 'debug' | 'format' | 'clean';

export interface RecentAction {
  kind: ActionKind;
  /** Human-readable target, e.g. `build src/main.kark`. */
  summary: string;
  /** true/false when the outcome is known (spawn), null when only launch was observed. */
  ok: boolean | null;
  at: number;
}

/** Ordered most-recent-first. Capped to keep the surface honest and small. */
export class RecentActions {
  private items: RecentAction[] = [];

  constructor(private readonly capacity = 20) {}

  record(action: Omit<RecentAction, 'at'> & { at?: number }): RecentAction {
    const entry: RecentAction = { ...action, at: action.at ?? Date.now() };
    this.items = [entry, ...this.items].slice(0, this.capacity);
    return entry;
  }

  list(): readonly RecentAction[] {
    return this.items;
  }

  latestOf(kind: ActionKind): RecentAction | undefined {
    return this.items.find((i) => i.kind === kind);
  }

  /** Compact one-line status for the Overview view, e.g. `ok · check · 12:04`. */
  static format(action: RecentAction | undefined): string {
    if (!action) {
      return 'never run';
    }
    const mark = action.ok === null ? 'launched' : action.ok ? 'ok' : 'FAILED';
    const time = new Date(action.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    return `${mark} · ${time}`;
  }
}
