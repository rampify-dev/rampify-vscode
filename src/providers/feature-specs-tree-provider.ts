import * as vscode from 'vscode';
import { RampifyApiClient } from '../api/client';
import { FeatureSpec } from '../api/types';
import { getProjectConfig } from '../utils/project-config';

type TreeItem = StatusGroupTreeItem | FeatureSpecTreeItem | MessageTreeItem;

const STATUS_ORDER: FeatureSpec['status'][] = [
  'planned',
  'in_progress',
  'completed',
  'verified',
  'deprecated',
];

const STATUS_LABELS: Record<FeatureSpec['status'], string> = {
  in_progress: 'In Progress',
  planned: 'Planned',
  completed: 'Completed',
  verified: 'Verified',
  deprecated: 'Deprecated',
};

const STATUS_ICONS: Record<FeatureSpec['status'], string> = {
  in_progress: 'play-circle',
  planned: 'lightbulb',
  completed: 'pass-filled',
  verified: 'verified-filled',
  deprecated: 'circle-slash',
};

const PRIORITY_ICONS: Record<FeatureSpec['priority'], string> = {
  critical: 'error',
  high: 'warning',
  normal: 'info',
  low: 'circle-outline',
};

const PRIORITY_COLORS: Record<FeatureSpec['priority'], string> = {
  critical: 'errorForeground',
  high: 'editorWarning.foreground',
  normal: 'editorInfo.foreground',
  low: 'descriptionForeground',
};

const TYPE_LABELS: Record<FeatureSpec['feature_type'], string> = {
  new_feature: 'Feature',
  enhancement: 'Enhancement',
  refactor: 'Refactor',
  bug_fix: 'Bug Fix',
  optimization: 'Optimization',
};

class StatusGroupTreeItem extends vscode.TreeItem {
  constructor(
    public readonly status: FeatureSpec['status'],
    public readonly count: number
  ) {
    super(STATUS_LABELS[status], vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = 'featureSpecGroup';
    this.iconPath = new vscode.ThemeIcon(STATUS_ICONS[status]);
    this.description = `${count} spec${count !== 1 ? 's' : ''}`;
  }
}

class FeatureSpecTreeItem extends vscode.TreeItem {
  constructor(
    public readonly spec: FeatureSpec,
    public readonly clientId: string,
    public readonly webUrl: string
  ) {
    super(spec.title, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'featureSpec';

    const isFinding = !!spec.module;

    // Icon: priority for all specs (consistent visual language)
    this.iconPath = new vscode.ThemeIcon(
      PRIORITY_ICONS[spec.priority],
      new vscode.ThemeColor(PRIORITY_COLORS[spec.priority])
    );

    // Description: "SEO · 4 URLs" for findings, "Enhancement · 2/5 tasks" for user specs
    if (isFinding) {
      const moduleLabel = (spec.module || 'scan').toUpperCase();
      const urlCount = spec.affected_urls?.length || 0;
      this.description = urlCount > 0
        ? `${moduleLabel} · ${urlCount} URL${urlCount !== 1 ? 's' : ''}`
        : moduleLabel;
    } else {
      const typeLabel = TYPE_LABELS[spec.feature_type];
      const progress = spec.tasks_count > 0
        ? ` · ${spec.completed_tasks_count}/${spec.tasks_count} tasks`
        : '';
      this.description = `${typeLabel}${progress}`;
    }

    // Tooltip with full context
    const tooltip = new vscode.MarkdownString();
    tooltip.appendMarkdown(`**${spec.title}**\n\n`);
    if (spec.description) {
      tooltip.appendMarkdown(`${spec.description}\n\n`);
    }
    if (isFinding && spec.fix_instructions) {
      tooltip.appendMarkdown(`**Fix:** ${spec.fix_instructions}\n\n`);
    }
    if (isFinding && spec.affected_urls?.length) {
      const urls = spec.affected_urls.slice(0, 5).map((u: any) => u.url || u.path).join(', ');
      tooltip.appendMarkdown(`**Affected URLs:** ${urls}${spec.affected_urls.length > 5 ? '...' : ''}\n\n`);
    }
    if (spec.next_action) {
      tooltip.appendMarkdown(`**Next Action:** ${spec.next_action}\n\n`);
    }
    if (spec.affected_files?.length > 0) {
      tooltip.appendMarkdown(`**Files:** ${spec.affected_files.slice(0, 3).join(', ')}${spec.affected_files.length > 3 ? '...' : ''}\n\n`);
    }
    if (spec.tags?.length > 0) {
      tooltip.appendMarkdown(`**Tags:** ${spec.tags.join(', ')}`);
    }
    this.tooltip = tooltip;

    // Click to open in browser
    this.command = {
      command: 'rampify.openFeatureSpec',
      title: 'Open Feature Spec',
      arguments: [spec, clientId, webUrl]
    };
  }
}

class MessageTreeItem extends vscode.TreeItem {
  constructor(message: string, icon?: string) {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'message';
    if (icon) {
      this.iconPath = new vscode.ThemeIcon(icon);
    }
  }
}

const STALE_TTL_MS = 30_000; // 30 seconds
const RESOLVED_STATUSES: Set<FeatureSpec['status']> = new Set(['completed', 'verified', 'deprecated']);

export class FeatureSpecsTreeProvider implements vscode.TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private specs: FeatureSpec[] = [];
  private siteId: string | null = null;
  private loaded = false;
  private lastLoadedAt = 0;
  private showResolved = false;

