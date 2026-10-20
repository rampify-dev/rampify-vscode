#!/bin/bash
# Sync this package to the public mirror repo (github.com/rampify-dev/rampify-vscode)
# and tag the current version. Run after a release, from an up-to-date main.
#
#   npm run sync:mirror            # commit + tag + push
#   npm run sync:mirror -- --dry   # show what would change, push nothing

set -euo pipefail

MIRROR="https://github.com/rampify-dev/rampify-vscode.git"
PKG_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VERSION=$(node -p "require('$PKG_DIR/package.json').version")
SRC_SHA=$(git -C "$PKG_DIR" rev-parse --short HEAD)
DRY=${1:-}

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

git clone --quiet "$MIRROR" "$WORK/mirror"

# Mirror the package tree exactly (build output, deps and packages excluded).
rsync -a --delete \
  --exclude .git --exclude node_modules --exclude out --exclude '*.vsix' \
  "$PKG_DIR/" "$WORK/mirror/"

cd "$WORK/mirror"
git add -A
if git diff --cached --quiet; then
  echo "Mirror already matches v$VERSION."
  exit 0
fi

git diff --cached --stat | tail -20
if [ "$DRY" = "--dry" ]; then
  echo "(dry run: nothing pushed)"
  exit 0
fi

git commit --quiet -m "Sync v$VERSION from rampify monorepo ($SRC_SHA)"
git tag -f "v$VERSION"
git push --quiet origin HEAD
git push --quiet -f origin "v$VERSION"
echo "Mirror synced to v$VERSION and tagged."
