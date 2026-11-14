// Karkain Control Center — activity-bar views registration and shared state.
// Every view is a native TreeDataProvider (no webviews). Views read a shared
// state object which the extension updates on activation, on configuration
// changes, on probes and on actions.
import * as vscode from 'vscode';
import { RecentActions } from './recentActions';
import { SharedViewState } from './views/common';
import { OverviewProvider } from './views/overview';
import { QuickActionsProvider } from './views/quickActions';
import { ProjectsProvider } from './views/projects';
import { CommandsProvider } from './views/commands';
import { StdlibProvider } from './views/stdlib';
import { ExamplesProvider } from './views/examples';
import { DocsProvider } from './views/docs';

export interface ControlCenter {
  state: SharedViewState;
  recentActions: RecentActions;
  refreshAll(): void;
  views: {
    overview: OverviewProvider;
    quickActions: QuickActionsProvider;
    projects: ProjectsProvider;
    commands: CommandsProvider;
    stdlib: StdlibProvider;
    examples: ExamplesProvider;
    docs: DocsProvider;
  };
}

export function registerControlCenter(
  context: vscode.ExtensionContext,
  state: SharedViewState,
): ControlCenter {
  const recentActions = new RecentActions();

  const overview = new OverviewProvider(state, recentActions);
  const quickActions = new QuickActionsProvider();
  const projects = new ProjectsProvider();
  const commands = new CommandsProvider();
  const stdlib = new StdlibProvider();
  const examples = new ExamplesProvider();
  const docs = new DocsProvider(vscode.Uri.joinPath(context.extensionUri, 'docs', 'user').fsPath);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('karkain.overview', overview),
    vscode.window.registerTreeDataProvider('karkain.quickActions', quickActions),
    vscode.window.registerTreeDataProvider('karkain.projects', projects),
    vscode.window.registerTreeDataProvider('karkain.commands', commands),
    vscode.window.registerTreeDataProvider('karkain.stdlib', stdlib),
    vscode.window.registerTreeDataProvider('karkain.examples', examples),
    vscode.window.registerTreeDataProvider('karkain.docs', docs),
  );

  return {
    state,
    recentActions,
    views: { overview, quickActions, projects, commands, stdlib, examples, docs },
    refreshAll: () => {
      overview.refresh();
      quickActions.refresh();
      projects.refresh();
      commands.refresh();
      stdlib.refresh();
      examples.refresh();
      docs.refresh();
    },
  };
}
