// Standard Library view — navigates a LOCAL Karkain source tree's stdlib/
// directory, exposed via the `karkain.stdlibPath` setting. The extension
// cannot bundle the standard library, so without the setting this view says
// exactly that instead of inventing modules.
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { getStdlibPath } from '../config';
import { leadingCommentSummary, makeItem, settingMissingItem, TreeRefresh } from './common';

export class StdlibProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly _onDidChangeTreeData = new TreeRefresh();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fireTree();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem & { _module?: string }): vscode.TreeItem[] {
    const stdlib = getStdlibPath();
    if (!stdlib) {
      return [
        settingMissingItem(
          'Standard library not linked',
          'karkain.stdlibPath',
          'Point karkain.stdlibPath at the stdlib/ directory of a local Karkain source checkout (e.g. F:\\Codes\\Git\\Karkain\\stdlib) to browse modules.',
        ),
      ];
    }
    if (!fs.existsSync(stdlib) || !fs.statSync(stdlib).isDirectory()) {
      return [
        makeItem('stdlib path not found', {
          description: stdlib,
          tooltip: 'The configured karkain.stdlibPath does not exist or is not a directory.',
          icon: 'error',
          command: 'workbench.action.openSettings',
          args: ['karkain.stdlibPath'],
          contextValue: 'bad-stdlib-path',
        }),
      ];
    }

    if (element === undefined) {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(stdlib, { withFileTypes: true });
      } catch (e) {
        return [
          makeItem('Cannot read stdlib directory', {
            description: (e as Error).message,
            icon: 'error',
            contextValue: 'io-error',
          }),
        ];
      }
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => {
          const dir = path.join(stdlib, entry.name);
          const mainFile = path.join(dir, `${entry.name}.kark`);
          let summary: string | undefined;
          try {
            if (fs.existsSync(mainFile)) {
              summary = leadingCommentSummary(fs.readFileSync(mainFile, 'utf8'));
            }
          } catch {
            summary = undefined;
          }
          return Object.assign(
            makeItem(`stdlib.${entry.name}`, {
              description: summary ?? '',
              tooltip: summary ?? `Standard library module "${entry.name}"`,
              icon: 'library',
              collapsible: vscode.TreeItemCollapsibleState.Expanded,
              contextValue: 'stdlib-module',
            }),
            { _module: dir },
          );
        });
    }

    const moduleDir = (element as { _module?: string })._module;
    if (!moduleDir) {
      return [];
    }
    try {
      return fs
        .readdirSync(moduleDir)
        .filter((name) => name.endsWith('.kark'))
        .map((name) => {
          const file = path.join(moduleDir, name);
          let summary: string | undefined;
          try {
            summary = leadingCommentSummary(fs.readFileSync(file, 'utf8'));
          } catch {
            summary = undefined;
          }
          return makeItem(name, {
            description: summary ?? '',
            tooltip: summary ?? file,
            icon: 'file-code',
            command: 'vscode.open',
            args: [vscode.Uri.file(file)],
            contextValue: 'stdlib-file',
          });
        });
    } catch (e) {
      return [
        makeItem('Cannot read module directory', {
          description: (e as Error).message,
          icon: 'error',
          contextValue: 'io-error',
        }),
      ];
    }
  }
}
