import * as vscode from 'vscode';
import { RampifyApiClient, Environment } from './api/client';
import { FeatureSpecsTreeProvider } from './providers/feature-specs-tree-provider';
import {
  getProjectConfig,
  saveProjectConfig,
  detectProjectDomain,
} from './utils/project-config';
import { Client, FeatureSpec, ProjectQuota } from './api/types';
import { primaryProject, projectDisplayName } from './utils/project-display';
// Copy of the rules file `rampify init` installs (bundled as text by esbuild).
// Kept inside this package so the standalone mirror repo builds; a unit test
// (tests/unit/vscode-rules-template-sync.test.ts) fails if the copies drift.
import rulesTemplate from './templates/rampify-rules.md';
import { Session } from './auth/session';
import { RampifyOAuth, SignInCancelled, type SignInResult } from './auth/oauth';
import { SetupState } from './views/setup-state';
import { HomeViewProvider } from './views/home-view';
import {
  AI_TOOL_LABELS,
  CopilotMcpProvider,
  PIN_HEADER,
  SERVER_NAME,
  chosenAiTool,
  defaultAiTool,
  rememberAiTool,
  sendToAiTool,
  syncPinnedConfigs,
  writePinnedConfig,
  type AiTool,
} from './mcp/connect';

let apiClient: RampifyApiClient;
let featureSpecsProvider: FeatureSpecsTreeProvider;
let session: Session;
let oauth: RampifyOAuth;
let setupState: SetupState;
let copilotMcp: CopilotMcpProvider;
let extContext: vscode.ExtensionContext;

/** "Open your project folder, then sign in": survives the window reload. */
const PENDING_SIGN_IN_KEY = 'rampify.pendingSignIn';
const PENDING_SIGN_IN_TTL_MS = 10 * 60 * 1000;

