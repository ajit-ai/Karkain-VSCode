// Shared tree-view plumbing for the Karkain Control Center.
// Every view is a plain TreeDataProvider; no webviews anywhere.
import * as vscode from 'vscode';

/** One shared change emitter so all views refresh together on refresh(). */
export class TreeRefresh extends vscode.EventEmitter<void | vscode.TreeItem | undefined | null | void> {
  fireTree(): void {
    this.fire(undefined);
  }
}

export function makeItem(
  label: string,
  options: {
    description?: string;
    tooltip?: string;
    icon?: string;
    command?: string;
    args?: unknown[];
    contextValue?: string;
    collapsible?: vscode.TreeItemCollapsibleState;
  } = {},
): vscode.TreeItem {
  const item = new vscode.TreeItem(label, options.collapsible ?? vscode.TreeItemCollapsibleState.None);
  if (options.description !== undefined) {
    item.description = options.description;
  }
  if (options.tooltip !== undefined) {
    item.tooltip = options.tooltip;
  }
  if (options.icon) {
    item.iconPath = new vscode.ThemeIcon(options.icon);
  }
  if (options.command) {
    item.command = { command: options.command, title: label, arguments: options.args ?? [] };
  }
  if (options.contextValue) {
    item.contextValue = options.contextValue;
  }
  return item;
}

export function settingMissingItem(label: string, setting: string, detail: string): vscode.TreeItem {
  return makeItem(label, {
    description: 'not configured',
    tooltip: detail,
    icon: 'warning',
    command: 'workbench.action.openSettings',
    args: [setting],
    contextValue: 'missing-setting',
  });
}

/** First contiguous `//` comment block of a file, ≤ maxLines, joined — a
 * description for UI tooltips straight from the source's own documentation. */
export function leadingCommentSummary(text: string, maxLines = 3): string | undefined {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('//')) {
      const body = line.replace(/^\/\/+\s?/, '').trim();
      if (body.length > 0) {
        out.push(body);
      }
      continue;
    }
    if (line === '') {
      continue;
    }
    break;
  }
  if (out.length === 0) {
    return undefined;
  }
  return out.slice(0, maxLines).join(' ');
}

/** Live state shared with the views; updated by the extension. */
export interface SharedViewState {
  compilerLabel: string;
  compilerStatus: 'ok' | 'warn' | 'fail' | 'unknown';
  lspRunning: boolean;
  lspRestarts: number;
  lastLspError?: string;
  /** Overall health from the last explicit health run, if any. */
  healthOverall?: 'ok' | 'warn' | 'fail';
}
