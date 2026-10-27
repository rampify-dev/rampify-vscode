/**
 * Names for Rampify's server-made prompts as each AI tool shows them (spec
 * 818572e3). Pure (no vscode import) so a unit test can check them against
 * the server's prompt name (lib/mcp/prompt-registry.ts).
 */

/** Must match GET_STARTED_PROMPT in lib/mcp/prompt-registry.ts. */
export const GET_STARTED_PROMPT = 'get_started';

/** The Rampify server's label in VS Code (the extension provides it; see connect.ts). */
export const COPILOT_SERVER_LABEL = 'Rampify';

/** The server's name in the folder's MCP configs (.mcp.json, .cursor/mcp.json). */
export const SERVER_NAME = 'rampify';

/** VS Code's slash command for a server prompt: /mcp.<label, sanitized>.<prompt> (VS Code 1.143). */
export function vscodePromptCommand(prompt: string): string {
  return `/mcp.${COPILOT_SERVER_LABEL.replace(/[^a-z0-9_.-]/gi, '_')}.${prompt}`;
}

/** Claude Code's slash command for a server prompt: /mcp__<server>__<prompt>. */
export function claudePromptCommand(prompt: string): string {
  return `/mcp__${SERVER_NAME}__${prompt}`;
}
