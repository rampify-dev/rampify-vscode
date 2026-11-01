import * as vscode from 'vscode';
import { RampifyApiClient } from '../api/client';
import { FeatureSpec, Goal } from '../api/types';
import { getProjectConfig } from '../utils/project-config';

type TreeItem = GoalsGroupTreeItem | GoalTreeItem | OriginGroupTreeItem | StatusGroupTreeItem | FeatureSpecTreeItem | MessageTreeItem;

/**
 * Where a spec came from: the user and their AI ('yours', including the
 * getting-started spec), or Rampify's site scans. Kept apart so a scan during
 * onboarding doesn't bury the user's own spec (spec a3f4b733).
 */
type Origin = 'yours' | 'scan';
const SCAN_SOURCES = new Set(['seo_scan', 'security_scan', 'accessibility_scan']);
const originOf = (spec: FeatureSpec): Origin => (SCAN_SOURCES.has(spec.source) ? 'scan' : 'yours');

/** Shortened for a one-line description. */
const short = (text: string, max = 28) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** The project's goals, first in the list (Release 1, spec 9add89e9). */
class GoalsGroupTreeItem extends vscode.TreeItem {
  constructor(count: number) {
    super('Goals', vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = 'goalsGroup';
    this.iconPath = new vscode.ThemeIcon('target');
    this.description = `${count} active`;
  }
}

/** One goal: expands to the open specs that serve it. */
class GoalTreeItem extends vscode.TreeItem {
  constructor(public readonly goal: Goal, public readonly openCount: number) {
    super(goal.title, openCount > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'goal';
    this.iconPath = new vscode.ThemeIcon('target', new vscode.ThemeColor('editorWarning.foreground'));
    this.description = openCount === 0 ? 'no open specs' : `${openCount} open spec${openCount !== 1 ? 's' : ''}`;
  }
}

/** What a spec row says about its goal and its family (spec 9add89e9). */
interface SpecContext {
  goal?: Goal | null;
  parent?: FeatureSpec | null;
  /** Its parts, when it's an umbrella: Not doing left out of the total. */
  parts?: { done: number; total: number } | null;
  /** Shown inside an umbrella or a goal, where the status group isn't. */
  showStatus?: boolean;
}

class OriginGroupTreeItem extends vscode.TreeItem {
  constructor(public readonly origin: Origin, count: number) {
    super(
      origin === 'yours' ? 'Your specs' : 'From your site scan',
      origin === 'yours' ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed
    );
    this.contextValue = 'featureSpecOrigin';
    this.iconPath = new vscode.ThemeIcon(origin === 'yours' ? 'account' : 'search');
    this.description = `${count} spec${count !== 1 ? 's' : ''}`;
  }
}

// The dashboard's group order (lib/specs/status.ts SPEC_STATUSES): what needs
// you, then what's being built, then the backlog, then what's finished. A unit
// test keeps them equal.
const STATUS_ORDER: FeatureSpec['status'][] = [
  'idea',
  'in_progress',
  'planned',
  'completed',
  'verified',
  'deprecated',
];

// The dashboard's labels (lib/specs/status.ts, spec 0ebf5052); a unit test keeps them equal.
const STATUS_LABELS: Record<FeatureSpec['status'], string> = {
  in_progress: 'In progress',
  planned: 'Planned',
  completed: 'Done',
  verified: 'Live',
  idea: 'Idea',
  deprecated: 'Not doing',
};

const STATUS_ICONS: Record<FeatureSpec['status'], string> = {
  in_progress: 'play-circle',
  planned: 'lightbulb',
  completed: 'pass-filled',
  verified: 'verified-filled',
  idea: 'comment',
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
  page: 'Page',
  positioning: 'Positioning',
};

class StatusGroupTreeItem extends vscode.TreeItem {
  constructor(
    public readonly status: FeatureSpec['status'],
    public readonly count: number,
    /** Set when the list is split by origin. */
    public readonly origin?: Origin
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
    public readonly webUrl: string,
    ctx: SpecContext = {}
  ) {
    // An umbrella expands to its parts.
    super(spec.title, ctx.parts && ctx.parts.total > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'featureSpec';

    const isFinding = !!spec.module;

    // Icon: priority for all specs (consistent visual language)
    this.iconPath = new vscode.ThemeIcon(
      PRIORITY_ICONS[spec.priority],
      new vscode.ThemeColor(PRIORITY_COLORS[spec.priority])
    );

    // Description: "SEO · 4 URLs" for findings, the spec type for user specs
    if (isFinding) {
      const moduleLabel = (spec.module || 'scan').toUpperCase();
      const urlCount = spec.affected_urls?.length || 0;
      this.description = urlCount > 0
        ? `${moduleLabel} · ${urlCount} URL${urlCount !== 1 ? 's' : ''}`
        : moduleLabel;
    } else {
      this.description = TYPE_LABELS[spec.feature_type] ?? spec.feature_type;
    }
    // Where it stands and what it belongs to: its status (inside an umbrella
    // or a goal), its parts' progress, the goal it serves, its umbrella.
    const extra = [
      ctx.showStatus ? STATUS_LABELS[spec.status] : null,
      ctx.parts && ctx.parts.total > 0 ? `${ctx.parts.done} of ${ctx.parts.total} done` : null,
      ctx.goal ? `◎ ${short(ctx.goal.title)}` : null,
      ctx.parent ? `part of “${short(ctx.parent.title)}”` : null,
    ].filter(Boolean);
    if (extra.length > 0) {
      this.description = [ctx.showStatus ? null : this.description, ...extra].filter(Boolean).join(' · ');
    }

    // Tooltip with full context
    const tooltip = new vscode.MarkdownString();
    tooltip.appendMarkdown(`**${spec.title}**\n\n`);
    if (spec.description) {
      // Spec bodies can run to pages; the tooltip is a preview.
      const preview = spec.description.length > TOOLTIP_DESCRIPTION_CHARS
        ? `${spec.description.slice(0, TOOLTIP_DESCRIPTION_CHARS).trimEnd()}…`
        : spec.description;
      tooltip.appendMarkdown(`${preview}\n\n`);
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
    if (ctx.goal) {
      tooltip.appendMarkdown(`**Serves:** ${ctx.goal.title}\n\n`);
    }
    if (ctx.parent) {
      tooltip.appendMarkdown(`**Part of:** ${ctx.parent.title}\n\n`);
    }
    if (ctx.parts && ctx.parts.total > 0) {
      tooltip.appendMarkdown(`**Parts:** ${ctx.parts.done} of ${ctx.parts.total} done\n\n`);
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

const STALE_TTL_MS = 300_000; // 5 minutes
const TOOLTIP_DESCRIPTION_CHARS = 600;
/**
 * Hidden unless "show resolved" is on. Ideas are uncommitted, so like the
 * dashboard's default view they stay out of the working list.
 */
const HIDDEN_BY_DEFAULT: Set<FeatureSpec['status']> = new Set(['completed', 'verified', 'deprecated', 'idea']);

export class FeatureSpecsTreeProvider implements vscode.TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private specs: FeatureSpec[] = [];
  private goals: Goal[] = [];
  private loaded = false;
  private lastLoadedAt = 0;
  private nextLoadBackground = false;
  private showResolved = false;

  constructor(
    /** A getter, not a client: the client is rebuilt when the key changes. */
    private getApiClient: () => RampifyApiClient,
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

  /** `background`: the extension refreshing on its own (poll, focus, visibility), not a click. */
  refresh(opts: { background?: boolean } = {}): void {
    this.nextLoadBackground = opts.background ?? false;
    this.loaded = false;
    this.lastLoadedAt = 0;
    this.specs = [];
    this.goals = [];
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
    // Signed out, or no project linked to this folder: the sidebar shows Home
    // (sign-in and setup) instead of this list.
    const projectConfig = getProjectConfig();
    if (!projectConfig || !this.getApiClient().signedIn) {
      return [];
    }

    try {
      if (!this.loaded) {
        await this.loadData(projectConfig.clientId);
      }

      if (this.specs.length === 0) {
        return [];
      }

      const visible = (status: FeatureSpec['status']) => this.showResolved || !HIDDEN_BY_DEFAULT.has(status);
      const statusGroups = (origin?: Origin) => {
        const grouped = this.groupByStatus(origin);
        return STATUS_ORDER
          .filter(status => grouped.has(status) && visible(status))
          .map(status => new StatusGroupTreeItem(status, grouped.get(status)!.length, origin));
      };
      const hasScanSpecs = this.specs.some(s => originOf(s) === 'scan');

      // Root: the goals first (when there are any), then split by origin once
      // a scan has filed specs; otherwise status groups.
      if (!element) {
        const goals: TreeItem[] = this.goals.length > 0 ? [new GoalsGroupTreeItem(this.goals.length)] : [];
        if (!hasScanSpecs) { return [...goals, ...statusGroups()]; }
        return [
          ...goals,
          ...(['yours', 'scan'] as Origin[])
            .map(origin => ({ origin, count: this.specs.filter(s => originOf(s) === origin && visible(s.status)).length }))
            .filter(g => g.count > 0)
            .map(g => new OriginGroupTreeItem(g.origin, g.count)),
        ];
      }

      // A goal's open specs (the statuses the list shows), with their status.
      if (element instanceof GoalsGroupTreeItem) {
        return this.goals.map(goal => new GoalTreeItem(goal, this.specs.filter(s => s.focus_id === goal.id && visible(s.status)).length));
      }
      if (element instanceof GoalTreeItem) {
        return this.specs
          .filter(s => s.focus_id === element.goal.id && visible(s.status))
          .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status))
          .map(spec => this.specItem(spec, projectConfig.clientId, { showStatus: true, inGoal: true }));
      }

      // An umbrella's parts, every status, in the dashboard's order.
      if (element instanceof FeatureSpecTreeItem) {
        return this.specs
          .filter(s => s.parent_spec_id === element.spec.id)
          .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.title.localeCompare(b.title))
          .map(spec => this.specItem(spec, projectConfig.clientId, { showStatus: true, inParent: true }));
      }

      if (element instanceof OriginGroupTreeItem) {
        return statusGroups(element.origin);
      }

      // Status group: list specs
      if (element instanceof StatusGroupTreeItem) {
        const specs = this.groupByStatus(element.origin).get(element.status) || [];

        // Sort: critical → high → normal → low
        const priorityOrder: Record<FeatureSpec['priority'], number> = {
          critical: 0, high: 1, normal: 2, low: 3
        };
        specs.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

        return specs.map(spec => this.specItem(spec, projectConfig.clientId));
      }

      return [];
    } catch (error) {
      console.error('Error loading feature specs:', error);
      return [new MessageTreeItem('Error loading feature specs', 'error')];
    }
  }

  private async loadData(clientId: string): Promise<void> {
    const api = this.getApiClient().withTrigger(this.nextLoadBackground ? 'background' : 'user');
    this.nextLoadBackground = false;
    const site = await api.getSite(clientId);
    if (!site) {
      this.specs = [];
      this.loaded = true;
      this.lastLoadedAt = Date.now();
      return;
    }

    const { specs, goals } = await api.getFeatureSpecsAndGoals(site.id);
    this.specs = specs;
    this.goals = goals;
    this.loaded = true;
    this.lastLoadedAt = Date.now();
  }

  /** A spec's row, with its goal, umbrella and parts (spec 9add89e9). */
  private specItem(spec: FeatureSpec, clientId: string, opts: { showStatus?: boolean; inParent?: boolean; inGoal?: boolean } = {}): FeatureSpecTreeItem {
    const parts = this.specs.filter(s => s.parent_spec_id === spec.id && s.status !== 'deprecated');
    return new FeatureSpecTreeItem(spec, clientId, this.getWebUrl(), {
      // Inside its goal, naming the goal would only repeat the row above.
      goal: !opts.inGoal && spec.focus_id ? this.goals.find(g => g.id === spec.focus_id) ?? null : null,
      // Inside its umbrella, "part of" would only repeat the row above.
      parent: !opts.inParent && spec.parent_spec_id ? this.specs.find(s => s.id === spec.parent_spec_id) ?? null : null,
      parts: parts.length > 0 ? { done: parts.filter(p => p.status === 'completed' || p.status === 'verified').length, total: parts.length } : null,
      showStatus: opts.showStatus,
    });
  }

  private groupByStatus(origin?: Origin): Map<FeatureSpec['status'], FeatureSpec[]> {
    const map = new Map<FeatureSpec['status'], FeatureSpec[]>();
    for (const spec of this.specs) {
      if (origin && originOf(spec) !== origin) { continue; }
      const existing = map.get(spec.status) || [];
      map.set(spec.status, [...existing, spec]);
    }
    return map;
  }

}
