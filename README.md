# Rampify: Spec-Driven Development

**Turn your coding agent into a marketing agent.**

Rampify brings spec-driven development to AI coding tools. Instead of describing a feature in chat and hoping the result matches, you write a spec with acceptance criteria, tasks, and the files it touches, and any AI coding tool connected to Rampify can read it and build against it.

Specs can come from you or from Rampify. Rampify scans your site for problems like missing canonical tags, broken schema markup, and weak meta descriptions, then files a spec for each one with the affected URLs and fix instructions. Discovery runs research sessions on how AI models see your category and turns what it finds into keyword clusters and content work. Your AI picks up the spec, makes the change, and the next scan confirms the fix.

This extension signs you in to Rampify from the editor, walks you through setup, puts your specs in the sidebar, and connects your AI coding tool to Rampify's MCP server in a couple of clicks.

**Works in VS Code, Cursor, and other editors built on VS Code** (Windsurf, Antigravity and others install it from Open VSX). Rampify's MCP server works with Claude Code, Cursor, GitHub Copilot, and any MCP client that supports remote servers.

## How it works

```
You write a spec (or Rampify files one from a scan or a Discovery session)
    ↓
Your AI reads the spec over MCP: what to build, which files, how to verify
    ↓
Your AI implements the change and links the commit back to the spec
    ↓
The next scan confirms the fix
```

## Features

### Home panel

Before you're set up, the Rampify sidebar explains what Rampify does and signs you in. Once you're signed in it becomes a short checklist you finish right in the sidebar: name your project, say whether it's a website or an app and whether the site is live, then scan it, connect Google Search Console, connect your AI tool, and start your first spec. The steps adapt to your answers (no scan for a site that isn't live yet, no site questions for an app), and every step can be skipped for now. Once setup is done, the sidebar switches to your specs; the buttons in its title bar switch between your specs and the checklist any time, and its **⋯** menu has the dashboard, rename, switch project, MCP setup, docs, and sign out.

### Specs sidebar

Your project's specs, grouped by status (Planned, In Progress) and sorted by priority. Once a site scan has filed specs, the list splits into **Your specs** and **From your site scan**, so your own work doesn't get buried. Hover for the summary, next action, and affected files, or click to open the spec in the Rampify dashboard. Completed, verified, and idea specs are hidden until you toggle them on, so the list stays on what's in flight.

### Specs from scans and Discovery

Rampify files specs for the issues its scans find (structured data, meta tags, canonical tags, indexing) with the affected URLs and fix instructions attached. Discovery research lands as keyword clusters and content specs your AI can act on.

### One-click AI context

Copy a spec reference into your AI chat with one click. Your AI fetches the full spec (description, acceptance criteria, tasks, affected files) through the MCP server and works against it.

### Connecting your AI tool

One click in the checklist (or **Rampify: Set Up MCP** from the ⋯ menu) connects your AI tool to Rampify for this folder:

- **GitHub Copilot in VS Code** (1.101 or later): connected directly, with no config file. VS Code asks you to sign in to Rampify the first time Copilot uses it.
- **Cursor:** added to `.cursor/mcp.json`. Cursor asks to enable it, then you sign in.
- **Claude Code:** added to `.mcp.json`. Open Claude Code in the folder and type `/mcp` to sign in. It also adds `.claude/rules/rampify.md`, which teaches Claude the spec workflow.

**One folder, one project.** Each config is pinned to the folder's Rampify project, so your AI tool can't end up working on a different project than the folder. If it signs in to the wrong one, Rampify tells it to reconnect. The configs hold no secrets and are safe to commit. CI and headless agents can copy a config that uses an API key instead.

## Getting started

### 1. Sign in

