# Rampify: Spec-Driven Development

Spec-driven development platform with AI SEO intelligence. Define specs, AI builds to spec, verify with a scan.

Rampify brings spec-driven development to AI coding tools. Instead of describing features in chat and hoping for the best, you define structured specifications with acceptance criteria, affected files, and implementation tasks that any AI coding tool can query and execute against.

Specs can come from you, or from Rampify. Run a scan, and Rampify analyzes your site for issues like missing canonical tags, broken schema markup, and meta description problems, then creates specs automatically with affected URLs and fix instructions. Your AI picks up the spec and implements the fix. You scan again to verify.

**Works with any AI coding tool.** Claude Code, Cursor, Copilot, Windsurf. Rampify is the structured layer underneath. Models come and go. Your specs persist.

## How it works

```
You define a spec (or Rampify creates one from a scan)
    ↓
AI queries the spec via MCP, knows what to build and which files to touch
    ↓
AI implements the change
    ↓
You commit, and the commit links back to the spec
    ↓
Scan again to verify the fix
```

## Features

### Specs sidebar

Browse all feature specs grouped by status (Planned, In Progress, Completed). Each spec shows priority, progress, and affected files. Click to open in the Rampify dashboard. Toggle resolved specs on/off to keep the sidebar focused.

### Auto-generated specs from scans

Rampify scans your site and creates specs for issues it finds, including missing structured data, broken meta tags, and canonical tag issues. Each spec includes affected URLs and fix instructions your AI can act on immediately.

### One-click AI context

Copy a spec reference into Claude or Cursor with a single click. Your AI retrieves the full spec (title, description, acceptance criteria, tasks, affected files, tech stack) and implements against it.

### MCP server setup

Set up the Rampify MCP server in one command. Built-in wizard supports Claude Code, Cursor, and Windsurf with automatic configuration. Once connected, your AI coding tools can query specs, run site scans, generate schema markup, and access SEO intelligence directly.

### Commit tracking

After committing a fix, link the commit SHA back to the spec for full traceability: code → commit → task → spec → requirement.

## Getting started

### 1. Install the extension

Search "Rampify" in the Extensions panel, or install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=rampify.rampify).

### 2. Set your API key

1. Open Command Palette (`Cmd+Shift+P`)
2. Run **Rampify: Set API Key**
3. Enter your key from [rampify.dev/settings/api-keys](https://www.rampify.dev/settings/api-keys)

### 3. Link your project

1. Open Command Palette
2. Run **Rampify: Setup Project Link**
3. Select your project or create a new one

### 4. Set up MCP (optional)

1. Open Command Palette
2. Run **Rampify: Set Up MCP Server**
3. Select your editor, and the wizard handles the rest

Now your AI coding tools can query specs, run scans, and generate fixes directly.

## Commands

| Command | Description |
|---------|-------------|
| **Setup Project Link** | Link this workspace to a Rampify project |
| **Set API Key** | Configure your Rampify API key |
| **Set Up MCP Server** | Install MCP server for Claude Code, Cursor, or Windsurf |
| **Refresh Feature Specs** | Re-fetch specs from Rampify |
| **Toggle Resolved Specs** | Show/hide Completed, Verified, and Deprecated sections |
| **Copy Feature Spec Reference** | Copy spec ID for pasting into AI chat |
| **Open Feature Spec in Browser** | Open spec detail in the Rampify dashboard |
| **Switch Environment** | Switch between production and local API |

## Configuration

| Setting | Description | Default |
|---------|-------------|---------|
| `rampify.apiKey` | Your Rampify API key | — |
| `rampify.environment` | API environment (`production` or `local`) | `production` |
| `rampify.localApiUrl` | Local API URL for development | `http://localhost:3000` |
| `rampify.clientId` | Project client ID (set via Setup Project Link) | — |
| `rampify.domain` | Project domain (auto-detected) | — |

## Requirements

- A free [Rampify](https://www.rampify.dev) account
- Works in VS Code and Cursor

## Links

- [Rampify Dashboard](https://www.rampify.dev)
- [Documentation](https://www.rampify.dev/docs)
- [GitHub](https://github.com/rampify-dev/rampify)
- [Issues](https://github.com/rampify-dev/rampify/issues)

## License

MIT
