# Extension Development Guide

## Quick Start: Using the Extension Locally

If you just want to **use** the extension while working on Rampify:

```bash
# One-time setup
npm install -g @vscode/vsce

# Install/update extension
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
│   ├── extension.ts                    # Entry point, commands
│   ├── api/
│   │   ├── client.ts                   # API client
│   │   └── types.ts                    # TypeScript types
│   ├── providers/
│   │   ├── action-plan-tree-provider.ts    # Sidebar tree view
│   │   ├── diagnostics.ts                  # Problems panel (action plan)
│   │   ├── diagnostics-simple.ts           # Problems panel (local scans)
│   │   ├── code-actions.ts                 # Quick fix suggestions
│   │   └── codelens.ts                     # Inline scan buttons
│   ├── views/
│   │   └── action-detail-panel.ts      # Action details webview
│   └── utils/
│       ├── project-config.ts           # Project linking
│       ├── local-scanner.ts            # Localhost page scanner
│       ├── file-resolver.ts            # File → URL resolution
│       └── url-mapper.ts               # URL → File mapping
├── out/                                # Compiled JavaScript (generated)
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

Edit `providers/action-plan-tree-provider.ts`:
- `getChildren()` - Controls tree structure
- `getTreeItem()` - Controls item appearance
- `refresh()` - Triggers tree refresh

---

## Troubleshooting

### Extension doesn't load
- Check Debug Console for errors
- Ensure `npm run compile` succeeded
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
- Call `actionPlanProvider.refresh()` after data changes
- Check `loadData()` for errors
- Verify API returns expected data structure

---

## Publishing (Future)

When ready to publish to VS Code Marketplace:

1. **Create publisher account**
   - Visit https://marketplace.visualstudio.com/manage
   - Sign in with Microsoft account

2. **Add repository to package.json**
   ```json
   "repository": {
     "type": "git",
     "url": "https://github.com/your-org/rampify"
   }
   ```

3. **Package and publish**
   ```bash
   vsce package
   vsce publish
   ```

4. **Update version**
   ```bash
   npm version patch  # or minor, major
   vsce publish
   ```

---

## Tips

- **Use watch mode** - `npm run watch` is your friend during development
- **Check Debug Console** - Most errors show up here
- **Test edge cases** - No project linked, no API key, network errors
- **Reload often** - Cmd+R in Extension Development Host after changes
- **Use breakpoints** - Easier than console.log for complex debugging
- **Test multi-environment** - Production, staging, and local APIs
