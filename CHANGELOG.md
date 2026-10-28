# Changelog

All notable changes to the Rampify VS Code extension will be documented in this file.

## [0.13.0] - 2026-10-28

### Added
- Setup has a new optional step after connecting your AI tool: **Run your first playbook**. Rampify's Category Visibility Check asks AI assistants the questions your buyers ask, shows whether they name you, and files a spec for the biggest gap. "Run in" sends the playbook's prompt to your AI tool (Copilot, Cursor or Claude Code), or type `/mcp__rampify__category_visibility` in Claude Code or `/mcp.Rampify.category_visibility` in Copilot. The step shows while the run is going and ticks when it finishes; Skip holds on the web and in your AI tool too

## [0.12.3] - 2026-10-27

### Fixed
- Signing out shows the sign-in panel, even if you'd chosen the Specs list, instead of a blank list and an "Unauthorized. Please check your settings." message. Signed out, the extension no longer asks Rampify for anything, and a sign-in that expired or was revoked now says so and offers "Sign in"

## [0.12.2] - 2026-10-27

### Changed
- Requests to Rampify also name the editor the extension runs in (`vscode`, `cursor`, `windsurf`…, from `vscode.env.uriScheme`) next to the operating system in the `X-Rampify-Client` header, so Rampify can show which editor your AI tool runs in. Nothing about your code or files is sent

## [0.12.1] - 2026-10-26

### Changed
- Requests to Rampify now include your operating system (`darwin`, `win32` or `linux`, from Node's `process.platform`) next to the extension's version in the `X-Rampify-Client` header, so Rampify can see which systems people use it on. Nothing about your code or files is sent

### Fixed
- Rampify appears in GitHub Copilot only once the folder is signed in to the extension, so Copilot no longer picks up older Rampify servers. Copilot still asks you to authenticate once in the browser (its chat doesn't use the extension's sign-in); the panel now says so

## [0.12.0] - 2026-10-26

### Changed
- The Home panel is Rampify's setup checklist, the same steps as the web and your AI tool: add your website, connect your AI tool, Search Console (optional), and how you found Rampify. One step is open at a time, and a scan that didn't finish says why
- Connecting your AI tool (GitHub Copilot, Claude Code or Cursor) has step-by-step instructions in the panel, and the first prompt unlocks once your AI tool reaches Rampify
- Each project gets its own Rampify server address, so AI tools keep a separate sign-in per project
- Signing in shows its progress in the panel, finishes even if the browser step takes a while (or the window reloads), and the checklist loads faster

### Fixed
- Connecting Search Console from the panel returns to the right page

## [0.11.0] - 2026-10-21

### Changed
- Requests to Rampify now say which client sent them (the extension and its version) and whether you asked for them (a click or command) or the sidebar refreshed on its own. Rampify uses this to count what you did, separately from the extension keeping itself up to date. No new data about your code or files is sent

## [0.10.0] - 2026-10-21

### Changed
- **Name your project in the sidebar.** Signing in no longer asks for a project name in the browser; the sidebar suggests one from the folder name (selected, so typing replaces it) and you can rename it any time (**Rename Project**). A single-project account signs in without a project picker
- **Connect your AI tool in one click**, with your editor's tool first: GitHub Copilot connects directly in VS Code (no config file), Cursor and Claude Code get a config in the folder. Every config is pinned to the folder's project, and Rampify refuses an AI tool signed in to a different project, with a message saying how to reconnect. **Switch Project** updates the pins
- **Your first spec is a getting-started spec** your AI works through while you watch: it maps the project into a throwaway `.rampify/project-map.md`, then writes a spec for what you're working on, which gets a **Start Building** button. Empty folder with no commits? It asks what you're building first
- Specs from a site scan don't complete your first spec or take over the sidebar, and the specs list splits into **Your specs** and **From your site scan**
- The footer links moved to the sidebar's title bar and **⋯** menu (dashboard, rename, switch project, MCP setup, docs, sign out)
- With no folder open, the sidebar leads with **Open Your Project Folder** (or **Start a new project**) and picks up signing in after the folder opens

### Fixed
- Buttons in the sidebar looked disabled (grey text) in some themes

## [0.9.0] - 2026-10-20

### Changed
- **Setup happens in the sidebar.** Name your project, choose website or app, and say whether your site is live, all inline. The steps follow your answers: a live site gets **Scan your site** and **Connect Google Search Console**, a site that isn't live yet gets Search Console as an optional step, and apps skip the site questions. The browser opens only for signing in and Google's Search Console sign-in
- **"It's live" is checked.** If the site doesn't answer, the sidebar asks whether it's live yet and offers to save it as not live
- **Your first spec** has a "What are you building next?" box that copies a ready-made prompt for your AI

### Added
- **Skip for now** on every setup step, remembered per folder, with **Undo**
- **Show Specs** / **Show Setup Checklist** switch the sidebar between your specs and the checklist, even before your first spec

### Fixed
- The **Set up your project** step could never complete for a project without a site, even after skipping setup on the web
- Signing in no longer gets stuck on "Finish signing in to Rampify in your browser…" when the browser hands back to a different VS Code window, and clicking Sign in again while it's waiting reopens the browser page instead of starting a second sign-in

## [0.8.1] - 2026-10-20

### Changed
- **Connect your AI tool** is checked off when your AI tool actually connects to Rampify, as reported by Rampify, not just when Rampify is in an MCP config file. If Rampify is configured but your AI tool hasn't signed in yet, the step says so

## [0.8.0] - 2026-10-20

### Fixed
- **Signing up from the extension now comes back to the editor.** New users used to land on a sign-in page, and switching to sign-up lost the way back, so VS Code waited and timed out. Sign in with Rampify now opens one page where GitHub, Google or an email code signs you in or creates your free account, then returns you to the editor to finish connecting
- If sign-in doesn't finish, the message offers **Try Again** and **Sign In with a Code**

### Changed
- New accounts can name their starter project on the connect screen
- The checklist's **Set up your project** step opens Rampify's setup in the browser with a **Back to VS Code** button, and is checked off once setup is finished or skipped

### Added
- **Sign in with a code**: in Codespaces in the browser and other windows where the browser can't hand control back to the editor, signing in now shows a short code to confirm at rampify.dev/activate instead of asking for an API key. The editor finishes on its own once you pick a project. Also available as **Rampify: Sign In with a Code** and from the Home panel

## [0.7.1] - 2026-10-20

### Fixed
- **Sign in with Rampify** failed in desktop VS Code with "The return address does not match the one this app registered." VS Code adds a window id to the extension's sign-in address, and that address was garbled on its way to the browser. The extension now uses the plain address, which Rampify recognizes as "Rampify for VS Code"
- Browser-based editors (vscode.dev) now say up front that sign-in isn't supported there yet and to use an API key, instead of failing partway

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
