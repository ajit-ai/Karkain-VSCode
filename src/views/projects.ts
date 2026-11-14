// Projects & Files view — every workspace folder, its Karkain project state.
// Manifest parsing is the existing verified TOML-subset parser; nothing here
// guesses a project structure that is not on disk.
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { loadProject, describeProject } from '../project';
import { getCompilerPath, getTarget } from '../config';
import { makeItem, TreeRefresh } from './common';

export class ProjectsProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly _onDidChangeTreeData = new TreeRefresh();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fireTree();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem & { _root?: string }): vscode.TreeItem[] {
    const roots = vscode.workspace.workspaceFolders ?? [];
    if (element === undefined) {
      if (roots.length === 0) {
        return [
          makeItem('No workspace folder open', {
            icon: 'folder',
            tooltip: 'Open a folder with a karkain.toml (or run Karkain: New Project).',
            contextValue: 'empty',
          }),
        ];
      }
      return roots.map((root) =>
        Object.assign(
          makeItem(root.name, {
            description: root.uri.fsPath,
            tooltip: root.uri.fsPath,
            icon: 'folder',
            collapsible: vscode.TreeItemCollapsibleState.Expanded,
            contextValue: 'workspace-root',
          }),
          { _root: root.uri.fsPath },
        ),
      );
    }

    const root = (element as { _root?: string })._root;
    if (!root) {
      return [];
    }
    const items: vscode.TreeItem[] = [];
    const project = loadProject(root);

    if (project === null) {
      items.push(
        makeItem('No readable karkain.toml', {
          description: 'not a project (or unreadable)',
          tooltip:
            'The parser is a deliberate TOML subset (flat `key = value`); sections and unmodelled keys are reported, never guessed.',
          icon: 'warning',
          contextValue: 'no-manifest',
        }),
      );
    } else {
      items.push(
        makeItem('Project', {
          description: describeProject(project.manifest) ?? '(unnamed)',
          tooltip: `Root: ${project.root}`,
          icon: 'package',
          command: 'karkain.openManifest',
          args: [project.root],
          contextValue: 'manifest',
        }),
      );
      const mainEntry = path.join(root, 'src', 'main.kark');
      const mainUri = vscode.Uri.file(mainEntry);
      items.push(
        makeItem('src/main.kark', {
          description: fs.existsSync(mainEntry) ? 'open' : 'missing',
          icon: 'file-code',
          command: fs.existsSync(mainEntry) ? 'vscode.open' : undefined,
          args: [mainUri],
          tooltip: fs.existsSync(mainEntry)
            ? 'Open the project entry point.'
            : 'src/main.kark is missing — create it or run Karkain: New Project.',
          contextValue: 'entry-point',
        }),
      );
      for (const target of project.manifest.targets) {
        items.push(
          makeItem(`target: ${target}`, {
            icon: 'device-desktop',
            tooltip: 'Declared in karkain.toml `targets`.',
            contextValue: 'declared-target',
          }),
        );
      }
      if (project.manifest.extraKeys.length > 0) {
        items.push(
          makeItem('unmodelled keys', {
            description: project.manifest.extraKeys.join(', '),
            tooltip: 'Top-level TOML keys the parser does not model; recorded, not guessed.',
            icon: 'info',
            contextValue: 'unmodelled-keys',
          }),
        );
      }
    }

    const scope = roots.find((r) => r.uri.fsPath === root);
    items.push(
      makeItem('Toolchain', {
        description: getCompilerPath(scope),
        tooltip: 'Compiler path scoped to this folder (karkain.compilerPath).',
        icon: 'tools',
        command: 'karkain.selectToolchain',
        contextValue: 'toolchain',
      }),
      makeItem('Target', {
        description: getTarget(scope) || '(host default)',
        tooltip: 'Target scoped to this folder (karkain.target).',
        icon: 'device-desktop',
        command: 'karkain.selectTarget',
        contextValue: 'target',
      }),
    );
    return items;
  }
}
