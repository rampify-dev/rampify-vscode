#!/bin/bash
# Quick script to build and install extension locally (VS Code or Cursor)

set -e

echo "📦 Building extension..."
npm run compile

echo "📦 Packaging extension..."
vsce package --allow-missing-repository

echo "📦 Installing extension..."

# Find the editor CLI - supports both Cursor and VS Code
CODE_CMD=""
if command -v cursor &> /dev/null; then
  CODE_CMD="cursor"
elif [ -f "/Applications/Cursor.app/Contents/Resources/app/bin/cursor" ]; then
  CODE_CMD="/Applications/Cursor.app/Contents/Resources/app/bin/cursor"
elif command -v code &> /dev/null; then
  CODE_CMD="code"
elif [ -f "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" ]; then
  CODE_CMD="/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"
elif [ -f "/usr/local/bin/code" ]; then
  CODE_CMD="/usr/local/bin/code"
else
  echo ""
  echo "⚠️  Could not find editor CLI. To finish installing manually:"
  echo "   Cursor: Extensions panel (Cmd+Shift+X) → ⋯ menu → Install from VSIX"
  echo "   VS Code: same steps"
  echo ""
  echo "   VSIX file: $(pwd)/rampify-0.1.0.vsix"
  exit 0
fi

echo "   Using: $CODE_CMD"
"$CODE_CMD" --install-extension rampify-*.vsix --force

echo "✅ Extension installed! Reload your editor to activate."
echo "   Run: Cmd+Shift+P → 'Developer: Reload Window'"
