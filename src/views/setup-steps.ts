/**
 * Which setup steps the sidebar shows, per the project's answers (spec
 * aa7fcad3). The sidebar counterpart of the web wizard's PATH_MATRIX
 * (lib/setup-wizard/path-router.ts); both are tabulated side by side in
 * .claude/docs/wizard-behavior.md, so keep the three in step.
 *
 * Why each answer changes the steps:
 *   - idea (not live, no domain): nothing to crawl, no Search Console yet.
 *   - domain_only (domain, not live): a parked page crawls empty, so no scan;
 *     Search Console is optional, so data collects from launch day.
 *   - live_site: scan it, and Search Console is recommended (no rankings or
 *     clicks without it).
 *   - app: no site questions (matches the wizard's app path).
 *
 * Pure (no vscode import) so the Home panel's HTML can be rendered in tests.
 */

export type ProjectType = 'website' | 'app';
export type StartingPoint = 'idea' | 'domain_only' | 'live_site';

export type SidebarStep =
  | 'project'
  | 'scan'
  | 'gsc_recommended'
  | 'gsc_optional'
  | 'ai_tool'
  | 'first_spec';

export const SIDEBAR_STEPS: {
  website: Record<StartingPoint, readonly SidebarStep[]>;
  app: readonly SidebarStep[];
} = {
  website: {
    idea:        ['project', 'ai_tool', 'first_spec'],
    domain_only: ['project', 'gsc_optional', 'ai_tool', 'first_spec'],
    live_site:   ['project', 'scan', 'gsc_recommended', 'ai_tool', 'first_spec'],
  },
  app: ['project', 'ai_tool', 'first_spec'],
} as const;

/** Before the project questions are answered, only the core steps show. */
const UNANSWERED: readonly SidebarStep[] = ['project', 'ai_tool', 'first_spec'];

export function sidebarSteps(type: ProjectType | null, startingPoint: StartingPoint | null): SidebarStep[] {
  if (type === 'app') { return [...SIDEBAR_STEPS.app]; }
  if (type === 'website' && startingPoint) { return [...SIDEBAR_STEPS.website[startingPoint]]; }
  return [...UNANSWERED];
}

/** The project questions count as answered once we know whether there's a site to work with. */
export function projectAnswered(type: ProjectType | null, startingPoint: StartingPoint | null): boolean {
  return type === 'app' || !!startingPoint;
}

/** The parts of the sidebar's state the step rules read (see SetupSnapshot). */
export interface StepInputs {
  needsProjectSetup: boolean;
  scan: 'none' | 'running' | 'done' | 'failed';
  gsc: { connected: boolean; hasProperty: boolean };
  aiToolConnected: boolean | null;
  mcpConfigured: boolean;
  gettingStarted: { status: string } | null;
  userSpecCount: number;
}

const FINISHED = new Set(['completed', 'verified']);

/**
 * Whether a step is done. "Your first spec" counts only the user's own work,
 * never specs a site scan filed: it's done when the getting-started spec is
 * finished, or (for people who already had specs) when the project has a spec
 * of their own and no getting-started spec.
 */
export function stepDone(id: SidebarStep, s: StepInputs): boolean {
  switch (id) {
    case 'project': return !s.needsProjectSetup;
    case 'scan': return s.scan === 'done';
    case 'gsc_recommended':
    case 'gsc_optional': return s.gsc.connected && s.gsc.hasProperty;
    case 'ai_tool': return s.aiToolConnected ?? s.mcpConfigured;
    case 'first_spec':
      return s.gettingStarted ? FINISHED.has(s.gettingStarted.status) : s.userSpecCount > 0;
  }
}

/** "my-test_project" / "myTestProject" → "My Test Project". */
export function tidyFolderName(folder: string): string {
  return folder
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[-_.\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}
