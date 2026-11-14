// Documentation view — bundled, verified reference topics opened read-only in
// the editor. Everything here ships inside the VSIX under docs/user/; no
// network or repository checkout is required.
import * as path from 'path';
import * as vscode from 'vscode';
import { makeItem, TreeRefresh } from './common';

// Bundled documentation topics; the view and the Open Documentation command
// both consume this list.
export const DOC_TOPICS: { slug: string; file: string; label: string; description: string; icon: string }[] =
  [
    {
      slug: 'getting-started',
      file: 'getting-started.md',
      label: 'Getting Started',
      description: 'install → check → run → project',
      icon: 'rocket',
    },
    {
      slug: 'language-syntax',
      file: 'language-syntax.md',
      label: 'Language Syntax',
      description: 'verified subset (incl. rejected shapes)',
      icon: 'code',
    },
    {
      slug: 'command-reference',
      file: 'command-reference.md',
      label: 'Command Reference',
      description: 'every v1.2.0 command with exit codes',
      icon: 'terminal',
    },
    {
      slug: 'build-and-targets',
      file: 'build-and-targets.md',
      label: 'Build & Targets',
      description: 'engines, targets, flags',
      icon: 'tools',
    },
    {
      slug: 'run-and-debug',
      file: 'run-and-debug.md',
      label: 'Run & Debug',
      description: 'terminal run; GDB-based debugging',
      icon: 'debug-alt',
    },
    {
      slug: 'testing',
      file: 'testing.md',
      label: 'Testing',
      description: 'discovery, runner, linker requirement',
      icon: 'beaker',
    },
    {
      slug: 'configuration',
      file: 'configuration.md',
      label: 'Configuration',
      description: 'every karkain.* setting, scopes',
      icon: 'settings-gear',
    },
    {
      slug: 'toolchain-setup',
      file: 'toolchain-setup.md',
      label: 'Toolchain Setup',
      description: 'kcc/gcc/source trees; Go engine',
      icon: 'wrench',
    },
    {
      slug: 'troubleshooting',
      file: 'troubleshooting.md',
      label: 'Troubleshooting',
      description: 'LSP defect, diagnostics, multi-root',
      icon: 'question',
    },
    {
      slug: 'release-notes',
      file: 'release-notes.md',
      label: 'Release Notes',
      description: 'what is in v1.0.0 (candidate)',
      icon: 'tag',
    },
  ];

export class DocsProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly _onDidChangeTreeData = new TreeRefresh();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fireTree();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  constructor(private readonly docsRoot: string) {}

  getChildren(): vscode.TreeItem[] {
    return DOC_TOPICS.map((topic) =>
      makeItem(topic.label, {
        description: topic.description,
        tooltip: `Open bundled document: ${topic.file}`,
        icon: topic.icon,
        command: 'karkain.openDocumentationTopic',
        args: [path.join(this.docsRoot, topic.file)],
        contextValue: 'doc-topic',
      }),
    );
  }
}
