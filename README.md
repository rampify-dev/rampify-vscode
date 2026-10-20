# Rampify: Spec-Driven Development

Rampify brings spec-driven development to AI coding tools. Instead of describing a feature in chat and hoping the result matches, you write a spec with acceptance criteria, tasks, and the files it touches, and any AI coding tool connected to Rampify can read it and build against it.

Specs can come from you or from Rampify. Rampify scans your site for problems like missing canonical tags, broken schema markup, and weak meta descriptions, then files a spec for each one with the affected URLs and fix instructions. Discovery runs research sessions on how AI models see your category and turns what it finds into keyword clusters and content work. Your AI picks up the spec, makes the change, and the next scan confirms the fix.

This extension puts those specs in your editor's sidebar and connects your AI coding tool to Rampify's MCP server in a couple of clicks.

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

### Specs sidebar

Your project's specs, grouped by status (Planned, In Progress) and sorted by priority. Hover for the summary, next action, and affected files, or click to open the spec in the Rampify dashboard. Completed, verified, and idea specs are hidden until you toggle them on, so the list stays on what's in flight.

### Specs from scans and Discovery

Rampify files specs for the issues its scans find (structured data, meta tags, canonical tags, indexing) with the affected URLs and fix instructions attached. Discovery research lands as keyword clusters and content specs your AI can act on.

### One-click AI context

Copy a spec reference into your AI chat with one click. Your AI fetches the full spec (description, acceptance criteria, tasks, affected files) through the MCP server and works against it.

### MCP setup

**Rampify: Set Up MCP Server** adds Rampify to `.vscode/mcp.json` (GitHub Copilot in VS Code 1.99 or later), `.cursor/mcp.json` (Cursor), or Claude Code. Your AI tool signs in to Rampify the first time it connects, so no API key is written into your project and the config is safe to commit. For Claude Code it also adds `.claude/rules/rampify.md`, which teaches Claude the spec workflow. CI and headless agents can copy a config that uses an API key instead.

## Getting started

### 1. Create a free account

Click **Create Free Account** in the Rampify sidebar, or sign up at [rampify.dev/free](https://www.rampify.dev/free). The free plan includes one project.

### 2. Connect the extension

1. Create an API key in [Settings → API keys](https://www.rampify.dev/settings/api-keys)
2. Click **Connect Account** in the Rampify sidebar (or run **Rampify: Set API Key**) and paste it

The extension checks the key with Rampify before saving it.

### 3. Link your project

Run **Rampify: Setup Project Link** and pick one of your projects. To start a new one, choose **Create New Project**: name it, and the extension opens Rampify's setup in your browser to finish. If your plan's project limit is reached, the extension tells you and offers the upgrade.

### 4. Connect your AI coding tool

Run **Rampify: Set Up MCP Server** and choose your tool. Once it's connected, your AI can read and update specs, run scans, and generate fixes.

## Commands

| Command | Description |
|---------|-------------|
| **Create Free Account** | Open Rampify's signup page |
| **Set API Key** | Connect the extension to your Rampify account |
| **Setup Project Link** | Link this folder to a Rampify project, or create one |
| **Set Up MCP Server** | Connect GitHub Copilot, Cursor, Claude Code, or another MCP client |
| **Refresh Feature Specs** | Re-fetch specs from Rampify |
| **Show/Hide Resolved and Idea Specs** | Toggle the Completed, Verified, Deprecated, and Idea groups |
| **Copy Feature Spec Reference** | Copy a spec reference for your AI chat |
| **Open Feature Spec in Browser** | Open the spec in the Rampify dashboard |
| **Disconnect** | Remove your API key and project link |
| **Switch Environment** | Point the extension at production or a local Rampify server |

## Configuration

| Setting | Description | Default |
|---------|-------------|---------|
| `rampify.apiKey` | Your Rampify API key | Not set |
| `rampify.environment` | API environment (`production` or `local`) | `production` |
| `rampify.localApiUrl` | Local API URL for development | `http://localhost:3000` |
| `rampify.clientId` | Linked project (set by Setup Project Link) | Not set |
| `rampify.domain` | Linked project's domain (set by Setup Project Link) | Not set |

## Requirements

- A [Rampify](https://www.rampify.dev/free) account (free plan available)
- VS Code 1.85 or later, or an editor built on it

## Links

- [Rampify](https://www.rampify.dev)
- [Extension docs](https://www.rampify.dev/docs/integrations/vscode-extension)
- [Connecting your AI tool over MCP](https://www.rampify.dev/docs/mcp/connecting)
- [Issues](https://github.com/rampify-dev/rampify-vscode/issues)
