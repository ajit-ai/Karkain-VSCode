// Examples view — a navigable catalogue of a LOCAL Karkain examples/
// checkout, linked via the `karkain.examplesPath` setting. Nothing is
// invented: only files that exist on disk are listed, with descriptions
// taken from each file's own leading comment block.
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { getExamplesPath } from '../config';
import { leadingCommentSummary, makeItem, settingMissingItem, TreeRefresh } from './common';

const MAX_DEPTH = 3;

export class ExamplesProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly _onDidChangeTreeData = new TreeRefresh();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private filter = '';

  setFilter(filter: string): void {
    this.filter = filter.trim().toLowerCase();
    this.refresh();
  }

  get currentFilter(): string {
    return this.filter;
  }

  refresh(): void {
    this._onDidChangeTreeData.fireTree();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  /** All .kark files under dir (bounded depth), with their summaries. */
  private scan(dir: string, depth: number): { file: string; rel: string; summary?: string }[] {
    const out: { file: string; rel: string; summary?: string }[] = [];
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth > 0) {
          out.push(...this.scan(full, depth - 1));
        }
        continue;
      }
      if (!entry.name.endsWith('.kark')) {
        continue;
      }
      let summary: string | undefined;
      try {
        summary = leadingCommentSummary(fs.readFileSync(full, 'utf8'));
      } catch {
        summary = undefined;
      }
      out.push({ file: full, rel: path.relative(dir, full), summary });
    }
    return out;
  }

  getChildren(
    element?: vscode.TreeItem & { _category?: string; _file?: string; _examplesRoot?: string },
  ): vscode.TreeItem[] {
    const examplesRoot = getExamplesPath();
    if (!examplesRoot) {
      return [
        settingMissingItem(
          'Examples not linked',
          'karkain.examplesPath',
          'Point karkain.examplesPath at the examples/ directory of a local Karkain source checkout (e.g. F:\\Codes\\Git\\Karkain\\examples) to browse and open the examples.',
        ),
      ];
    }
    if (!fs.existsSync(examplesRoot) || !fs.statSync(examplesRoot).isDirectory()) {
      return [
        makeItem('examples path not found', {
          description: examplesRoot,
          tooltip: 'The configured karkain.examplesPath does not exist or is not a directory.',
          icon: 'error',
          command: 'workbench.action.openSettings',
          args: ['karkain.examplesPath'],
          contextValue: 'bad-examples-path',
        }),
      ];
    }

    if (element === undefined) {
      const all = this.scan(examplesRoot, MAX_DEPTH).filter((e) =>
        this.filter === '' ? true : `${e.file} ${e.summary ?? ''}`.toLowerCase().includes(this.filter),
      );
      if (all.length === 0) {
        return [
          makeItem(this.filter ? `No examples match "${this.filter}"` : 'No .kark examples found', {
            icon: 'search-stop',
            tooltip: this.filter ? 'Click to clear the filter.' : undefined,
            command: this.filter ? 'karkain.filterExamples' : undefined,
            args: this.filter ? [''] : undefined,
            contextValue: 'empty',
          }),
        ];
      }
      const byCategory = new Map<string, typeof all>();
      for (const entry of all) {
        const category = entry.rel.includes(path.sep) ? entry.rel.split(path.sep)[0] : '(root)';
        const list = byCategory.get(category) ?? [];
        list.push(entry);
        byCategory.set(category, list);
      }
      return [...byCategory.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([category, list]) =>
          Object.assign(
            makeItem(category, {
              description: `${list.length} example${list.length === 1 ? '' : 's'}`,
              icon: 'library',
              collapsible: vscode.TreeItemCollapsibleState.Expanded,
              contextValue: 'example-category',
            }),
            { _category: category },
          ),
        );
    }

    const category = (element as { _category?: string })._category;
    if (category) {
      const all = this.scan(examplesRoot, MAX_DEPTH).filter(
        (e) =>
          (category === '(root)' ? !e.rel.includes(path.sep) : e.rel.split(path.sep)[0] === category) &&
          (this.filter === '' || `${e.file} ${e.summary ?? ''}`.toLowerCase().includes(this.filter)),
      );
      return all.map((entry) =>
        makeItem(path.basename(entry.file), {
          description: entry.summary ?? '',
          tooltip: entry.summary ?? entry.file,
          icon: 'file-code',
          command: 'vscode.open',
          args: [vscode.Uri.file(entry.file)],
          contextValue: 'example-file',
        }),
      );
    }
    return [];
  }
}
