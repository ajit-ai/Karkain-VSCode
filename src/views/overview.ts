// Control Center — Overview view.
// Shows the live, honest state of the toolchain: what is configured, what is
// running, what happened last. Values come from the shared state + VS Code's
// own APIs; nothing is fabricated and expensive probes are never spawned here.
import * as vscode from 'vscode';
import { RecentActions, ActionKind } from '../recentActions';
import { SharedViewState, makeItem, TreeRefresh } from './common';
import { getTarget, getCompilerPath } from '../config';
import { loadProject, describeProject } from '../project';

export class OverviewProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly _onDidChangeTreeData = new TreeRefresh();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private readonly state: SharedViewState,
    private readonly recentActions: RecentActions,
  ) {}

  refresh(): void {
    this._onDidChangeTreeData.fireTree();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.TreeItem[] {
    const items: vscode.TreeItem[] = [];
    const s = this.state;

    items.push(
      makeItem('Compiler', {
        description: s.compilerLabel,
        tooltip: `karkain.compilerPath = ${getCompilerPath()}\n${s.compilerLabel}`,
        icon: s.compilerStatus === 'ok' ? 'verified' : s.compilerStatus === 'fail' ? 'error' : 'warning',
        command: 'karkain.showEnvironment',
        contextValue: 'compiler',
      }),
      makeItem('Language Server', {
        description: s.lspRunning
          ? `running${s.lspRestarts > 0 ? ` (${s.lspRestarts} restart${s.lspRestarts === 1 ? '' : 's'})` : ''}`
          : 'not running',
        tooltip: s.lspRunning
          ? 'Karkain Language Server is running (stdio behind the protocol repair shim).'
          : `Not running.${s.lastLspError ? ` Last error: ${s.lastLspError}` : ''}`,
        icon: s.lspRunning ? 'pulse' : 'debug-disconnect',
        command: 'karkain.restartLanguageServer',
        contextValue: 'lsp',
      }),
    );

    const activeEditor = vscode.window.activeTextEditor?.document;
    const scope = activeEditor ? vscode.workspace.getWorkspaceFolder(activeEditor.uri) : undefined;

    const roots = vscode.workspace.workspaceFolders ?? [];
    items.push(
      makeItem('Workspace', {
        description:
          roots.length === 0 ? 'none' : roots.length === 1 ? roots[0].name : `${roots.length} roots`,
        tooltip: roots.map((r) => r.uri.fsPath).join('\n') || 'No workspace folder open.',
        icon: 'folder',
        contextValue: 'roots',
      }),
    );

    if (activeEditor) {
      const project = loadProject(activeEditor.uri.fsPath);
      items.push(
        makeItem('Project', {
          description: project ? (describeProject(project.manifest) ?? project.root) : 'no karkain.toml',
          tooltip: project ? `Root: ${project.root}` : 'The active file is not inside a Karkain project.',
          icon: 'package',
          command: project ? 'karkain.openManifest' : undefined,
          args: project ? [project.root] : [],
          contextValue: 'project',
        }),
      );
      items.push(
        makeItem('Target', {
          description: getTarget(scope) || '(host default)',
          tooltip: scope ? `Target for ${scope.name}` : 'Target for the workspace',
          icon: 'device-desktop',
          command: 'karkain.selectTarget',
          contextValue: 'target',
        }),
      );
    } else {
      items.push(
        makeItem('Target', {
          description: getTarget(undefined) || '(host default)',
          tooltip: 'Target for the workspace (no active file)',
          icon: 'device-desktop',
          command: 'karkain.selectTarget',
          contextValue: 'target',
        }),
      );
    }

    const latest = (kind: ActionKind) => RecentActions.format(this.recentActions.latestOf(kind));
    items.push(
      makeItem('Last check', {
        description: latest('check'),
        icon: 'checklist',
        contextValue: 'last-check',
        command: 'karkain.check',
      }),
      makeItem('Last build', {
        description: latest('build'),
        icon: 'tools',
        contextValue: 'last-build',
        command: 'karkain.build',
      }),
      makeItem('Last run', {
        description: latest('run'),
        icon: 'play',
        contextValue: 'last-run',
        command: 'karkain.run',
      }),
      makeItem('Last test', {
        description: latest('test'),
        icon: 'beaker',
        contextValue: 'last-test',
        command: 'karkain.test',
      }),
    );

    items.push(
      makeItem('Health', {
        description: s.healthOverall ?? 'not checked',
        tooltip:
          'Runs a diagnostic sweep of compiler, server, toolchain and workspace — and shows actionable remediation.',
        icon: s.healthOverall === 'fail' ? 'error' : s.healthOverall === 'warn' ? 'warning' : 'heart',
        command: 'karkain.runHealthCheck',
        contextValue: 'health',
      }),
    );

    return items;
  }
}
