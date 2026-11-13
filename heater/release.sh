#!/usr/bin/env bash
# Builds ember-heater-vX.Y.zip from the version in app.js.
set -euo pipefail
cd "$(dirname "$0")"
V=$(grep -o 'const VERSION = "[^"]*"' app.js | cut -d'"' -f2)
grep -q "ember-v$V" sw.js || { echo "sw.js CACHE must be ember-v$V"; exit 1; }
rm -f ember-heater*.zip
zip -q "ember-heater-v$V.zip" index.html style.css app.js protocol.js govee.js sw.js manifest.webmanifest icon.svg icon-512.png _worker.js
echo "ember-heater-v$V.zip"
