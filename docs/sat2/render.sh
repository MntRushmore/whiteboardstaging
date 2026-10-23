#!/usr/bin/env bash
# Renders the SAT v2 mockups (mockups.html) to PNGs at 2x with headless Chrome, the way
# docs/problem-pages/render.sh does. Needs the network (Google Fonts, KaTeX from cdnjs).
#   ./render.sh            every frame
#   ./render.sh f04 f08    some frames
# The ink is generated: `npx jiti docs/sat2/ink-gen.ts` (from the repo root) after changing a line.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
chrome="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
frames=("$@")
[ ${#frames[@]} -eq 0 ] && frames=(f01 f02 f03 f04 f05 f06 f07 f08 f09 f10 f11 f12 f13)
name() { case "$1" in
  f01) echo question;; f02) echo working;; f03) echo rung1-nudge;; f04) echo rung2-one-step;; f05) echo rung3-walk;;
  f06) echo wrong-answer;; f07) echo solution-two-ways;; f08) echo gridin;; f09) echo long-table;; f10) echo capped;;
  f11) echo summary;; f12) echo home;; f13) echo portrait;; esac; }
for f in "${frames[@]}"; do
  size="1366,1024"; [ "$f" = f13 ] && size="1024,1366"
  out="$here/mock-${f#f}-$(name "$f").png"
  "$chrome" --headless=new --disable-gpu --hide-scrollbars --allow-file-access-from-files --force-device-scale-factor=2 \
    --window-size="$size" --virtual-time-budget=6000 --screenshot="$out" "file://$here/mockups.html#$f" >/dev/null 2>&1
  echo "$(basename "$out")"
done
