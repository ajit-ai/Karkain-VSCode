// Compiler Commands view — the discovered v1.2.0 inventory.
// Leaf click behaviour is deliberately honest: where the extension wires an
// action it runs it; everything else copies the verbatim usage to the
// clipboard and says so. Nothing is ever executed silently.
import * as vscode from 'vscode';
import { CATALOG_CATEGORIES, searchCatalog, CommandSpec } from '../commandCatalog';
import { makeItem, TreeRefresh } from './common';

const EXECUTABLE: Readonly<Record<string, { command: string; label: string }>> = {
  run: { command: 'karkain.run', label: 'Run File (karkain run)' },
  build: { command: 'karkain.build', label: 'Build File (karkain build)' },
  check: { command: 'karkain.check', label: 'Check File (karkain check)' },
  lint: { command: 'karkain.lint', label: 'Lint File (karkain lint)' },
  test: { command: 'karkain.test', label: 'Run Tests (karkain test)' },
  fmt: { command: 'karkain.formatDocument', label: 'Format Document (karkain fmt)' },
  'fmt-check': { command: 'karkain.formatCheck', label: 'Verify Formatting (karkain fmt --check)' },
  clean: { command: 'karkain.clean', label: 'Clean Artifacts (karkain clean)' },
  explain: { command: 'karkain.explainError', label: 'Explain Error Code (karkain explain)' },
  config: { command: 'karkain.showConfig', label: 'Show toolchain configuration (karkain config)' },
  target: { command: 'karkain.selectTarget', label: 'Select Target (karkain target)' },
  'ide-info': { command: 'karkain.showIdeInfo', label: 'Show Toolchain Contract (karkain ide info)' },
  'workspace-build': { command: 'karkain.workspaceBuild', label: 'Workspace Build' },
  'workspace-test': { command: 'karkain.workspaceTest', label: 'Workspace Test' },
  'workspace-check': { command: 'karkain.workspaceCheck', label: 'Workspace Check' },
  'workspace-tree': { command: 'karkain.workspaceTree', label: 'Workspace Dependency Graph' },
  init: { command: 'karkain.newProject', label: 'New Project' },
  new: { command: 'karkain.newProject', label: 'New Project' },
};

export class CommandsProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly _onDidChangeTreeData = new TreeRefresh();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private filter = '';

  setFilter(filter: string): void {
    this.filter = filter.trim();
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

  getChildren(element?: vscode.TreeItem & { _spec?: CommandSpec; _category?: string }): vscode.TreeItem[] {
    const items = searchCatalog(this.filter);
    if (element === undefined) {
      const present = new Set(items.map((s) => s.category));
      if (items.length === 0 && this.filter) {
        return [
          makeItem(`No commands match "${this.filter}"`, {
            icon: 'search-stop',
            tooltip: 'Click to clear the filter.',
            command: 'karkain.filterCommands',
            args: [''],
          }),
        ];
      }
      return CATALOG_CATEGORIES.filter((c) => present.has(c)).map((category) =>
        Object.assign(
          makeItem(category, {
            description: `${items.filter((s) => s.category === category).length}`,
            icon: 'list-tree',
            collapsible: vscode.TreeItemCollapsibleState.Expanded,
            contextValue: 'catalog-category',
          }),
          { _category: category },
        ),
      );
    }
    const category = (element as { _category?: string })._category;
    if (category) {
      return items.filter((s) => s.category === category).map((spec) => this.leaf(spec));
    }
    return [];
  }

  private leaf(spec: CommandSpec): vscode.TreeItem {
    const executable = EXECUTABLE[spec.id];
    const item = makeItem(spec.name, {
      description: executable ? 'run' : 'copy usage',
      tooltip: `${spec.usage}\n\n${spec.summary}${spec.notes ? `\n\nNote: ${spec.notes}` : ''}\n\n${spec.readOnly ? 'read-only' : 'modifies files'}${spec.needsExternalToolchain ? ` · needs: ${spec.needsExternalToolchain}` : ''}`,
      icon: executable ? 'play' : 'clippy',
      command: executable ? executable.command : 'karkain.copyCommandUsage',
      args: executable ? [] : [spec.usage],
      contextValue: spec.readOnly ? 'catalog-ro' : 'catalog-write',
    });
    return item;
  }
}