  constructor(
    private apiClient: RampifyApiClient,
    private getWebUrl: () => string,
    private context?: vscode.ExtensionContext
  ) {
    this.showResolved = context?.workspaceState.get('rampify.showResolved', false) ?? false;
    vscode.commands.executeCommand('setContext', 'rampify.showResolved', this.showResolved);
  }

  toggleResolved(): void {
    this.showResolved = !this.showResolved;
    this.context?.workspaceState.update('rampify.showResolved', this.showResolved);
    vscode.commands.executeCommand('setContext', 'rampify.showResolved', this.showResolved);
    this._onDidChangeTreeData.fire();
  }

  refresh(): void {
    this.loaded = false;
    this.lastLoadedAt = 0;
    this.specs = [];
    this.siteId = null;
    this._onDidChangeTreeData.fire();
  }

  /** Returns true if cached data is older than the TTL and should be re-fetched. */
  isStale(): boolean {
    return Date.now() - this.lastLoadedAt > STALE_TTL_MS;
  }

  getTreeItem(element: TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TreeItem): Promise<TreeItem[]> {
    const projectConfig = getProjectConfig();
    if (!projectConfig) {
      return [
        new MessageTreeItem('No project linked', 'warning'),
        new MessageTreeItem('Click "Setup Project Link" to get started', 'link'),
      ];
    }

    try {
      if (!this.loaded) {
        await this.loadData(projectConfig.clientId);
      }

      if (this.specs.length === 0) {
        const setupItem = new MessageTreeItem('Set up MCP server to create specs with AI', 'terminal');
        setupItem.command = {
          command: 'rampify.installMcpServer',
          title: 'Set Up MCP Server'
        };
        return [
          new MessageTreeItem('No feature specs yet', 'info'),
          setupItem,
        ];
      }

      // Root: status groups
      if (!element) {
        const grouped = this.groupByStatus();
        return STATUS_ORDER
          .filter(status => grouped.has(status))
          .filter(status => this.showResolved || !RESOLVED_STATUSES.has(status))
          .map(status => new StatusGroupTreeItem(status, grouped.get(status)!.length));
      }

      // Status group: list specs
      if (element instanceof StatusGroupTreeItem) {
        const grouped = this.groupByStatus();
        const specs = grouped.get(element.status) || [];

        // Sort: critical → high → normal → low
        const priorityOrder: Record<FeatureSpec['priority'], number> = {
          critical: 0, high: 1, normal: 2, low: 3
        };
        specs.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

        return specs.map(spec =>
          new FeatureSpecTreeItem(spec, projectConfig.clientId, this.getWebUrl())
        );
      }

      return [];
    } catch (error) {
      console.error('Error loading feature specs:', error);
      return [new MessageTreeItem('Error loading feature specs', 'error')];
    }
  }

  private async loadData(clientId: string): Promise<void> {
    const site = await this.apiClient.getSite(clientId);
    if (!site) {
      this.specs = [];
      this.loaded = true;
      this.lastLoadedAt = Date.now();
      return;
    }

    this.siteId = site.id;
    this.specs = await this.apiClient.getFeatureSpecs(site.id);
    this.loaded = true;
    this.lastLoadedAt = Date.now();
  }

  private groupByStatus(): Map<FeatureSpec['status'], FeatureSpec[]> {
    const map = new Map<FeatureSpec['status'], FeatureSpec[]>();
    for (const spec of this.specs) {
      const existing = map.get(spec.status) || [];
      map.set(spec.status, [...existing, spec]);
    }
    return map;
  }

  getSiteId(): string | null {
    return this.siteId;
  }
}
