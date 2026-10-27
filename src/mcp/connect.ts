import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Connecting the user's AI tool to Rampify's MCP server, pinned to this
 * folder's project (spec a3f4b733).
 *
 * One folder = one Rampify project = one MCP connection. Every config this
 * writes lives in the folder and carries `X-Rampify-Project: <workspace id>`:
 * the server refuses tool calls when the AI tool signed in to a different
 * project (lib/mcp/project-pin.ts). No secret is written, so the files are
 * safe to commit. Verified 2026-10-21: VS Code, Claude Code and Cursor all
 * send config headers alongside their OAuth token.
 *
 *   copilot  VS Code's MCP server provider API when available (no file),
 *            else .vscode/mcp.json
 *   cursor   .cursor/mcp.json (Cursor's own registerServer API drops headers)
 *   claude   .mcp.json at the folder root (Claude Code's project scope)
 */

import type { AiTool, EditorKind } from '../views/setup-snapshot';
import { COPILOT_SERVER_LABEL, SERVER_NAME } from './prompt-names';
export type { AiTool };

export { SERVER_NAME };
export const PIN_HEADER = 'X-Rampify-Project';
const TOOL_KEY = 'rampify.aiTool';
/**
 * The tool picked in the panel, per project: a folder relinked to another
 * project (or account) starts the AI-tool step from the choice again.
 */
const PICKED_KEY = 'rampify.aiToolPicked';
const COPILOT_KEY = 'rampify.copilotMcp';

export const AI_TOOL_LABELS: Record<AiTool, string> = {
  copilot: 'GitHub Copilot',
  cursor: 'Cursor',
  claude: 'Claude Code',
};

/** The tool to suggest first: the editor we're running in. */
export function defaultAiTool(): AiTool {
  const app = vscode.env.appName.toLowerCase();
  if (app.includes('cursor')) { return 'cursor'; }
  if (app.includes('visual studio code')) { return 'copilot'; }
  return 'claude';
}

export function chosenAiTool(state: vscode.Memento): AiTool {
  return state.get<AiTool>(TOOL_KEY) ?? defaultAiTool();
}

/** The editor we're running in (the AI tools offered first follow it). */
export function editorKind(): EditorKind {
  const tool = defaultAiTool();
  return tool === 'copilot' ? 'vscode' : tool === 'cursor' ? 'cursor' : 'other';
}

/** The tool connected from the panel in this folder, if one was. */
export function pickedAiTool(state: vscode.Memento, clientId: string | null): AiTool | null {
  return clientId ? state.get<AiTool>(`${PICKED_KEY}.${clientId}`) ?? null : null;
}

/** "Use a different tool": back to the choice. */
export async function forgetAiTool(state: vscode.Memento, clientId: string | null): Promise<void> {
  if (clientId) { await state.update(`${PICKED_KEY}.${clientId}`, undefined); }
}

/** VS Code's MCP provider API exists here (VS Code 1.101+, not Cursor's fork of it). */
export function copilotMcpSupported(): boolean {
  return canUseProvider();
}

function canUseProvider(): boolean {
  const lm = (vscode as unknown as { lm?: { registerMcpServerDefinitionProvider?: unknown } }).lm;
  return typeof lm?.registerMcpServerDefinitionProvider === 'function' && defaultAiTool() === 'copilot';
}

function folderPath(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/** The three in-folder config files, by tool. */
const CONFIG_FILES: Record<AiTool, { file: string[]; key: 'servers' | 'mcpServers' }> = {
  copilot: { file: ['.vscode', 'mcp.json'], key: 'servers' },
  cursor: { file: ['.cursor', 'mcp.json'], key: 'mcpServers' },
  claude: { file: ['.mcp.json'], key: 'mcpServers' },
};

/**
 * The project's own MCP address (spec efb05ccf): AI tools keep one sign-in
 * per address, so each project gets its own (one shared address let a sign-in
 * for one project serve every folder). The pin header stays as well.
 */
export function projectMcpUrl(mcpUrl: string, pin: string): string {
  return `${mcpUrl.replace(/\/+$/, '')}/p/${pin}`;
}

function entryFor(tool: AiTool, mcpUrl: string, pin: string): Record<string, unknown> {
  const headers = { [PIN_HEADER]: pin };
  const url = projectMcpUrl(mcpUrl, pin);
  // VS Code and Claude Code want an explicit type; Cursor infers it from url.
  return tool === 'cursor' ? { url, headers } : { type: 'http', url, headers };
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Write (or replace) the single `rampify` entry in the tool's in-folder
 * config, merging with whatever else is there. Throws if the existing file
 * isn't valid JSON (we won't clobber a file we can't read).
 */
export function writePinnedConfig(tool: AiTool, mcpUrl: string, pin: string): string {
  const root = folderPath();
  if (!root) { throw new Error('Open your project folder first.'); }
  const { file, key } = CONFIG_FILES[tool];
  const full = path.join(root, ...file);
  let config: Record<string, unknown> = {};
  if (fs.existsSync(full)) {
    const parsed = readJson(full);
    if (!parsed) { throw new Error(`${file.join('/')} isn't valid JSON. Fix it, then try again.`); }
    config = parsed;
  }
  const servers = (config[key] as Record<string, unknown> | undefined) ?? {};
  servers[SERVER_NAME] = entryFor(tool, mcpUrl, pin);
  config[key] = servers;
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, JSON.stringify(config, null, 2) + '\n');
  return file.join('/');
}

/**
 * Keep existing `rampify` entries pinned to this folder's project (after
 * Switch Project, or configs written before pinning existed). Never creates a
 * file; only rewrites a rampify entry that's already there.
 */
export function syncPinnedConfigs(mcpUrl: string, pin: string): void {
  const root = folderPath();
  if (!root) { return; }
  for (const tool of Object.keys(CONFIG_FILES) as AiTool[]) {
    const { file, key } = CONFIG_FILES[tool];
    const full = path.join(root, ...file);
    const config = fs.existsSync(full) ? readJson(full) : null;
    const servers = config?.[key] as Record<string, Record<string, unknown>> | undefined;
    const existing = servers?.[SERVER_NAME];
    if (!config || !servers || !existing) { continue; }
    const headers = (existing.headers as Record<string, string> | undefined) ?? {};
    if (headers[PIN_HEADER] === pin && existing.url === mcpUrl) { continue; }
    servers[SERVER_NAME] = { ...existing, ...entryFor(tool, mcpUrl, pin), headers: { ...headers, [PIN_HEADER]: pin } };
    try {
      fs.writeFileSync(full, JSON.stringify(config, null, 2) + '\n');
    } catch {
      // Read-only or locked: leave it; the server still refuses mismatches.
    }
  }
}

/**
 * VS Code's id for a server an extension provides: the extension id
 * (lowercased) and the server's label (VS Code's extHostMcp, 1.143).
 */
export function copilotServerId(extensionId: string): string {
  return `${extensionId.toLowerCase()}/${COPILOT_SERVER_LABEL}`;
}

/**
 * Copilot without a config file: Rampify contributes its MCP server through
 * VS Code's provider API once the user connects, pinned to the linked project.
 */
export class CopilotMcpProvider implements vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  private registration: vscode.Disposable | undefined;

  constructor(
    private readonly state: vscode.Memento,
    private readonly getMcpUrl: () => string,
    private readonly getPin: () => string | null,
    /**
     * The extension's own Rampify key (SecretStorage, scoped to this folder's
     * project): Copilot connects with it, so there's no second sign-in in the
     * browser (spec 22941412). Added only when VS Code starts the server.
     */
    private readonly getToken: () => string | undefined = () => undefined
  ) {
    if (!canUseProvider()) { return; }
    const lm = (vscode as unknown as {
      lm: { registerMcpServerDefinitionProvider(id: string, p: unknown): vscode.Disposable };
    }).lm;
    const Def = (vscode as unknown as {
      McpHttpServerDefinition: new (label: string, uri: vscode.Uri, headers?: Record<string, string>) => unknown;
    }).McpHttpServerDefinition;
    this.registration = lm.registerMcpServerDefinitionProvider('rampify', {
      onDidChangeMcpServerDefinitions: this.changed.event,
      provideMcpServerDefinitions: () => {
        const pin = this.getPin();
        if (!this.enabled || !pin) { return []; }
        return [new Def(COPILOT_SERVER_LABEL, vscode.Uri.parse(projectMcpUrl(this.getMcpUrl(), pin)), { [PIN_HEADER]: pin })];
      },
      // When VS Code starts the server: the extension's key, so it isn't in
      // the definition VS Code lists or caches. Without one (signed out),
      // VS Code falls back to its own sign-in, as before.
      resolveMcpServerDefinition: (server: { headers?: Record<string, string> }) => {
        const token = this.getToken();
        if (token) { server.headers = { ...(server.headers ?? {}), Authorization: `Bearer ${token}` }; }
        return server;
      },
    });
  }

  get available(): boolean {
    return !!this.registration;
  }

  get enabled(): boolean {
    return !!this.state.get<boolean>(COPILOT_KEY);
  }

  async enable(): Promise<void> {
    await this.state.update(COPILOT_KEY, true);
    this.changed.fire();
  }

  /**
   * Start the server in VS Code, which is when VS Code asks the user to sign
   * in to Rampify. Defining it isn't enough: VS Code leaves an extension's
   * server stopped until something starts it, so Copilot had no Rampify tools
   * and nothing asked to sign in (2026-10-26). Not awaited past the request:
   * starting waits on the sign-in.
   *
   * VS Code picks up a new definition asynchronously, and starting a server
   * it doesn't know yet does nothing (without an error), so it's tried again
   * a little later; starting one that's running or starting is a no-op. The
   * panel also offers VS Code's own MCP server list as a way out.
   */
  start(extensionId: string): void {
    const id = copilotServerId(extensionId);
    for (const delay of [750, 3000]) {
      setTimeout(() => {
        Promise.resolve(vscode.commands.executeCommand('workbench.mcp.startServer', id, { promptType: 'all-untrusted' }))
          .catch((err) => console.warn('[rampify] could not start the MCP server in VS Code:', err));
      }, delay);
    }
  }

  /** The linked project changed: re-provide with the new pin. */
  refresh(): void {
    this.changed.fire();
  }

  /**
   * The extension's sign-in changed: restart a running server so it connects
   * with the new key now. Otherwise a server started a moment before the
   * sign-in finished keeps going without one, and VS Code asks for its own
   * sign-in in the browser (founder test, 2026-10-26).
   */
  signInChanged(extensionId: string): void {
    this.changed.fire();
    if (!this.enabled || !this.getToken()) { return; }
    // Stop, then start (VS Code's restart command also opens the output panel).
    const id = copilotServerId(extensionId);
    setTimeout(() => {
      Promise.resolve(vscode.commands.executeCommand('workbench.mcp.stopServer', id))
        .then(() => vscode.commands.executeCommand('workbench.mcp.startServer', id, { promptType: 'all-untrusted' }))
        .then(undefined, (err) => console.warn('[rampify] could not restart the MCP server in VS Code:', err));
    }, 750);
  }

  dispose(): void {
    this.registration?.dispose();
    this.changed.dispose();
  }
}

/** Remember which tool the user connected (prompts go there). */
export async function rememberAiTool(state: vscode.Memento, tool: AiTool, clientId?: string): Promise<void> {
  await state.update(TOOL_KEY, tool);
  if (clientId) { await state.update(`${PICKED_KEY}.${clientId}`, tool); }
}

/**
 * Hand a prompt to the user's AI tool: Copilot's agent chat, Cursor's chat
 * (deeplink, prefilled), or a Claude Code session in a terminal. The prompt is
 * also copied, in case the tool didn't open.
 */
export async function sendToAiTool(tool: AiTool, prompt: string, opts: { submit?: boolean } = {}): Promise<void> {
  await vscode.env.clipboard.writeText(prompt);
  try {
    if (tool === 'copilot') {
      // submit: false leaves it in the box (the user signs in to Rampify first).
      await vscode.commands.executeCommand('workbench.action.chat.open', { query: prompt, mode: 'agent', isPartialQuery: opts.submit === false });
    } else if (tool === 'cursor') {
      await vscode.env.openExternal(vscode.Uri.parse(
        `cursor://anysphere.cursor-deeplink/prompt?text=${encodeURIComponent(prompt)}`
      ));
    } else {
      const terminal = vscode.window.createTerminal({ name: 'Claude Code', cwd: folderPath() });
      terminal.show();
      terminal.sendText(`claude ${shellQuote(prompt)}`, true);
    }
  } catch {
    vscode.window.showInformationMessage(`Couldn't open ${AI_TOOL_LABELS[tool]}. The prompt is copied: paste it into your AI chat.`);
  }
}

/**
 * Start the first prompt in the AI tool: the server's text (setup-advance's
 * first_prompt, the same text as the get_started MCP prompt), left in the box.
 * Not the /mcp.Rampify.get_started slash command: when Rampify isn't on in
 * that chat, VS Code sends the command as literal text (founder test,
 * 2026-10-26), while the text still tells an agent without Rampify to stop
 * and say so.
 */
export async function sendFirstPrompt(tool: AiTool, text: string): Promise<void> {
  await sendToAiTool(tool, text, { submit: false });
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
