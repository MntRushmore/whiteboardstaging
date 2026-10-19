#!/usr/bin/env bash
# Renders the problem-pages mockups (mockups.html) to PNGs with headless Chrome.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
chrome="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
for f in page working checked offer fix next done; do
  "$chrome" --headless=new --disable-gpu --hide-scrollbars --allow-file-access-from-files --force-device-scale-factor=1 \
    --window-size=1366,1024 --virtual-time-budget=2000 --screenshot="$here/mock-$f.png" "file://$here/mockups.html#$f" >/dev/null 2>&1
  echo "mock-$f.png"
done
