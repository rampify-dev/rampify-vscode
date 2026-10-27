/**
 * The sidebar's setup steps: the one onboarding (spec 724f9f24), read from the
 * server (GET /sites/:id/setup-advance → `onboarding`), the same state the web
 * setup page and the AI tool's suggest_next_action read. Finishing a step
 * anywhere finishes it here, and a skip is stored on the server, so it holds
 * on every surface. The extension keeps no step list of its own; it only adds
 * "Your first spec" after onboarding (the getting-started spec, spec a3f4b733).
 *
 * Pure (no vscode import) so the Home panel's HTML can be rendered in tests.
 */

export type OnboardingStep = 'site' | 'ai_tool' | 'search_console' | 'how_found';
export type SidebarStep = OnboardingStep | 'first_spec';

/** One step of the server's onboarding state (lib/onboarding/state.ts OnboardingStepState). */
export interface OnboardingStepState {
  step: OnboardingStep;
  label: string;
  gate: 'required' | 'optional';
  status: 'done' | 'todo' | 'skipped';
  detail: string | null;
}

/** The server's onboarding state (lib/onboarding/state.ts OnboardingState). */
export interface OnboardingState {
  steps: OnboardingStepState[];
  next: OnboardingStep | null;
  complete: boolean;
  facts: {
    siteState: 'no_site' | 'not_scanned' | 'crawl_failed' | 'scanned';
    searchConsole: 'connected' | 'needs_property' | 'pending_verification' | 'needs_reauth' | 'none';
    aiTool: 'used' | 'connected' | 'none';
    aiToolLive: boolean;
    howFound: 'answered' | 'skipped' | 'unanswered';
    skipped: string[];
  };
}

/** Steps an older server (no `onboarding` field) still gets: the two required ones. */
const FALLBACK: readonly OnboardingStep[] = ['site', 'ai_tool'];

/**
 * The sidebar's steps, in order: the server's. "Your first spec" was a second
 * prompt after the AI tool's; the first prompt's suggest_next_action now
 * offers it (spec 8a5bf8b1).
 */
export function sidebarSteps(onboarding: OnboardingState | null): OnboardingStep[] {
  return onboarding ? onboarding.steps.map((s) => s.step) : [...FALLBACK];
}

/** The parts of the sidebar's state the step rules read (see SetupSnapshot). */
export interface StepInputs {
  onboarding: OnboardingState | null;
  /** Older servers only: the project has a site. */
  hasSite: boolean;
  aiToolConnected: boolean | null;
  mcpConfigured: boolean;
  gettingStarted: { status: string } | null;
  userSpecCount: number;
  /** "Your first spec" skipped on this machine (it's not an onboarding step). */
  firstSpecSkipped: boolean;
}

/** The step rules' inputs from the sidebar's snapshot (SetupSnapshot's fields of the same names). */
export function stepInputs(s: Omit<StepInputs, 'hasSite'> & { project: { domain: string | null } | null }): StepInputs {
  return {
    onboarding: s.onboarding,
    hasSite: !!s.project?.domain,
    aiToolConnected: s.aiToolConnected,
    mcpConfigured: s.mcpConfigured,
    gettingStarted: s.gettingStarted,
    userSpecCount: s.userSpecCount,
    firstSpecSkipped: s.firstSpecSkipped,
  };
}

const FINISHED = new Set(['completed', 'verified']);

function serverStatus(id: OnboardingStep, s: StepInputs): OnboardingStepState['status'] | null {
  return s.onboarding?.steps.find((x) => x.step === id)?.status ?? null;
}

/**
 * Whether a step is done. Onboarding steps: what the server says. "Your first
 * spec" counts only the user's own work, never specs a site scan filed.
 */
export function stepDone(id: SidebarStep, s: StepInputs): boolean {
  if (id === 'first_spec') {
    return s.gettingStarted ? FINISHED.has(s.gettingStarted.status) : s.userSpecCount > 0;
  }
  const status = serverStatus(id, s);
  if (status) { return status === 'done'; }
  // Older server: the two required steps from what the extension can see.
  if (id === 'site') { return s.hasSite; }
  if (id === 'ai_tool') { return s.aiToolConnected ?? s.mcpConfigured; }
  return false;
}

/** Whether a step was skipped: on the server for onboarding steps, on this machine for the first spec. */
export function stepSkipped(id: SidebarStep, s: StepInputs): boolean {
  if (id === 'first_spec') { return s.firstSpecSkipped; }
  return serverStatus(id, s) === 'skipped';
}

/**
 * Setup is settled: every step done or skipped, and the site's scan has run.
 * A site whose scan failed or never ran counts as added, but the checklist
 * stays up until the scan works (its failure and Scan Again live there).
 */
export function setupSettled(s: StepInputs): boolean {
  const site = s.onboarding?.facts.siteState;
  if (site === 'not_scanned' || site === 'crawl_failed') { return false; }
  return sidebarSteps(s.onboarding).every((id) => stepDone(id, s) || stepSkipped(id, s));
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