Open your project folder, then click **Sign in with Rampify** in the Rampify sidebar. (No folder open? The sidebar opens one first, or **Start a new project** in an empty folder, and carries on signing in.) Your browser opens Rampify: continue with GitHub, Google, or an email code (this signs you in, or creates your free account if you're new). You're sent back to the editor with the folder linked. No API key to copy, and you name the project in the sidebar.

### 2. Follow the checklist

Everything happens in the sidebar:

- **Your project**: its name (we suggest one from the folder name; rename it any time), website or app, and whether your site is live (with its address). If you say it's live, Rampify checks that the site answers before saving.
- **Scan your site** (live sites): Rampify crawls it and turns what it finds into specs.
- **Connect Google Search Console** (recommended once live, optional before launch): Google's sign-in opens in your browser, with a **Back to VS Code** button when you're done.
- **Connect your AI tool** over MCP. This step completes once your AI tool actually connects.
- **Your first spec**: Rampify creates a getting-started spec and hands it to your AI. You watch the tasks check off in the sidebar as your AI maps the project (into a throwaway `.rampify/project-map.md`) and writes a spec for what you're working on. That spec gets a **Start Building** button.

Any step can be skipped for now. The rest of Rampify's setup (business profile, launch stage) is optional and lives in the dashboard.

### 3. Work from your specs

Once specs exist, the sidebar shows them grouped by status. Copy a spec reference into your AI chat, or open it in the dashboard.

**Working in Codespaces or another remote window?** Signing in works there too. When the browser can't hand control back to the editor, the extension shows a short code instead: confirm it at rampify.dev/activate, pick your project, and the editor finishes on its own. You can also choose **Sign in with a code** yourself if the browser doesn't return you to the right window.

Prefer an API key? Choose **Use an API key** and paste a key from [Settings → API keys](https://www.rampify.dev/settings/api-keys).

## Commands

| Command | Description |
|---------|-------------|
| **Sign In** | Sign in with Rampify in the browser and link this folder to a project |
| **Sign In with a Code** | Sign in by confirming a short code at rampify.dev/activate (for remote or browser windows) |
| **Switch Project** | Sign in again to link this folder to a different project (your AI tool configs follow) |
| **Rename Project** | Rename the project in Rampify |
| **Open Dashboard** / **Finish Setup in Dashboard** | Open the project in Rampify (business profile, launch stage and more) |
| **Set API Key (instead of signing in)** | Use a pasted API key instead of signing in |
| **Setup Project Link** | Link this folder to a project (with an API key), or sign in |
| **Set Up MCP** | Connect GitHub Copilot, Cursor, Claude Code, or another MCP client to this folder's project |
| **Refresh Feature Specs** | Re-fetch specs from Rampify |
| **Show Specs** / **Show Setup Checklist** | Switch the sidebar between your specs and the setup checklist |
| **Show/Hide Resolved and Idea Specs** | Toggle the Completed, Verified, Deprecated, and Idea groups |
| **Copy Feature Spec Reference** | Copy a spec reference for your AI chat |
| **Open Feature Spec in Browser** | Open the spec in the Rampify dashboard |
| **Sign Out** | Sign out of this folder's project and remove stored keys |
| **Switch Environment** | Point the extension at production or a local Rampify server |

## Configuration

Your sign-in and any API key are kept in your editor's secret storage (the system keychain), not in settings.

| Setting | Description | Default |
|---------|-------------|---------|
| `rampify.environment` | API environment (`production` or `local`) | `production` |
| `rampify.localApiUrl` | Local API URL for development | `http://localhost:3000` |
| `rampify.clientId` | Linked project (set when you sign in or link a project) | Not set |
| `rampify.domain` | Linked project's domain (set when you sign in or link a project) | Not set |

## Requirements

- A [Rampify](https://www.rampify.dev/free) account (free plan available)
- VS Code 1.85 or later, or an editor built on it

## Links

- [Rampify](https://www.rampify.dev)
- [Extension docs](https://www.rampify.dev/docs/integrations/vscode-extension)
- [Connecting your AI tool over MCP](https://www.rampify.dev/docs/mcp/connecting)
- [Issues](https://github.com/rampify-dev/rampify-vscode/issues)
