import * as vscode from 'vscode';
import { RampifyApiClient, Environment } from './api/client';
import { FeatureSpecsTreeProvider } from './providers/feature-specs-tree-provider';
import {
  getProjectConfig,
  saveProjectConfig,
  detectProjectDomain,
} from './utils/project-config';
import { Client, FeatureSpec } from './api/types';

let apiClient: RampifyApiClient;
let featureSpecsProvider: FeatureSpecsTreeProvider;

export function activate(context: vscode.ExtensionContext) {
  console.log('Rampify extension is now active');

  // Initialize API client
  apiClient = createApiClient();

  // Initialize tree view provider
  featureSpecsProvider = new FeatureSpecsTreeProvider(apiClient, getWebUrl, context);
  const featureSpecsView = vscode.window.createTreeView('rampify.featureSpecs', {
    treeDataProvider: featureSpecsProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(featureSpecsView);

  // Poll for new specs while the panel is visible (covers MCP tool creating specs in the same window)
  const POLL_INTERVAL_MS = 30_000;
  let pollTimer: ReturnType<typeof setInterval> | undefined;

  const startPolling = () => {
    if (pollTimer) { return; }
    pollTimer = setInterval(() => {
      if (featureSpecsProvider.isStale()) {
        featureSpecsProvider.refresh();
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
          featureSpecsProvider.refresh();
        }
        startPolling();
      } else {
        stopPolling();
      }
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
    vscode.commands.registerCommand('rampify.refreshFeatureSpecs', () => {
      featureSpecsProvider.refresh();
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
        const url = `${wUrl}/clients/${cId}/features/${spec.id}`;
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
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('rampify')) {
        // Recreate API client with new config
        apiClient = createApiClient();
        featureSpecsProvider.refresh();
      }
    })
  );

  // Auto-setup if not configured
  const projectConfig = getProjectConfig();
  const config = vscode.workspace.getConfiguration('rampify');
  const apiKey = config.get<string>('apiKey');

  if (!apiKey) {
    vscode.window.showInformationMessage(
      'Rampify: Set up your API key to get started',
      'Set API Key'
    ).then(selection => {
      if (selection === 'Set API Key') {
        vscode.commands.executeCommand('rampify.setApiKey');
      }
    });
  } else if (!projectConfig) {
    vscode.window.showInformationMessage(
      'Rampify: Link this project to a client',
      'Setup Project Link'
    ).then(selection => {
      if (selection === 'Setup Project Link') {
        vscode.commands.executeCommand('rampify.setupProject');
      }
    });
  }
}

export function deactivate() {
  console.log('Rampify extension is now deactivated');
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function createApiClient(): RampifyApiClient {
  const config = vscode.workspace.getConfiguration('rampify');
  const apiKey = config.get<string>('apiKey') || '';
  const environment = config.get<Environment>('environment') || 'production';
  const localApiUrl = config.get<string>('localApiUrl') || 'http://localhost:3000';

  return new RampifyApiClient({
    apiKey,
    environment,
    localApiUrl
  });
}

function getWebUrl(): string {
  const config = vscode.workspace.getConfiguration('rampify');
  const environment = config.get<Environment>('environment') || 'production';

  switch (environment) {
    case 'production':
      return 'https://www.rampify.dev';
    case 'staging':
      return 'https://www.rampify.dev'; // No staging, fallback to production
    case 'local':
      return config.get<string>('localApiUrl') || 'http://localhost:3000';
  }
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
    const config = vscode.workspace.getConfiguration('rampify');
    await config.update('apiKey', apiKey, vscode.ConfigurationTarget.Global);

    // Test connection
    const testClient = createApiClient();
    const isConnected = await testClient.testConnection();

    if (isConnected) {
      vscode.window.showInformationMessage('Rampify API key saved successfully');
    } else {
      vscode.window.showErrorMessage('Failed to connect to Rampify API. Please check your API key.');
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

  // Check if API key is set
  const config = vscode.workspace.getConfiguration('rampify');
  const apiKey = config.get<string>('apiKey');

  if (!apiKey) {
    const result = await vscode.window.showErrorMessage(
      'Rampify API key not set',
      'Set API Key'
    );
    if (result === 'Set API Key') {
      await setApiKey();
    }
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
    const selectedItem = await vscode.window.showQuickPick(
      clients
        .sort((a, b) => a.company_name.localeCompare(b.company_name))
        .map(client => ({
          label: client.company_name,
          description: client.domain || undefined,
          detail: client.status === 'active' ? '✓ Active' : client.status,
          client
        })),
      {
        placeHolder: 'Select a project',
        matchOnDescription: true,
        matchOnDetail: true
      }
    );

    selectedClient = selectedItem?.client;
  } else {
    // Create new project
    const projectName = await vscode.window.showInputBox({
      prompt: 'Enter project name',
      placeHolder: 'My Awesome App',
      validateInput: (value) => value ? null : 'Project name is required'
    });

    if (!projectName) {
      return;
    }

    // Domain is optional — pre-fill with auto-detected value if available
    const domain = await vscode.window.showInputBox({
      prompt: 'Enter domain (optional — required for SEO tracking)',
      value: detectedDomain || '',
      placeHolder: 'example.com'
    });

    // Create project
    selectedClient = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Creating project...',
        cancellable: false
      },
      async () => {
        return await apiClient.createClient({
          companyName: projectName,
          domain: domain || undefined
        });
      }
    );

    vscode.window.showInformationMessage(`Created project: ${projectName}`);
  }

  if (selectedClient) {
    // Save to workspace settings — requires a folder to be open
    try {
      await saveProjectConfig({
        clientId: selectedClient.id,
        domain: selectedClient.domain
      });
    } catch (err) {
      vscode.window.showErrorMessage(
        err instanceof Error ? err.message : 'Failed to save project config.'
      );
      return;
    }

    vscode.window.showInformationMessage(
      `Linked to project: ${selectedClient.company_name}`,
      'View Feature Specs'
    ).then(result => {
      if (result === 'View Feature Specs') {
        featureSpecsProvider.refresh();
        vscode.commands.executeCommand('rampify.featureSpecs.focus');
      }
    });
  }
}

/**
 * Guide the user through installing the Rampify MCP server for their AI agent.
 */
async function installMcpServer(): Promise<void> {
  const config = vscode.workspace.getConfiguration('rampify');
  const apiKey = config.get<string>('apiKey') || '';

  // Detect the current editor so we can surface the most relevant option first
  const appName = vscode.env.appName.toLowerCase();
  const isCursor = appName.includes('cursor');
  const isVSCode = appName.includes('visual studio code');

  type McpOption = { label: string; description: string; value: string };
  const allOptions: McpOption[] = [
    {
      label: '$(file-code) VS Code (GitHub Copilot)',
      description: 'Write MCP config to .vscode/mcp.json — requires VS Code ≥ 1.99 + Copilot',
      value: 'vscode',
    },
    {
      label: '$(file-code) Cursor',
      description: 'Write MCP config to .cursor/mcp.json in this project',
      value: 'cursor',
    },
    {
      label: '$(terminal) Claude Code',
      description: 'Pre-fill the claude mcp add command in a terminal',
      value: 'claude-code',
    },
    {
      label: '$(copy) Copy Config JSON',
      description: 'Copy the MCP server config block to clipboard',
      value: 'copy',
    },
  ];

  // Bubble the detected editor to the top so it's the default
  const sorted = isVSCode
    ? allOptions
    : isCursor
      ? [allOptions[1], allOptions[0], allOptions[2], allOptions[3]]
      : [allOptions[2], allOptions[0], allOptions[1], allOptions[3]];

  const choice = await vscode.window.showQuickPick(sorted, {
    placeHolder: 'Which AI agent are you using?',
  });

  if (!choice) { return; }

  // Try to get project ID from workspace config; prompt if not found
  let projectId = getProjectConfig()?.clientId || '';
  if (!projectId) {
    const entered = await vscode.window.showInputBox({
      prompt: 'Enter your Rampify Project ID (Client ID from the dashboard URL)',
      placeHolder: 'e.g. 5ac5b257-c5a7-4bf8-8471-76d821cddd5d',
      validateInput: v => (v && v.trim().length > 0) ? null : 'Project ID is required for create_feature_spec to work',
    });
    projectId = entered?.trim() || '';
  }

  const envArg = (apiKey ? ` --env "RAMPIFY_API_KEY=${apiKey}"` : '') +
    (projectId ? ` --env "RAMPIFY_PROJECT_ID=${projectId}"` : '');
  const serverEntry = {
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@rampify/mcp-server@latest'],
    env: {
      RAMPIFY_API_KEY: apiKey || 'your-api-key',
      ...(projectId ? { RAMPIFY_PROJECT_ID: projectId } : {}),
    },
  };

  if (choice.value === 'vscode') {
    await installMcpForVSCode(serverEntry);
  } else if (choice.value === 'cursor') {
    await installMcpForCursor(serverEntry);
  } else if (choice.value === 'claude-code') {
    const cmd = `claude mcp add rampify${envArg} -- npx -y @rampify/mcp-server@latest`;
    const terminal = vscode.window.createTerminal('Rampify MCP Setup');
    terminal.show();
    // sendText with false = type but don't execute, letting the user review first
    terminal.sendText(cmd, false);
    vscode.window.showInformationMessage(
      'Command ready — press Enter in the terminal to install.',
      'View Docs'
    ).then(action => {
      if (action === 'View Docs') {
        vscode.env.openExternal(vscode.Uri.parse('https://github.com/rampify-dev/rampify-mcp#readme'));
      }
    });
  } else {
    const copyConfig = { mcpServers: { rampify: serverEntry } };
    await vscode.env.clipboard.writeText(JSON.stringify(copyConfig, null, 2));
    vscode.window.showInformationMessage('MCP server config copied to clipboard!');
  }

  // Scaffold .claude/rules/rampify.md for Claude Code workflow guidance
  await scaffoldClaudeRulesFile();
}

/** Scaffold .claude/rules/rampify.md in the workspace for Claude Code workflow guidance. */
async function scaffoldClaudeRulesFile(): Promise<void> {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) { return; }

  const rulesDir = path.join(workspaceFolder.uri.fsPath, '.claude', 'rules');
  const rulesFile = path.join(rulesDir, 'rampify.md');

  // Don't overwrite if file already exists
  if (fs.existsSync(rulesFile)) { return; }

  fs.mkdirSync(rulesDir, { recursive: true });
  fs.writeFileSync(rulesFile, `---
description: Rampify SEO workflow and MCP tool guidance
---

## Rampify SEO Tools

This project uses Rampify MCP tools: \`crawl_site\` · \`get_issues\` · \`get_page_seo\` · \`generate_meta\` · \`generate_schema\` · \`create_feature_spec\` · \`get_feature_spec\`

## Workflow

1. Discuss the SEO task or issue
2. Create a feature spec via \`create_feature_spec\` before implementing
3. Wait for explicit approval before writing any code

Do not skip ahead to implementation or use Plan mode as a substitute for the feature spec.
`);
}

/** Write (or merge) the Rampify MCP entry into .vscode/mcp.json (VS Code ≥ 1.99 + Copilot). */
async function installMcpForVSCode(serverEntry: Record<string, unknown>): Promise<void> {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage(
      'Open a project folder first, then add the VS Code MCP config.',
      'Open Folder'
    ).then(result => {
      if (result === 'Open Folder') { vscode.commands.executeCommand('vscode.openFolder'); }
    });
    return;
  }

  const vscodeDir = path.join(workspaceFolder.uri.fsPath, '.vscode');
  const mcpPath = path.join(vscodeDir, 'mcp.json');

  // VS Code uses "servers" (not "mcpServers")
  let existing: { servers?: Record<string, unknown> } = { servers: {} };
  if (fs.existsSync(mcpPath)) {
    try { existing = JSON.parse(fs.readFileSync(mcpPath, 'utf8')); } catch { /* overwrite */ }
  }

  if (!fs.existsSync(vscodeDir)) { fs.mkdirSync(vscodeDir, { recursive: true }); }

  existing.servers = { ...(existing.servers ?? {}), rampify: serverEntry };
  fs.writeFileSync(mcpPath, JSON.stringify(existing, null, 2), 'utf8');

  const doc = await vscode.workspace.openTextDocument(mcpPath);
  await vscode.window.showTextDocument(doc);

  vscode.window.showInformationMessage(
    'Rampify MCP server added to .vscode/mcp.json — reload the window to activate.',
    'Reload Window'
  ).then(action => {
    if (action === 'Reload Window') { vscode.commands.executeCommand('workbench.action.reloadWindow'); }
  });
}

