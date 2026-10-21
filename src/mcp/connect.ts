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

export type AiTool = 'copilot' | 'cursor' | 'claude';

export const SERVER_NAME = 'rampify';
export const PIN_HEADER = 'X-Rampify-Project';
const TOOL_KEY = 'rampify.aiTool';
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

/** VS Code's MCP provider API exists here (VS Code 1.101+, not Cursor's fork of it). */
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

function entryFor(tool: AiTool, mcpUrl: string, pin: string): Record<string, unknown> {
  const headers = { [PIN_HEADER]: pin };
  // VS Code and Claude Code want an explicit type; Cursor infers it from url.
  return tool === 'cursor' ? { url: mcpUrl, headers } : { type: 'http', url: mcpUrl, headers };
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
 * Copilot without a config file: Rampify contributes its MCP server through
 * VS Code's provider API once the user connects, pinned to the linked project.
 */
export class CopilotMcpProvider implements vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  private registration: vscode.Disposable | undefined;

  constructor(
    private readonly state: vscode.Memento,
    private readonly getMcpUrl: () => string,
    private readonly getPin: () => string | null
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
        return [new Def('Rampify', vscode.Uri.parse(this.getMcpUrl()), { [PIN_HEADER]: pin })];
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

  /** The linked project changed: re-provide with the new pin. */
  refresh(): void {
    this.changed.fire();
  }

  dispose(): void {
    this.registration?.dispose();
    this.changed.dispose();
  }
}

/** Remember which tool the user connected (prompts go there). */
export async function rememberAiTool(state: vscode.Memento, tool: AiTool): Promise<void> {
  await state.update(TOOL_KEY, tool);
}

/**
 * Hand a prompt to the user's AI tool: Copilot's agent chat, Cursor's chat
 * (deeplink, prefilled), or a Claude Code session in a terminal. The prompt is
 * also copied, in case the tool didn't open.
 */
export async function sendToAiTool(tool: AiTool, prompt: string): Promise<void> {
  await vscode.env.clipboard.writeText(prompt);
  try {
    if (tool === 'copilot') {
      await vscode.commands.executeCommand('workbench.action.chat.open', { query: prompt, mode: 'agent' });
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

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
