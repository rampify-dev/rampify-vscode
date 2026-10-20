# Extension Development Guide

## Quick Start: Using the Extension Locally

If you just want to **use** the extension while working on Rampify:

```bash
# Build, package and install into VS Code or Cursor
./scripts/install-local.sh

# Reload VS Code (Cmd+Shift+P → "Developer: Reload Window")
```

Now the extension is active in your current VS Code workspace!

---

## Development Mode: Making Changes to the Extension

When you want to **modify** the extension code:

### Setup

1. **Open Extension Folder in VS Code**
   ```bash
   cd packages/vscode-extension
   code .
   ```

2. **Start Watch Mode**
   ```bash
   npm run watch
   # Keeps running, auto-compiles on file changes
   ```

3. **Launch Extension Development Host**
   - Press **F5** in VS Code
   - Or: Debug panel → "Run Extension" → Play button
   - A new VS Code window opens (Extension Development Host)

4. **Test Extension**
   - In the new window: `File → Open Folder → /Users/alnoor/Code/rampify`
   - Extension is now active for testing

### Development Workflow

```
Window 1: packages/vscode-extension     Window 2: Extension Development Host
├─ Edit extension code                 ├─ Open Rampify project
├─ npm run watch (running)             ├─ Test extension features
├─ Set breakpoints                     ├─ View sidebar, run commands
└─ View Debug Console                  └─ Press Cmd+R to reload
```

**After making changes:**
1. Save file (auto-compiles via `npm run watch`)
2. Press **Cmd+R** in Extension Development Host window
3. Extension reloads with your changes

**Debugging:**
- Set breakpoints in source files (Window 1)
- Breakpoints hit when you use extension (Window 2)
- View Debug Console in Window 1

---

## Testing Against Local API

The extension can connect to your local Rampify API for testing:

### 1. Start Local API
```bash
# In main Rampify directory
cd /Users/alnoor/Code/rampify
npm run dev
# API runs at http://localhost:3000
```

### 2. Configure Extension for Local API

In Extension Development Host window:

1. Open Command Palette (`Cmd+Shift+P`)
2. Run: `Rampify: Switch Environment`
3. Select "Local Development"
4. Confirm URL: `http://localhost:3000`
5. Set your API key: `Rampify: Set API Key`

Now the extension talks to your local API!

---

## File Structure

```
packages/vscode-extension/
├── src/
│   ├── extension.ts                    # Entry point: commands, project linking, MCP setup
│   ├── api/
│   │   ├── client.ts                   # API client (axios, per-environment base URL)
│   │   └── types.ts                    # API response types
│   ├── providers/
│   │   └── feature-specs-tree-provider.ts  # Specs sidebar tree
│   ├── types/
│   │   └── markdown.d.ts               # .md imports (bundled as text by esbuild)
│   └── utils/
│       └── project-config.ts           # Workspace link + domain detection
├── resources/                          # Icons
├── scripts/install-local.sh            # Build, package, install locally
├── out/                                # Bundled JavaScript (generated)
├── package.json                        # Extension manifest
└── tsconfig.json                       # TypeScript config
```

---

## Common Tasks

### Add a New Command

1. **Register in package.json:**
   ```json
   "contributes": {
     "commands": [
       {
         "command": "rampify.myNewCommand",
         "title": "Rampify: My New Command"
       }
     ]
   }
   ```

2. **Implement in extension.ts:**
   ```typescript
   context.subscriptions.push(
     vscode.commands.registerCommand('rampify.myNewCommand', async () => {
       // Your implementation
       vscode.window.showInformationMessage('Hello!');
     })
   );
   ```

3. **Test:**
   - Reload Extension Development Host (Cmd+R)
   - Open Command Palette
   - Search for "Rampify: My New Command"

### Add a New API Method

1. **Define types in `api/types.ts`**
2. **Add method to `api/client.ts`:**
   ```typescript
   async getMyData(siteId: string): Promise<MyData> {
     const response = await this.axios.get(`/sites/${siteId}/my-data`);
     return response.data;
   }
   ```
3. **Use in your command/provider**

### Update Tree View

Edit `providers/feature-specs-tree-provider.ts`:
- `getChildren()` - Controls tree structure
- `getTreeItem()` - Controls item appearance
- `refresh()` - Triggers tree refresh

---

## Troubleshooting

### Extension doesn't load
- Check Debug Console for errors
- Ensure `npm run compile` and `npm run bundle` succeeded
- Try "Developer: Reload Window" in Extension Development Host

### Breakpoints not hitting
- Ensure source maps are enabled (tsconfig.json: `"sourceMap": true`)
- Reload Extension Development Host (Cmd+R)
- Check breakpoint is in compiled code (not just TypeScript)

### API calls failing
- Verify environment setting: `Rampify: Switch Environment`
- Check API key: `Rampify: Set API Key`
- For local API, ensure dev server is running
- Check Debug Console for detailed error messages

### Tree view not updating
- Call `featureSpecsProvider.refresh()` after data changes
- Check `loadData()` for errors
- Verify API returns expected data structure

---

## Releasing

The extension is published to two registries from the same `.vsix`:

- **VS Code Marketplace** as `rampify.rampify` (publisher `rampify`), for VS Code
- **Open VSX** as `Rampify/rampify`, for Cursor, Windsurf, Antigravity, VSCodium and other editors built on VS Code

### One-time setup

- **Marketplace:** run `npx @vscode/vsce login rampify` and paste a Personal Access Token from the publisher's Azure DevOps organization (scope: Marketplace → Manage). vsce stores it in the macOS keychain, so `npx @vscode/vsce ls-publishers` listing `rampify` means you're set.
- **Open VSX:** create an access token at https://open-vsx.org/user-settings/tokens and store it in the macOS Keychain, where `publish:ovsx` reads it:
  ```bash
  security add-generic-password -U -a rampify -s rampify-ovsx-pat -w '<token>'
  ```
  An `OVSX_PAT` environment variable overrides the Keychain entry. Keep the token out of shell profiles and history.

### Each release

1. Bump `version` in `package.json` (`npm version minor --no-git-tag-version`) and add a `CHANGELOG.md` entry. The CHANGELOG is shown on both registries.
2. Check it builds clean: `npm run compile && npm run lint`.
3. Merge the change to `main` through a PR as usual.
4. From `packages/vscode-extension` on an up-to-date `main`:
   ```bash
   npm ci
   npm run release
   ```
   `release` builds `rampify-<version>.vsix` once and publishes that same file to the Marketplace (`publish:vsce`) and Open VSX (`publish:ovsx`). If one registry fails, fix it and rerun just that script; the `.vsix` is still there.
5. Check both listings show the new version (they take a few minutes to update): `npx @vscode/vsce show rampify.rampify` and https://open-vsx.org/extension/Rampify/rampify.
6. Sync the public mirror (github.com/rampify-dev/rampify-vscode) and tag the version: `npm run sync:mirror` (add `-- --dry` to preview).

The `.claude/rules/rampify.md` template lives at `src/templates/rampify-rules.md`, a copy of `packages/rampify-cli/templates/.claude/rules/rampify.md` kept here so the mirror builds on its own. `tests/unit/vscode-rules-template-sync.test.ts` fails if the two differ; update both together.

The `.vsix` is gitignored; delete it after the release.

---

## Tips

- **Use watch mode** - `npm run watch` is your friend during development
- **Check Debug Console** - Most errors show up here
- **Test edge cases** - No project linked, no API key, network errors
- **Reload often** - Cmd+R in Extension Development Host after changes
- **Use breakpoints** - Easier than console.log for complex debugging
- **Test multi-environment** - Production and local APIs
