// Quick Actions view — the common verbs in one place.
// Every action maps to a registered command; nothing is simulated.
import * as vscode from 'vscode';
import { makeItem, TreeRefresh } from './common';

interface QuickAction {
  label: string;
  description: string;
  icon: string;
  command: string;
  args?: unknown[];
}

const ACTIONS: QuickAction[] = [
  {
    label: 'New Karkain Project…',
    description: 'karkain init / new',
    icon: 'new-folder',
    command: 'karkain.newProject',
  },
  {
    label: 'Open Project Folder…',
    description: 'add a folder to the workspace',
    icon: 'folder-opened',
    command: 'karkain.openProject',
  },
  {
    label: 'Check Current File',
    description: 'karkain check (diagnostics)',
    icon: 'checklist',
    command: 'karkain.check',
  },
  {
    label: 'Lint Current File',
    description: 'karkain lint (full analysis)',
    icon: 'shield',
    command: 'karkain.lint',
  },
  {
    label: 'Build File',
    description: 'karkain build (native executable)',
    icon: 'tools',
    command: 'karkain.build',
  },
  { label: 'Run File', description: 'karkain run (with terminal)', icon: 'play', command: 'karkain.run' },
  { label: 'Debug File', description: 'gdb via cppdbg', icon: 'debug-alt', command: 'karkain.debug' },
  {
    label: 'Run Tests',
    description: 'karkain test (test controller)',
    icon: 'beaker',
    command: 'karkain.test',
  },
  {
    label: 'Format Document',
    description: 'karkain fmt (via formatter)',
    icon: 'code',
    command: 'karkain.formatDocument',
  },
  {
    label: 'Clean Artifacts',
    description: 'karkain clean (generated only)',
    icon: 'trash',
    command: 'karkain.clean',
  },
  {
    label: 'Show Environment',
    description: 'version, target, project, paths',
    icon: 'output',
    command: 'karkain.showEnvironment',
  },
  {
    label: 'Show Toolchain Contract',
    description: 'karkain ide info (JSON)',
    icon: 'json',
    command: 'karkain.showIdeInfo',
  },
  {
    label: 'Run Health Check',
    description: 'diagnose common misconfigurations',
    icon: 'heart',
    command: 'karkain.runHealthCheck',
  },
  {
    label: 'Open Documentation',
    description: 'bundled guides and references',
    icon: 'book',
    command: 'karkain.openDocumentation',
  },
];

export class QuickActionsProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly _onDidChangeTreeData = new TreeRefresh();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fireTree();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.TreeItem[] {
    return ACTIONS.map((a) =>
      makeItem(a.label, {
        description: a.description,
        tooltip: `${a.label} — ${a.description}`,
        icon: a.icon,
        command: a.command,
        args: a.args,
        contextValue: 'quick-action',
      }),
    );
  }
}
