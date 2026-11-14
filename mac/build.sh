#!/bin/bash
# Builds "Vire Ears.app" with the Command Line Tools alone (no Xcode). Run on the Mac, from this folder.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
app="$here/build/Vire Ears.app"
mkdir -p "$app/Contents/MacOS"
swiftc -O -swift-version 5 "$here/VireEars/main.swift" -o "$app/Contents/MacOS/VireEars"
cp "$here/Info.plist" "$app/Contents/Info.plist"
codesign --force --sign - "$app"
echo "built $app"
