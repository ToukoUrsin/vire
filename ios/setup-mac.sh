#!/bin/bash
# One-time Mac setup for building Vire onto an iPhone. Runs as root (sudo); logs to ~/vire-tools/xcode-install.log.
MAS=/Users/touko/vire-tools/masx/mas.pkg/Payload/usr/local/opt/mas/bin/mas
echo "== $(date) get Xcode"
if [ ! -d /Applications/Xcode.app ]; then
  # App Store calls only work inside the logged-in user's desktop session.
  echo "-- install (re-download for an account that already has Xcode)"
  launchctl asuser 501 "$MAS" install 497799835; echo "install exit $?"
fi
if [ ! -d /Applications/Xcode.app ]; then
  echo "-- get (first time for this account)"
  launchctl asuser 501 "$MAS" get 497799835; echo "get exit $?"
fi
if [ ! -d /Applications/Xcode.app ]; then echo "XCODE-MISSING"; exit 1; fi
echo "== $(date) select, licence, first launch"
xcode-select -s /Applications/Xcode.app/Contents/Developer
xcodebuild -license accept
xcodebuild -runFirstLaunch
echo "== $(date) iOS platform"
xcodebuild -downloadPlatform iOS
echo "== $(date) DONE"
