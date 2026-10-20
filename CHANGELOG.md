# Changelog

All notable changes to the Rampify VS Code extension will be documented in this file.

## [0.7.0] - 2026-10-20

### Added
- **Sign in with Rampify**: sign in (or create a free account) in the browser, pick or create a project, and come back to the editor with the folder linked. No API key to copy. Uses Rampify's OAuth sign-in, shown as "Rampify for VS Code"
- **Home panel**: before setup, the sidebar explains what Rampify does (it now leads with "Turn your coding agent into a marketing agent"); after you sign in, it shows a setup checklist (add your site, connect your AI tool, create your first spec) and hands over to your specs once the first one exists
- **Switch Project** command to link the folder to a different project

### Changed
- Your sign-in and API key are stored in the editor's secret storage (system keychain) instead of `settings.json`. An existing `rampify.apiKey` setting is moved there automatically
- Each project's sign-in is stored separately, so signing in from another repo doesn't replace this one
- **Use an API key instead** remains available for machines without a browser

### Fixed
- The specs list now picks up a new key right away instead of after a reload

## [0.6.0] - 2026-10-20

### Changed
- **Create Free Account** opens the current signup page (rampify.dev/free) instead of the retired /signup page
- **Set Up MCP Server** connects with sign-in (OAuth) instead of writing your API key into `.vscode/mcp.json`, `.cursor/mcp.json`, or the Claude Code command. Running it again replaces an entry written by an older version, which removes the stored key
- **Create New Project** asks only for a name, then opens Rampify's setup in your browser to finish (project type, starting point, domain)
- The `.claude/rules/rampify.md` file added for Claude Code is now the same workflow guide `rampify init` installs, and is only added when you choose Claude Code
- Idea specs are hidden by default along with resolved ones; the toggle is now **Show/Hide Resolved and Idea Specs**
- Specs open via the link Rampify returns, and the MCP setup follows the Switch Environment setting
- Display name is now "Rampify: Spec-Driven Development"

### Added
- When you've reached your plan's project limit, the extension says so and offers the next plan (or lets you link an existing project)
- **Copy Config JSON with API Key** for CI and headless agents that can't sign in

### Fixed
- **Select Existing Project** no longer fails for projects created in the dashboard, and shows each project's real name and domain
- **Set API Key** now checks the key with Rampify; previously any key was reported as saved successfully
- The extension no longer writes your API key to its debug console when a request fails
- Removed the task-progress counts that never displayed

## [0.5.1] - 2026-04-12

### Added
- Disconnect command (`Rampify: Disconnect`) to clear API key and project link
- Signup link uses tracked campaign attribution (rid=kiY9)

### Changed
- Reduced polling interval from 30s to 5 minutes (~10x fewer API calls)
- Polling pauses when editor window is unfocused
- Refreshes automatically when window regains focus

## [0.5.0] - 2026-04-12

### Added
- Welcome View onboarding flow for new users (no more empty sidebar)
- Three-stage onboarding: Sign up → Connect account → Link project → Set up MCP
- New commands: Open Documentation, Create Free Account

### Changed
- Empty states now use VS Code's native Welcome View API instead of tree items
- Context keys (rampify.hasApiKey, rampify.hasProject) control which welcome content is shown

## [0.4.0] - 2026-04-12

### Changed
- MCP setup wizard now uses remote HTTP transport instead of npm package
- No packages to install: connects directly to https://www.rampify.dev/api/mcp
- Multi-project support via X-Rampify-Project header (included automatically when a project is linked)
- Claude Code command updated to use `--transport http` with `/mcp` connect flow
- "View Docs" link now points to rampify.dev/docs instead of GitHub README

## [0.3.3] - 2026-04-09

### Added
- Support for 'page' feature type, so content specs created from keyword clusters now display correctly in the sidebar tree

## [0.3.1] - 2026-04-04

### Added
- Toggle button to hide/show resolved specs (Completed, Verified, Deprecated)
- Rampify branded icons for marketplace listing and sidebar
- Marketplace metadata (repository, license, gallery banner, pricing)

### Changed
- Display name updated to "Rampify: Spec-Driven Development"
- README rewritten for marketplace audience with spec-driven positioning
- Categories updated to Programming Languages, Linters, Testing

## [0.3.0] - 2026-04-04

### Added
- Published to VS Code Marketplace
- Spec-driven development positioning

## [0.2.0] - 2026-04-02

### Added
- Feature Specs sidebar with status groups and priority sorting
- Auto-generated specs from SEO scans with affected URLs
- One-click copy spec reference for AI context
- MCP server setup wizard (Claude Code, Cursor, Windsurf)
- Module-aware icons (SEO findings vs user specs)

### Removed
- Diagnostics providers (SEO and scan)
- Code actions and code lens providers
- Local scanner and file resolver
- AGENTS.md sync command