/** Write (or merge) the Rampify MCP entry into .cursor/mcp.json. */
async function installMcpForCursor(serverEntry: Record<string, unknown>): Promise<void> {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage(
      'Open a project folder first, then add the Cursor MCP config.',
      'Open Folder'
    ).then(result => {
      if (result === 'Open Folder') { vscode.commands.executeCommand('vscode.openFolder'); }
    });
    return;
  }

  const cursorDir = path.join(workspaceFolder.uri.fsPath, '.cursor');
  const mcpPath = path.join(cursorDir, 'mcp.json');

  let existing: { mcpServers?: Record<string, unknown> } = { mcpServers: {} };
  if (fs.existsSync(mcpPath)) {
    try { existing = JSON.parse(fs.readFileSync(mcpPath, 'utf8')); } catch { /* overwrite */ }
  }

  if (!fs.existsSync(cursorDir)) { fs.mkdirSync(cursorDir, { recursive: true }); }

  existing.mcpServers = { ...(existing.mcpServers ?? {}), rampify: serverEntry };
  fs.writeFileSync(mcpPath, JSON.stringify(existing, null, 2), 'utf8');

  const doc = await vscode.workspace.openTextDocument(mcpPath);
  await vscode.window.showTextDocument(doc);

  vscode.window.showInformationMessage('Rampify MCP server added to .cursor/mcp.json — restart Cursor to activate.');
}

