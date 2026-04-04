# Rampify VS Code Extension - Quick Start Guide

## 🚀 Testing the Extension Locally

### 1. Prerequisites

- VS Code installed
- Node.js 20+ installed
- Rampify API key (get from [Settings > API Keys](https://rampify.dev/settings/api-keys))

### 2. Build the Extension

```bash
# Already done! But if you make changes:
npm run compile

# Or use watch mode for development:
npm run watch
```

### 3. Launch Extension Development Host

**Option A: Using VS Code UI**
1. Open this folder (`packages/vscode-extension`) in VS Code
2. Press `F5` or go to Run & Debug (⌘+Shift+D / Ctrl+Shift+D)
3. Select "Run Extension" from dropdown
4. Click the green play button

**Option B: Using Command Palette**
1. Open Command Palette (⌘+Shift+P / Ctrl+Shift+P)
2. Type "Debug: Start Debugging"
3. Select "Run Extension"

This will open a new VS Code window with the extension loaded.

### 4. Configure the Extension

In the new VS Code window (Extension Development Host):

1. **Set API Key**
   - Open Command Palette (⌘+Shift+P / Ctrl+Shift+P)
   - Run: `Rampify: Set API Key`
   - Enter your API key (starts with `sk_live_` or `sk_test_`)

2. **Switch to Local Environment** (for testing against local API)
   - Command Palette → `Rampify: Switch Environment`
   - Select "Local Development"
   - Confirm URL is `http://localhost:3000` (or your local dev server)

3. **Link a Project**
   - Open a project folder (e.g., your website repo)
   - Command Palette → `Rampify: Setup Project Link`
   - Select an existing client or create a new one

### 5. View Action Plan

1. Click the Rampify icon in the Activity Bar (left sidebar)
2. You should see your action plan organized by phase
3. Click any action to see details
4. Use the refresh button to generate a new snapshot

## 🔧 Testing Against Local API

### Start Local API Server

```bash
# In the main project root
cd /Users/alnoor/Code/rampify
npm run dev
```

The API will be available at `http://localhost:3000`

### Configure Extension for Local Testing

1. Command Palette → `Rampify: Switch Environment`
2. Select "Local Development"
3. Ensure local API URL is `http://localhost:3000`

Now the extension will make requests to your local instance!

## 📝 Making Changes

### File Structure

- `src/extension.ts` - Main entry point, command registration
- `src/api/client.ts` - API client with environment support
- `src/providers/action-plan-tree-provider.ts` - Tree view data provider
- `src/views/action-detail-panel.ts` - Webview panel for action details
- `src/utils/project-config.ts` - Project linking and auto-detection

### Development Workflow

1. Make changes to TypeScript files in `src/`
2. Extension will auto-recompile (if `npm run watch` is running)
3. Reload the Extension Development Host:
   - Press `Cmd+R` / `Ctrl+R` in the Extension Development Host window
   - Or: Command Palette → "Developer: Reload Window"

### Debugging

- Set breakpoints in VS Code (in your TypeScript source files)
- Breakpoints will work in the Extension Development Host
- Check the Debug Console for logs

## 🧪 Test Cases

### Test 1: Project Setup
- ✅ Auto-detect domain from package.json
- ✅ Select existing client
- ✅ Create new client
- ✅ Save to workspace settings

### Test 2: Action Plan Loading
- ✅ Load phases
- ✅ Load actions by category
- ✅ Display priority badges
- ✅ Show action counts

### Test 3: Action Details
- ✅ Open action detail panel
- ✅ View impact and fix instructions
- ✅ Copy code snippets
- ✅ Update action status

### Test 4: Environment Switching
- ✅ Production API
- ✅ Staging API
- ✅ Local development API

## 🐛 Troubleshooting

### Extension doesn't load
- Check Debug Console for errors
- Ensure `npm run compile` succeeded
- Try "Developer: Reload Window"

### API connection fails
- Verify API key is correct
- Check environment setting
- Ensure local server is running (if using local env)
- Check network/firewall

### Tree view is empty
- Ensure project is linked (`Rampify: Setup Project Link`)
- Check if client has a site and action snapshot
- Try refreshing (`Rampify: Refresh Action Plan`)

### "No project linked" message
- Run `Rampify: Setup Project Link`
- Ensure workspace folder is open
- Check `.vscode/settings.json` has `rampify.clientId`

## 📦 Packaging for Distribution

When ready to distribute:

```bash
# Install vsce if not already installed
npm install -g @vscode/vsce

# Package extension
vsce package
```

This creates a `.vsix` file that can be installed manually or published to the VS Code Marketplace.

## 🎯 Next Steps

1. Test all commands and features
2. Add missing icon files (extension needs `resources/icon.png`)
3. Create test suite (in `src/test/`)
4. Add telemetry/analytics (optional)
5. Publish to VS Code Marketplace

## 📚 Resources

- [VS Code Extension API](https://code.visualstudio.com/api)
- [Tree View API](https://code.visualstudio.com/api/extension-guides/tree-view)
- [Webview API](https://code.visualstudio.com/api/extension-guides/webview)
- [Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)

---

**Happy coding! 🚀**

For issues or questions, check the main [README.md](README.md) or contact support.