export async function activate(context: vscode.ExtensionContext) {
  console.log('Rampify extension is now active');
  extContext = context;

  // Credentials live in SecretStorage, per linked project (see auth/session.ts).
  session = await Session.create(context.secrets, getProjectConfig()?.clientId);
  context.subscriptions.push(session);
  oauth = new RampifyOAuth(context.globalState, context.globalStorageUri.fsPath, context.secrets);
  // <scheme>://rampify.rampify/auth-callback → sign-in; /open → the setup
  // wizard's "Back to <editor>" button: refresh the checklist and show it.
  context.subscriptions.push(vscode.window.registerUriHandler({
    handleUri(uri: vscode.Uri) {
      if (uri.path === '/open') {
        setupState?.refresh();
        vscode.commands.executeCommand(setupState?.currentView === 'specs' ? 'rampify.featureSpecs.focus' : 'rampify.home.focus');
        return;
      }
      oauth.handleUri(uri);
    },
  }));

  // Initialize API client
  apiClient = createApiClient();

  // Home panel: signed-out pitch + setup checklist, until the project has specs.
  setupState = new SetupState(() => apiClient, session, context.workspaceState);
  // The panel shows a sign-in's progress (waiting on the browser, finishing).
  oauth.onPhase = (phase) => setupState.setSignInPhase(phase);
  context.subscriptions.push(setupState);
  // Copilot connects through VS Code's MCP provider API (no config file),
  // pinned to this folder's project. Other tools get pinned in-folder files.
  copilotMcp = new CopilotMcpProvider(context.workspaceState, getMcpUrl, () => getProjectConfig()?.clientId ?? null, () => session.apiKey || undefined);
  context.subscriptions.push(copilotMcp);
  const linkedProject = getProjectConfig()?.clientId;
  if (linkedProject) { syncPinnedConfigs(getMcpUrl(), linkedProject); }
  const homeView = new HomeViewProvider(setupState, getWebUrl, () => apiClient);
  context.subscriptions.push(homeView);
  context.subscriptions.push(vscode.window.registerWebviewViewProvider(HomeViewProvider.viewId, homeView));

  // Initialize tree view provider
  featureSpecsProvider = new FeatureSpecsTreeProvider(() => apiClient, getWebUrl, context);
  const featureSpecsView = vscode.window.createTreeView('rampify.featureSpecs', {
    treeDataProvider: featureSpecsProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(featureSpecsView);

  // Poll for new specs — only when sidebar is visible AND window is focused
  const POLL_INTERVAL_MS = 300_000; // 5 minutes
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let windowFocused = true;

  const startPolling = () => {
    if (pollTimer) { return; }
    pollTimer = setInterval(() => {
      if (windowFocused && featureSpecsProvider.isStale()) {
        featureSpecsProvider.refresh({ background: true });
      }
    }, POLL_INTERVAL_MS);
  };

  const stopPolling = () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
  };

  context.subscriptions.push(
    featureSpecsView.onDidChangeVisibility((e) => {
      if (e.visible) {
        if (featureSpecsProvider.isStale()) {
          featureSpecsProvider.refresh({ background: true });
        }
        startPolling();
      } else {
        stopPolling();
      }
    })
  );

  // Refresh when window regains focus (catches external spec changes)
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((e) => {
      windowFocused = e.focused;
      if (e.focused && featureSpecsProvider.isStale()) {
        featureSpecsProvider.refresh({ background: true });
      }
      // Coming back from the browser (setup wizard, sign-in) or the AI chat.
      if (e.focused) { setupState.refresh({ background: true }); }
    })
  );

  // Clean up timer on deactivate
  context.subscriptions.push({ dispose: stopPolling });

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('rampify.setupProject', async () => {
      await setupProjectLink();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('rampify.setApiKey', async () => {
      await setApiKey();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('rampify.signIn', async () => {
      await signInWithRampify();
    })
  );

  // For when the browser can't hand control back to this window.
  context.subscriptions.push(
    vscode.commands.registerCommand('rampify.signInWithCode', async () => {
      await signInWithRampify({ withCode: true });
    })
  );

  // Switch the sidebar between the setup checklist and the specs list.
  context.subscriptions.push(
    vscode.commands.registerCommand('rampify.showSpecs', async () => {
      await setupState.showView('specs');
      await vscode.commands.executeCommand('rampify.featureSpecs.focus');
    }),
    vscode.commands.registerCommand('rampify.showSetup', async () => {
      await setupState.showView('home');
      await vscode.commands.executeCommand('rampify.home.focus');
    })
  );

  // Title-bar ⋯ menu and Home panel actions (spec a3f4b733).
  context.subscriptions.push(
    vscode.commands.registerCommand('rampify.connectAiTool', (tool: AiTool, opts?: { quiet?: boolean }) => connectAiTool(tool, opts)),
    vscode.commands.registerCommand('rampify.cancelSignIn', () => oauth.cancel()),
    vscode.commands.registerCommand('rampify.renameProject', () => renameProject()),
    vscode.commands.registerCommand('rampify.openDashboard', () => {
      const clientId = getProjectConfig()?.clientId;
      vscode.env.openExternal(vscode.Uri.parse(clientId ? `${getWebUrl()}/clients/${clientId}/home` : `${getWebUrl()}/dashboard`));
    }),
    vscode.commands.registerCommand('rampify.finishSetupInDashboard', () => {
      const clientId = getProjectConfig()?.clientId;
      if (!clientId) { vscode.commands.executeCommand('rampify.home.focus'); return; }
      // ?from= lets the dashboard offer "Back to <editor>".
      vscode.env.openExternal(vscode.Uri.parse(
        `${getWebUrl()}/clients/${clientId}/setup?from=${encodeURIComponent(vscode.env.uriScheme)}`
      ));
    }),
    vscode.commands.registerCommand('rampify.openProjectFolder', (opts?: OpenFolderOptions) => openProjectFolder(opts ?? {})),
    vscode.commands.registerCommand('rampify.startFirstSpec', (buildingFirst?: string) => startFirstSpec(buildingFirst)),
    vscode.commands.registerCommand('rampify.startBuilding', (spec: { id: string; title: string }) => startBuilding(spec))
  );

  // Signing in again picks (or creates) another project for this folder.
  context.subscriptions.push(
    vscode.commands.registerCommand('rampify.switchProject', async () => {
      await signInWithRampify();
    })
  );

  // Key changed (sign-in, sign-out, another window): rebuild the client.
  context.subscriptions.push(
    session.onDidChange(() => {
      // Copilot connects with the session's key: a sign-in or sign-out changes it.
      copilotMcp.signInChanged(context.extension.id);
      apiClient = createApiClient();
      updateOnboardingContext();
      featureSpecsProvider.refresh({ background: true });
      setupState.refresh({ background: true });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('rampify.disconnect', async () => {
      const confirm = await vscode.window.showWarningMessage(
        'Disconnect from Rampify? This will clear your API key and project link.',
        { modal: true },
        'Disconnect'
      );
      if (confirm === 'Disconnect') {
        // A sign-in still waiting on the browser would sign them back in.
        oauth.cancel();
        const config = vscode.workspace.getConfiguration('rampify');
        await session.clear();
        if (vscode.workspace.workspaceFolders?.length) {
          await config.update('clientId', undefined, vscode.ConfigurationTarget.Workspace);
          await config.update('domain', undefined, vscode.ConfigurationTarget.Workspace);
        }
        await session.setProject(undefined);
        updateOnboardingContext();
        featureSpecsProvider.refresh();
        setupState.refresh();
        vscode.window.showInformationMessage('Disconnected from Rampify.');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('rampify.refreshFeatureSpecs', () => {
      featureSpecsProvider.refresh();
      setupState.refresh();
      vscode.window.showInformationMessage('Feature specs refreshed');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('rampify.toggleResolvedSpecs', () => {
      featureSpecsProvider.toggleResolved();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'rampify.openFeatureSpec',
      (specOrItem: FeatureSpec | any, clientId?: string, webUrl?: string) => {
        // When invoked from the inline context menu, VS Code passes the TreeItem as
        // the first argument. When invoked via the item's .command, explicit args are used.
        let spec: FeatureSpec;
        let cId: string;
        let wUrl: string;
        if (specOrItem?.spec) {
          spec = specOrItem.spec;
          cId = specOrItem.clientId;
          wUrl = specOrItem.webUrl;
        } else {
          spec = specOrItem;
          cId = clientId!;
          wUrl = webUrl!;
        }
        // The API's dashboard_url always points at production, so build the
        // link from the configured host when running against local dev.
        const url = spec.dashboard_url && getEnvironment() !== 'local'
          ? spec.dashboard_url
          : `${wUrl}/clients/${cId}/features/${spec.id}`;
        vscode.env.openExternal(vscode.Uri.parse(url));
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'rampify.copyFeatureSpecReference',
      (item: any) => {
        // When invoked from inline context menu, VS Code passes the TreeItem.
        // The FeatureSpecTreeItem exposes .spec with id and title.
        const spec: FeatureSpec | undefined = item?.spec;
        if (!spec) { return; }
        const text = `Feature Spec: "${spec.title}"\nspec_id: ${spec.id}\nUse the get_feature_spec MCP tool with this spec_id to retrieve full details.`;
        vscode.env.clipboard.writeText(text);
        vscode.window.showInformationMessage(`Copied reference for "${spec.title}"`);
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'rampify.openFeatureSpecsInBrowser',
      () => {
        const projectConfig = getProjectConfig();
        if (projectConfig) {
          const url = `${getWebUrl()}/clients/${projectConfig.clientId}/features`;
          vscode.env.openExternal(vscode.Uri.parse(url));
        } else {
          vscode.window.showWarningMessage('No project linked. Please setup project link first.');
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('rampify.installMcpServer', async () => {
      await installMcpServer();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('rampify.switchEnvironment', async () => {
      await switchEnvironment();
    })
  );

  // Listen for configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (e.affectsConfiguration('rampify')) {
        if (e.affectsConfiguration('rampify.clientId')) {
          await session.setProject(getProjectConfig()?.clientId);
        }
        // Recreate API client with new config
        apiClient = createApiClient();
        updateOnboardingContext();
        featureSpecsProvider.refresh({ background: true });
        setupState.refresh({ background: true });
      }
    })
  );

  // Open signup with attribution
  context.subscriptions.push(
    vscode.commands.registerCommand('rampify.openSignup', () => {
      vscode.env.openExternal(vscode.Uri.parse(getSignupUrl()));
    })
  );

  // Open docs
  context.subscriptions.push(
    vscode.commands.registerCommand('rampify.openDocs', () => {
      vscode.env.openExternal(vscode.Uri.parse(`${getWebUrl()}/docs/integrations/vscode-extension`));
    })
  );

  // Opened a folder from the Home panel's "Open Your Project Folder": the
  // window reloaded, so pick the sign-in back up.
  const pending = context.globalState.get<{ at: number; withCode?: boolean }>(PENDING_SIGN_IN_KEY);
  if (pending) {
    await context.globalState.update(PENDING_SIGN_IN_KEY, undefined);
    const fresh = Date.now() - pending.at < PENDING_SIGN_IN_TTL_MS;
    if (fresh && vscode.workspace.workspaceFolders?.length && !getProjectConfig()?.clientId) {
      setTimeout(() => { void signInWithRampify({ withCode: pending.withCode }); }, 1000);
    }
  }

  // Set initial onboarding context keys
  updateOnboardingContext();
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => setupState.refresh({ background: true })));
  setupState.refresh({ background: true });

  // A browser sign-in this folder started before the window reloaded can
  // still finish (spec 78417623).
  const resumeRun = ++signInRun;
  oauth.resume()
    .then((result) => result && finishSignIn(result))
    .catch((err) => reportSignInFailure(err))
    .finally(() => { if (resumeRun === signInRun) { setupState.setSignInPhase('idle'); } });
}

export function deactivate() {
  console.log('Rampify extension is now deactivated');
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/** Update VS Code context keys that control which Welcome View is shown. */
function updateOnboardingContext(): void {
  const hasApiKey = session.isSignedIn;
  const hasProject = !!(getProjectConfig()?.clientId);
  vscode.commands.executeCommand('setContext', 'rampify.hasApiKey', hasApiKey);
  vscode.commands.executeCommand('setContext', 'rampify.hasProject', hasProject);
}

function createApiClient(): RampifyApiClient {
  const config = vscode.workspace.getConfiguration('rampify');
  const apiKey = session.apiKey;
  const environment = config.get<Environment>('environment') || 'production';
  const localApiUrl = config.get<string>('localApiUrl') || 'http://localhost:3000';

  return new RampifyApiClient({
    apiKey,
    environment,
    localApiUrl
  });
}

function getEnvironment(): Environment {
  return vscode.workspace.getConfiguration('rampify').get<Environment>('environment') || 'production';
}

function getWebUrl(): string {
  const config = vscode.workspace.getConfiguration('rampify');

  switch (getEnvironment()) {
    case 'production':
      return 'https://www.rampify.dev';
    case 'staging':
      return 'https://www.rampify.dev'; // No staging, fallback to production
    case 'local':
      return config.get<string>('localApiUrl') || 'http://localhost:3000';
  }
}

/**
 * Product signup (/free — /signup is the On-Rampify coaching application).
 * rid=AhID is the "Partner / Vscode-extension" campaign's tracked link to /free;
 * the UTMs mirror that campaign's source/medium so the visit isn't Direct
 * (editor-launched browsers send no referrer), and utm_content splits editors.
 */
function getSignupUrl(): string {
  const url = new URL('/free', getWebUrl());
  url.searchParams.set('rid', 'AhID');
  url.searchParams.set('utm_source', 'vscode-extension');
  url.searchParams.set('utm_medium', 'sidebar');
  url.searchParams.set('utm_content', getEditorSlug());
  return url.toString();
}

/** Lowercase slug of the host editor ("vscode", "cursor", "windsurf", ...). */
function getEditorSlug(): string {
  const appName = vscode.env.appName.toLowerCase();
  if (appName.includes('visual studio code')) { return 'vscode'; }
  return appName.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
}

/**
 * Sign in with Rampify in the browser (OAuth). The consent screen picks or
 * creates the project; this folder is then linked to it and the project's
 * token stored in SecretStorage. Also handles new users: the browser offers
 * sign-up and comes back here.
 */
async function signInWithRampify(opts: { withCode?: boolean } = {}): Promise<void> {
  if ((vscode.workspace.workspaceFolders?.length ?? 0) === 0) {
    // Each folder links to one project: open it first, then sign-in resumes.
    await openProjectFolder({ thenSignIn: true, withCode: opts.withCode });
    return;
  }

  // A second click while the browser step is open reopens that page instead
  // of starting another sign-in (which would leave one of them waiting).
  if (!opts.withCode && oauth.inProgress) {
    oauth.reopenBrowser();
    return;
  }

  const run = ++signInRun;
  try {
    const result = opts.withCode ? await oauth.signInWithCode(getWebUrl()) : await oauth.signIn(getWebUrl());
    await finishSignIn(result);
  } catch (err) {
    reportSignInFailure(err, opts);
  } finally {
    // A sign-in started meanwhile (a code sign-in replacing this one) owns the panel now.
    if (run === signInRun) { setupState.setSignInPhase('idle'); }
  }
}

/** Counts sign-ins, so only the latest one clears the panel's progress. */
let signInRun = 0;

function reportSignInFailure(err: unknown, opts: { withCode?: boolean } = {}): void {
  if (err instanceof SignInCancelled) { return; }
  // Usually the browser step was abandoned or timed out; offer the retry
  // (quick if they're now signed in on the web) and the code flow.
  vscode.window.showErrorMessage(
    `Rampify sign-in didn't finish: ${err instanceof Error ? err.message : String(err)}`,
    'Try Again',
    'Sign In with a Code'
  ).then((action) => {
    if (action === 'Try Again') { signInWithRampify(opts); }
    if (action === 'Sign In with a Code') { signInWithRampify({ withCode: true }); }
  });
}

/** Link this folder to the project the sign-in chose (a browser, code, or resumed sign-in). */
async function finishSignIn(result: SignInResult): Promise<void> {
  // The token can see only the chosen project; find its workspace to link.
  const scoped = new RampifyApiClient({
    apiKey: result.accessToken,
    environment: getEnvironment(),
    localApiUrl: vscode.workspace.getConfiguration('rampify').get<string>('localApiUrl') || 'http://localhost:3000',
  });
  let workspace: Client | undefined;
  try {
    const clients = await scoped.getClients();
    workspace = clients.find(c => primaryProject(c)?.id === result.projectId) ?? clients[0];
  } catch {
    // The interceptor already reported the request failure.
  }
  if (!workspace) {
    vscode.window.showErrorMessage("Signed in, but Rampify didn't return the project. Try signing in again.");
    return;
  }

  await session.storeProjectToken(workspace.id, result.accessToken);
  await saveProjectConfig({ clientId: workspace.id, domain: primaryProject(workspace)?.domain ?? '' });
  // The folder's AI-tool configs follow the folder's project.
  syncPinnedConfigs(getMcpUrl(), workspace.id);
  copilotMcp.refresh();
  await session.setProject(workspace.id);
  updateOnboardingContext();
  featureSpecsProvider.refresh();
  // A newly linked project starts on its checklist (or its specs, if it has some).
  await setupState.showView(null);
  // Fresh: a load the session change started may predate the folder's link.
  await setupState.refresh({ fresh: true });
  vscode.commands.executeCommand(setupState.currentView === 'specs' ? 'rampify.featureSpecs.focus' : 'rampify.home.focus');
  vscode.window.showInformationMessage(`Signed in to Rampify. This folder is linked to "${projectDisplayName(workspace)}".`);
}

async function setApiKey(): Promise<void> {
  const apiKey = await vscode.window.showInputBox({
    prompt: 'Enter your Rampify API key',
    password: true,
    placeHolder: 'sk_live_...',
    validateInput: (value) => {
      if (!value) {
        return 'API key is required';
      }
      if (!value.startsWith('sk_')) {
        return 'API key should start with "sk_"';
      }
      return null;
    }
  });

  if (apiKey) {
    await session.storeAccountKey(apiKey);
    updateOnboardingContext();

    const check = await createApiClient().validateApiKey();
    if (check === 'valid') {
      vscode.window.showInformationMessage('Rampify API key saved and verified.');
    } else if (check === 'invalid') {
      vscode.window.showErrorMessage(
        'Rampify rejected this API key. Check that you copied the whole key, or create a new one.',
        'Create API Key'
      ).then(action => {
        if (action === 'Create API Key') {
          vscode.env.openExternal(vscode.Uri.parse(`${getWebUrl()}/settings/api-keys`));
        }
      });
    } else {
      vscode.window.showWarningMessage(
        "API key saved, but Rampify couldn't be reached to verify it. Check your connection and try again."
      );
    }
  }
}

async function switchEnvironment(): Promise<void> {
  const environment = await vscode.window.showQuickPick(
    [
      { label: 'Production', value: 'production' },
      { label: 'Staging', value: 'staging' },
      { label: 'Local Development', value: 'local' }
    ],
    {
      placeHolder: 'Select environment'
    }
  );

  if (environment) {
    const config = vscode.workspace.getConfiguration('rampify');
    await config.update('environment', environment.value, vscode.ConfigurationTarget.Global);

    if (environment.value === 'local') {
      const localUrl = await vscode.window.showInputBox({
        prompt: 'Enter local API URL',
        value: config.get<string>('localApiUrl') || 'http://localhost:3000',
        placeHolder: 'http://localhost:3000'
      });

      if (localUrl) {
        await config.update('localApiUrl', localUrl, vscode.ConfigurationTarget.Global);
      }
    }

    vscode.window.showInformationMessage(`Switched to ${environment.label} environment`);
  }
}

async function setupProjectLink(): Promise<void> {
  // Require an open folder — config is workspace-scoped to avoid cross-project contamination
  if ((vscode.workspace.workspaceFolders?.length ?? 0) === 0) {
    vscode.window.showErrorMessage(
      'Open a folder in VS Code first, then link your Rampify project.',
      'Open Folder'
    ).then(result => {
      if (result === 'Open Folder') {
        vscode.commands.executeCommand('vscode.openFolder');
      }
    });
    return;
  }

  // Signed out, or signed in only through a project token (which can see just
  // that one project): signing in is how you pick or create a project.
  if (!session.isSignedIn || session.hasProjectToken) {
    await signInWithRampify();
    return;
  }

  // Auto-detect domain
  const detectedDomain = await detectProjectDomain();

  // Ask user what they want to do
  const action = await vscode.window.showQuickPick(
    [
      { label: 'Select Existing Project', value: 'select' },
      { label: 'Create New Project', value: 'create' }
    ],
    {
      placeHolder: detectedDomain
        ? `Detected domain: ${detectedDomain}. Select or create a project?`
        : 'Select or create a project?'
    }
  );

  if (!action) {
    return;
  }

  let selectedClient: Client | undefined;
  let createdNew = false;

  if (action.value === 'select') {
    // Fetch projects
    const clients = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Loading projects...',
        cancellable: false
      },
      async () => {
        return await apiClient.getClients();
      }
    );

    if (clients.length === 0) {
      vscode.window.showInformationMessage('No projects found. Create a new one?', 'Create').then(result => {
        if (result === 'Create') {
          vscode.commands.executeCommand('rampify.setupProject');
        }
      });
      return;
    }

    // Show project picker (sorted alphabetically)
    const items = clients.map(client => {
      const project = primaryProject(client);
      return {
        label: projectDisplayName(client),
        description: project?.domain || undefined,
        client
      };
    });
    const selectedItem = await vscode.window.showQuickPick(
      items.sort((a, b) => a.label.localeCompare(b.label)),
      {
        placeHolder: 'Select a project',
        matchOnDescription: true,
        matchOnDetail: true
      }
    );

    selectedClient = selectedItem?.client;
  } else {
    // Check the plan's project allowance before asking for a name, so a
    // founder at the limit gets the upgrade prompt instead of a dead end.
    const quota = await apiClient.getProjectQuota();
    if (quota && quota.allowed === false) {
      await showCannotCreateProject(quota);
      return;
    }

    // Name only, like the dashboard's New Project modal; the setup wizard
    // collects the domain and project type next.
    const projectName = await vscode.window.showInputBox({
      prompt: 'Name your project',
      placeHolder: 'e.g. Acme marketing site',
      validateInput: (value) => value.trim() ? null : 'Project name is required'
    });

    if (!projectName) {
      return;
    }

    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Creating project...',
        cancellable: false
      },
      async () => apiClient.createClient({ projectName: projectName.trim() })
    );

    if (!result.ok) {
      if (result.reason === 'limit') {
        await showCannotCreateProject(result.quota, result.message);
      } else if (result.reason === 'scoped_key') {
        await showCannotCreateProject({ reason: 'scoped_key' });
      } else {
        vscode.window.showErrorMessage(`Rampify: ${result.message}`);
      }
      return;
    }

    selectedClient = result.client;
    createdNew = true;
  }

  if (selectedClient) {
    // Save to workspace settings — requires a folder to be open
    try {
      await saveProjectConfig({
        clientId: selectedClient.id,
        domain: primaryProject(selectedClient)?.domain ?? ''
      });
      syncPinnedConfigs(getMcpUrl(), selectedClient.id);
      copilotMcp.refresh();
      updateOnboardingContext();
    } catch (err) {
      vscode.window.showErrorMessage(
        err instanceof Error ? err.message : 'Failed to save project config.'
      );
      return;
    }

    featureSpecsProvider.refresh();

    if (createdNew) {
      // New projects finish in the dashboard's setup wizard (project type,
      // starting point, domain), same as projects created there.
      const setupUrl = `${getWebUrl()}/clients/${selectedClient.id}/setup`;
      vscode.env.openExternal(vscode.Uri.parse(setupUrl));
      vscode.window.showInformationMessage(
        `Created and linked "${projectDisplayName(selectedClient)}". Finish setup in your browser.`,
        'Reopen Setup'
      ).then(result => {
        if (result === 'Reopen Setup') {
          vscode.env.openExternal(vscode.Uri.parse(setupUrl));
        }
      });
      return;
    }

    vscode.window.showInformationMessage(
      `Linked to project: ${projectDisplayName(selectedClient)}`,
      'View Feature Specs'
    ).then(result => {
      if (result === 'View Feature Specs') {
        vscode.commands.executeCommand('rampify.featureSpecs.focus');
      }
    });
  }
}

/**
 * Explain why a project can't be created and offer the way forward. At the
 * plan limit the server names the next plan (Free → Starter checkout, Starter
 * → Pro request); without it, the dashboard's Add Project button shows the
 * same upgrade dialog.
 */
async function showCannotCreateProject(quota: ProjectQuota, serverMessage?: string): Promise<void> {
  if (quota.reason === 'scoped_key') {
    const action = await vscode.window.showWarningMessage(
      "This API key is limited to one project, so it can't create new ones. Create the project in the dashboard, or connect with an account API key.",
      'Open Dashboard'
    );
    if (action === 'Open Dashboard') {
      vscode.env.openExternal(vscode.Uri.parse(`${getWebUrl()}/dashboard`));
    }
    return;
  }
  if (quota.reason === 'viewer') {
    vscode.window.showWarningMessage(
      'Your account has view access only, so it can\u2019t create projects. Ask the workspace owner, or link one of your existing projects.'
    );
    return;
  }

  const plan = quota.tier_label ? `the ${quota.tier_label} plan` : 'your plan';
  const usage = typeof quota.limit === 'number' && typeof quota.current === 'number'
    ? `You've used ${quota.current} of ${quota.limit} project${quota.limit === 1 ? '' : 's'} on ${plan}.`
    : serverMessage || quota.message || "You've reached your plan's project limit.";

  // Top tier (or an older server that doesn't say): no upgrade to offer.
  const upgradeLabel = quota.upgrade?.label
    ?? (quota.upgrade === null ? undefined : 'See Upgrade Options');
  const nextStep = upgradeLabel
    ? 'Upgrade to add another, or link one of your existing projects.'
    : 'Email info@rampify.dev if you need more, or link one of your existing projects.';

  const actions = [upgradeLabel, 'Link Existing Project'].filter((a): a is string => !!a);
  const action = await vscode.window.showWarningMessage(`${usage} ${nextStep}`, ...actions);
  if (action && action === upgradeLabel) {
    const target = quota.upgrade?.url || '/dashboard';
    const url = /^https?:\/\//.test(target) ? target : `${getWebUrl()}${target}`;
    vscode.env.openExternal(vscode.Uri.parse(url));
  } else if (action === 'Link Existing Project') {
    vscode.commands.executeCommand('rampify.setupProject');
  }
}

/**
 * Guide the user through installing the Rampify MCP server for their AI agent.
 *
 * Default installs use OAuth: the config holds only the server URL, and the
 * agent signs in (and picks a project) on first connect, so nothing secret is
 * written to disk. Same shapes as the dashboard's install buttons
 * (lib/mcp-install/generators.ts). The server name stays lowercase "rampify"
 * to match `rampify init` and the rules file's mcp__rampify__* tool names, and
 * so re-running the wizard replaces an older entry instead of duplicating it.
 */
const TOOL_PICK: Record<AiTool, { label: string; description: () => string }> = {
  copilot: {
    label: '$(copilot) GitHub Copilot (VS Code)',
    description: () => copilotMcp.available ? 'Connect directly, sign in on first use' : 'Add to .vscode/mcp.json, sign in on first use',
  },
  cursor: { label: '$(file-code) Cursor', description: () => 'Add to .cursor/mcp.json, sign in on first use' },
  claude: { label: '$(terminal) Claude Code', description: () => 'Add to .mcp.json, then /mcp in Claude Code to sign in' },
};

/** "Set Up MCP" (⋯ menu / palette): pick a tool, connect it to this folder's project. */
async function installMcpServer(): Promise<void> {
  type Opt = vscode.QuickPickItem & { value: AiTool | 'copy' | 'copy-api-key' };
  const first = defaultAiTool();
  const tools = (['copilot', 'cursor', 'claude'] as AiTool[])
    .sort((a, b) => (a === first ? -1 : b === first ? 1 : 0))
    .map((t): Opt => ({ label: TOOL_PICK[t].label, description: TOOL_PICK[t].description(), value: t }));
  const choice = await vscode.window.showQuickPick<Opt>([
    ...tools,
    { label: '$(copy) Copy Config JSON', description: 'For any other MCP client that supports OAuth', value: 'copy' },
    { label: '$(key) Copy Config JSON with API Key', description: 'For CI and headless agents that can\u2019t sign in. Keep it out of git.', value: 'copy-api-key' },
  ], { placeHolder: 'Which AI tool do you use?' });
  if (!choice) { return; }

  if (choice.value === 'copy') {
    const pin = getProjectConfig()?.clientId;
    const entry = { type: 'http', url: getMcpUrl(), ...(pin ? { headers: { [PIN_HEADER]: pin } } : {}) };
    await vscode.env.clipboard.writeText(JSON.stringify({ mcpServers: { [SERVER_NAME]: entry } }, null, 2));
    vscode.window.showInformationMessage('MCP server config copied to clipboard.');
    await setupState.markMcpSetupDone();
  } else if (choice.value === 'copy-api-key') {
    if (await copyApiKeyConfig(getMcpUrl())) { await setupState.markMcpSetupDone(); }
  } else {
    await connectAiTool(choice.value);
  }
}

/**
 * Connect an AI tool to Rampify, pinned to this folder's project: Copilot via
 * VS Code's provider API (or .vscode/mcp.json), Cursor via .cursor/mcp.json,
 * Claude Code via .mcp.json. Each signs in to Rampify on first use.
 */
/** Connect an AI tool to this folder's project. `quiet`: the panel shows the next steps itself. */
async function connectAiTool(tool: AiTool, opts: { quiet?: boolean } = {}): Promise<void> {
  if (!vscode.workspace.workspaceFolders?.length) {
    await openProjectFolder({});
    return;
  }
  const pin = getProjectConfig()?.clientId;
  if (!pin) {
    const action = await vscode.window.showInformationMessage('Sign in and link this folder to a Rampify project first.', 'Sign In');
    if (action === 'Sign In') { await signInWithRampify(); }
    return;
  }

  try {
    if (tool === 'copilot' && copilotMcp.available) {
      await copilotMcp.enable();
      // Start it, so VS Code asks to sign in now rather than never.
      copilotMcp.start(extContext.extension.id);
      if (!opts.quiet) {
        vscode.window.showInformationMessage(
          'Rampify is connected to Copilot for this folder. In Copilot Chat (Agent mode), VS Code asks you to sign in to Rampify the first time.',
          'Open Copilot Chat'
        ).then((action) => {
          if (action) { vscode.commands.executeCommand('workbench.action.chat.open', { mode: 'agent' }); }
        });
      }
    } else {
      const file = writePinnedConfig(tool, getMcpUrl(), pin);
      if (tool === 'claude') {
        await scaffoldClaudeRulesFile();
        if (!opts.quiet) {
          vscode.window.showInformationMessage(
            `Rampify added to ${file}. Open Claude Code in this folder and type /mcp to sign in.`,
            'Open Claude Code'
          ).then((action) => {
            if (!action) { return; }
            const terminal = vscode.window.createTerminal({ name: 'Claude Code', cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath });
            terminal.show();
            terminal.sendText('claude', true);
          });
        }
      } else if (!opts.quiet) {
        vscode.window.showInformationMessage(tool === 'cursor'
          ? `Rampify added to ${file}. Cursor asks to enable it; then sign in to Rampify when prompted.`
          : `Rampify added to ${file}. Start it from the MCP view and sign in when VS Code asks.`);
      }
    }
    await rememberAiTool(extContext.workspaceState, tool, pin);
    await setupState.markMcpSetupDone();
  } catch (err) {
    vscode.window.showErrorMessage(`Couldn't connect ${AI_TOOL_LABELS[tool]}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

interface OpenFolderOptions {
  /** "Start a New Project": pick or create an empty folder. */
  newProject?: boolean;
  /** Continue to sign-in after the window reloads with the folder. */
  thenSignIn?: boolean;
  withCode?: boolean;
}

/** Open (or create) the project folder; optionally resume sign-in after the reload. */
async function openProjectFolder(opts: OpenFolderOptions): Promise<void> {
  const picked = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    openLabel: opts.newProject ? 'Use This Folder' : 'Open Folder',
    title: opts.newProject ? 'Choose or create an empty folder for your new project' : 'Open your project folder',
  });
  if (!picked?.[0]) { return; }
  if (opts.thenSignIn) {
    await extContext.globalState.update(PENDING_SIGN_IN_KEY, { at: Date.now(), withCode: opts.withCode });
  }
  await vscode.commands.executeCommand('vscode.openFolder', picked[0]);
}

/** Rename the linked project in Rampify (synced everywhere). */
async function renameProject(): Promise<void> {
  const s = setupState.current;
  if (!s.siteId) {
    vscode.window.showInformationMessage('Link this folder to a Rampify project first.');
    return;
  }
  const name = await vscode.window.showInputBox({
    prompt: 'Rename your Rampify project',
    value: s.project?.name ?? s.projectName ?? '',
    validateInput: (v) => (!v.trim() ? 'Give it a name' : v.length > 100 ? 'Keep it under 100 characters' : null),
  });
  if (!name) { return; }
  const result = await apiClient.updateProject(s.siteId, { name: name.trim() });
  if (!result.ok) {
    vscode.window.showErrorMessage(`Couldn't rename the project: ${result.message}`);
    return;
  }
  await setupState.refresh();
  featureSpecsProvider.refresh();
  vscode.window.showInformationMessage(`Renamed to "${name.trim()}".`);
}

/**
 * "Start your first spec": Rampify creates the getting-started spec (fixed
 * template, instantly), then the user's AI tool is handed the prompt to work
 * through it. When the AI writes `.rampify/project-map.md`, it opens.
 */
async function startFirstSpec(buildingFirst?: string): Promise<void> {
  const siteId = setupState.current.siteId;
  if (!siteId) { return; }
  const res = await apiClient.startGettingStarted(siteId, buildingFirst);
  if (!res) {
    vscode.window.showErrorMessage('Couldn\u2019t create your first spec. Check your connection and try again.');
    return;
  }
  await setupState.refresh();
  watchProjectMap();
  await sendToAiTool(chosenAiTool(extContext.workspaceState), res.prompt);
}

/** After the getting-started spec: hand the user's own new spec to their AI. */
async function startBuilding(spec: { id: string; title: string }): Promise<void> {
  const prompt = `Start building the Rampify spec "${spec.title}" (id ${spec.id}). Read it with get_feature_spec, work through its tasks, commit as you go, and link each commit to the spec with link_commit.`;
  await sendToAiTool(chosenAiTool(extContext.workspaceState), prompt);
  await setupState.showView('specs');
  featureSpecsProvider.refresh();
  await vscode.commands.executeCommand('rampify.featureSpecs.focus');
}

/** Open `.rampify/project-map.md` the first time the AI writes it (once). */
function watchProjectMap(): void {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) { return; }
  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, '.rampify/project-map.md'));
  const stop = setTimeout(() => watcher.dispose(), 30 * 60 * 1000);
  const open = (uri: vscode.Uri) => {
    clearTimeout(stop);
    watcher.dispose();
    vscode.workspace.openTextDocument(uri).then((doc) => vscode.window.showTextDocument(doc, { preview: true, preserveFocus: true }));
  };
  watcher.onDidCreate(open);
  watcher.onDidChange(open);
  extContext.subscriptions.push(watcher);
}


function getMcpUrl(): string {
  return `${getWebUrl()}/api/mcp`;
}

/**
 * Headless path: a config block with the API key in an Authorization header.
 * Clipboard only, never written into the workspace, since it's a secret.
 */
async function copyApiKeyConfig(mcpUrl: string): Promise<boolean> {
  const apiKey = session.apiKey;
  if (!apiKey) {
    const action = await vscode.window.showErrorMessage(
      'Set your Rampify API key first.',
      'Set API Key'
    );
    if (action === 'Set API Key') { await setApiKey(); }
    return false;
  }

  // Account keys can reach every project, so pin the linked one. Project-scoped
  // keys ignore this header (the key's own project wins).
  const projectId = getProjectConfig()?.clientId;
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${apiKey}`,
    ...(projectId ? { 'X-Rampify-Project': projectId } : {}),
  };
  const config = { mcpServers: { [SERVER_NAME]: { type: 'http', url: mcpUrl, headers } } };
  await vscode.env.clipboard.writeText(JSON.stringify(config, null, 2));
  vscode.window.showWarningMessage(
    'Config with your API key copied. It’s a secret: don’t commit it, and prefer a project-scoped key (project Settings → API keys).'
  );
  return true;
}

/**
 * Scaffold .claude/rules/rampify.md for Claude Code. The text is the same
 * template `rampify init` installs (bundled at build time), so the two never
 * drift. Never overwrites an existing file.
 */
async function scaffoldClaudeRulesFile(): Promise<void> {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) { return; }

  const rulesDir = path.join(workspaceFolder.uri.fsPath, '.claude', 'rules');
  const rulesFile = path.join(rulesDir, 'rampify.md');
  if (fs.existsSync(rulesFile)) { return; }

  fs.mkdirSync(rulesDir, { recursive: true });
  fs.writeFileSync(rulesFile, rulesTemplate);

  vscode.window.showInformationMessage(
    'Added .claude/rules/rampify.md. Reference it from CLAUDE.md so Claude Code follows the spec workflow.',
    'Open File'
  ).then(action => {
    if (action === 'Open File') {
      vscode.workspace.openTextDocument(rulesFile).then(doc => vscode.window.showTextDocument(doc));
    }
  });
}
