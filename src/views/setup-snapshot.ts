/**
 * The Home panel's state, as types only. Kept apart from setup-state.ts (which
 * imports vscode) so the panel's HTML and step rules can be type-checked and
 * tested outside the editor (tests/unit/vscode-sidebar-steps.test.ts runs in
 * the root project, where the vscode types aren't installed).
 */
import type { OnboardingState } from './setup-steps';

/** The AI tools the extension can connect (labels in mcp/connect.ts). */
export type AiTool = 'copilot' | 'cursor' | 'claude';

/**
 * Where a sign-in is: waiting on the browser (or a code confirmed there),
 * finishing (the browser handed back; linking the folder and loading the
 * checklist), or none in progress.
 */
export type SignInPhase = 'idle' | 'browser' | 'code' | 'finishing';

/** The editor we're running in, which decides the AI tools offered first. */
export type EditorKind = 'vscode' | 'cursor' | 'other';

/**
 * What the Home panel shows: where this folder is in getting set up. Loaded
 * independently of the specs tree (which only fetches while visible), so the
 * panel can tell when the first spec lands and hand over to the tree.
 */
export interface SetupSnapshot {
  hasFolder: boolean;
  signedIn: boolean;
  /** Signed in through OAuth for this folder's project (vs a pasted API key). */
  viaSignIn: boolean;
  clientId: string | null;
  /** projects.id (the /sites/:id API id). */
  siteId: string | null;
  projectName: string | null;
  /** The open folder's name: the default project name. */
  folderName: string | null;
  /** The project's name and site, as saved. */
  project: ProjectAnswers | null;
  /** The one onboarding state from the server (null on older servers). */
  onboarding: OnboardingState | null;
  /** "How did you find us" answers (from the server, the same as web setup's). */
  howFoundOptions: { value: string; label: string; more?: boolean }[];
  /** Why the last scan failed, when it did. */
  scanFailure: { kind: string; summary: string; nextStep: string; helpUrl: string | null } | null;
  /** Site scan: none yet, running, finished (pages found), or failed. */
  scan: 'none' | 'running' | 'done' | 'failed';
  gsc: { connected: boolean; hasProperty: boolean };
  /** Rampify's MCP server is in this folder's (or Cursor's) MCP config. */
  mcpConfigured: boolean;
  /**
   * An AI tool has actually connected to Rampify over MCP (server-reported).
   * Null when the server doesn't say; the checklist falls back to mcpConfigured.
   */
  aiToolConnected: boolean | null;
  specCount: number;
  /** The getting-started spec (spec a3f4b733), once created. */
  gettingStarted: { id: string; title: string; status: string; tasks: { id: string; title: string; status: string }[] } | null;
  /** The spec the user's AI wrote from it ("what you're working on"). */
  followUp: { id: string; title: string; status: string } | null;
  /** The user's own specs (not the getting-started spec, not scan specs). */
  userSpecCount: number;
  /** Specs Rampify's site scans filed. */
  scanSpecCount: number;
  /** The folder has commits (null = couldn't tell). No commits → ask what they're building. */
  hasCommits: boolean | null;
  /** Where prompts go: the AI tool the user connected (or the editor's own). */
  aiTool: AiTool;
  aiToolLabel: string;
  /** "Your first spec" was skipped on this machine (onboarding skips live on the server). */
  firstSpecSkipped: boolean;
  /** Couldn't reach Rampify or the project. */
  error: string | null;
  /** A sign-in in progress (the panel shows it instead of the signed-out pitch). */
  signInPhase: SignInPhase;
  editor: EditorKind;
  /** This VS Code can connect Copilot to an MCP server (1.101+, not Cursor). */
  copilotReady: boolean;
  /** The AI tool connected in this folder (from the panel or Set Up MCP), if any: its next steps show. */
  pickedAiTool: AiTool | null;
  /** What to ask the AI tool first (the server's, the same on every surface). */
  firstPrompt: string | null;
}

export interface ProjectAnswers {
  name: string | null;
  domain: string | null;
}
