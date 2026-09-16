#!/usr/bin/env bash
# Build the TRAQS macOS shell and install it over the copy in /Applications.
#
# The desktop app is a native window onto the DEPLOYED web app, so it only needs
# rebuilding when the Swift shell changes — a change to the web app itself is
# live the moment Netlify finishes deploying it, and you just relaunch (or ⌘R).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJ="$ROOT/TRAQS MacBook Native/TRAQS MacBook Native.xcodeproj"
BUILD="$ROOT/TRAQS MacBook Native/.build"
APP="$BUILD/Build/Products/Release/TRAQS MacBook Native.app"

echo "▸ Building…"
# PIPESTATUS, not the pipeline's status: piping into grep would otherwise mask a
# failed build behind grep's exit code, and the install below would happily ship
# the STALE bundle still sitting in the build directory from last time.
set +e
xcodebuild -project "$PROJ" -scheme "TRAQS MacBook Native" \
  -configuration Release -derivedDataPath "$BUILD" build \
  | grep -E "error:|warning:|BUILD"
STATUS=${PIPESTATUS[0]}
set -e
[ "$STATUS" -eq 0 ] || { echo "✗ Build failed — not installing."; exit 1; }
[ -d "$APP" ] || { echo "✗ No app produced — see the build output above."; exit 1; }

# Quit a running copy first: replacing the bundle underneath a live process
# leaves it running against files that no longer exist.
if pgrep -x "TRAQS" >/dev/null 2>&1; then
  echo "▸ Quitting the running app…"
  osascript -e 'tell application "TRAQS" to quit' >/dev/null 2>&1 || true
  sleep 1
fi

echo "▸ Installing to /Applications…"
# ONLY our own bundle. /Applications/TRAQS.app is the iOS app installed on this
# Mac through the App Store — root-owned, and not ours to touch. An earlier
# version of this script tried to clear that name too, was denied on every file,
# and `set -e` aborted mid-install having already removed the good copy.
rm -rf "/Applications/TRAQS MacBook Native.app"
cp -R "$APP" /Applications/
codesign -v "/Applications/TRAQS MacBook Native.app"

echo "✓ Installed. Open it from Launchpad, or: open -a 'TRAQS MacBook Native'"
