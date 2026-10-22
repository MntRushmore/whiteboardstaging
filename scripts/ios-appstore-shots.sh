#!/bin/bash
# The App Store's iPad screenshots (docs/APP-STORE-LAUNCH.md, "Screenshots"), from the simulator on the
# LOCAL stack only: a demo family made by the real first run, four weeks of practice filled into the
# local database (scripts/lib/appstore-demo-seed.sql), then AppStoreScreenshotUITests goes through
# problem pages, a hint, Ask drawing, All done, Home and Progress. The status bar reads 9:41, full
# battery, full Wi-Fi. Shots: 2752 × 2064 (13-inch, landscape), upright, no alpha.
#
# Needs: the local Supabase (`npm run db:start`; shared: never reset or stop it), a dev server on $PORT
# (`npm run dev -- -p 3991` with .env.local on the local stack, APPLE_ENVIRONMENT=Xcode) and the
# one-simulator-at-a-time helper ~/whiteboardstaging/sim-run.sh.
#
#   scripts/ios-appstore-shots.sh            build, then the whole run (fresh install → shots)
#   SKIP_BUILD=1 scripts/ios-appstore-shots.sh
#   SKIP_FAMILY=1   keep the app and its demo family from the last run (only the shots again)
#   OUT=<folder>    logs, results and shots (default: a temp folder); DD=<folder> DerivedData
set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd)
PORT=${PORT:-3991}
OUT=${OUT:-$(mktemp -d -t agathon-appstore-shots)}
DD=${DD:-$OUT/dd}
SIM=${SIM:-"iPad Pro 13-inch (M5)"}
SKIP_FAMILY=${SKIP_FAMILY:-}
mkdir -p "$OUT/raw" "$OUT/results"

ANON=$(grep -E "^NEXT_PUBLIC_SUPABASE_ANON_KEY=" "$ROOT/.env.local" | cut -d= -f2-)
grep -qE "^NEXT_PUBLIC_SUPABASE_URL=http://(127\.0\.0\.1|localhost)" "$ROOT/.env.local" \
  || { echo "ios-appstore-shots: .env.local must point at the local Supabase" >&2; exit 1; }
# any answer from an API route (a cold `next dev` compiles it first: allow a minute)
[ "$(curl -s -m 90 -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{}' "http://localhost:$PORT/api/billing/apple/notifications")" != 000 ] \
  || { echo "ios-appstore-shots: no dev server on $PORT" >&2; exit 1; }

export TEST_RUNNER_AGATHON_APPSTORE_SHOTS=1
export TEST_RUNNER_AGATHON_API_URL=http://localhost:$PORT
export TEST_RUNNER_SUPABASE_URL=http://127.0.0.1:54321
export TEST_RUNNER_SUPABASE_ANON_KEY=$ANON
export TEST_RUNNER_APPSTORE_STATE=$OUT/email.txt
export TEST_RUNNER_APPSTORE_SHOTS=$OUT/raw
export ROOT DD OUT PORT SKIP_FAMILY

if [ -z "${SKIP_BUILD:-}" ]; then
  xcodebuild build-for-testing -project "$ROOT/ios/Agathon.xcodeproj" -scheme Agathon -destination "generic/platform=iOS Simulator" \
    -derivedDataPath "$DD" -quiet > "$OUT/build.log" 2>&1 || { tail -30 "$OUT/build.log"; exit 1; }
fi

# a cold `next dev` compiles a route on its first call, slower than the app waits
for r in /api/client-errors /api/family /api/email/welcome /api/app/attest/register /api/app/attest/challenge \
  /api/billing/apple/transaction /api/family/pin /api/family/switch /api/family/kids /api/start/ink /api/start/step \
  /api/live/speak /api/live/recognize /api/live/solve /api/live/ask /api/live/reread /api/live/setup /api/live/check \
  /api/live/transcribe /api/try/check /api/try/help /api/live/ask/memory /api/live/ask/history /api/live/ask/history/move; do
  curl -s -m 180 -o /dev/null -X POST -H 'content-type: application/json' -d '{}' "http://localhost:$PORT$r" &
done
wait

run() { # name, xcodebuild args… (inside sim-run)
  local name=$1; shift
  echo "=== $name"
  xcodebuild test-without-building -project "$ROOT/ios/Agathon.xcodeproj" -scheme Agathon -destination "id=$SIM_UDID" \
    -derivedDataPath "$DD" -parallel-testing-enabled NO -resultBundlePath "$OUT/results/$name-$(date +%H%M%S).xcresult" \
    "$@" > "$OUT/$name.log" 2>&1
  local status=$?
  grep -E "Test Case .*(passed|failed)|error:" "$OUT/$name.log" | tail -4
  return $status
}
export -f run

~/whiteboardstaging/sim-run.sh "$SIM" -- bash -c '
  xcrun simctl status_bar "$SIM_UDID" override --time "9:41" --dataNetwork wifi --wifiMode active --wifiBars 3 \
    --cellularMode notSupported --batteryState charged --batteryLevel 100
  if [ -z "$SKIP_FAMILY" ]; then
    xcrun simctl uninstall "$SIM_UDID" app.agathon.Agathon >/dev/null 2>&1
    run family -only-testing:AgathonUITests/AppStoreScreenshotUITests/test1DemoFamily
    [ -s "$OUT/email.txt" ] || { echo "no demo family"; exit 1; }
    docker exec -i supabase_db_whiteboardstaging psql -U postgres -q -v email="$(cat "$OUT/email.txt")" < "$ROOT/scripts/lib/appstore-demo-seed.sql"
  fi
  for t in test2aHintOnASlip test2bPageSolved test2cAllDone test3AskDraws test4HomeAndProgress; do
    run "$t" -only-testing:AgathonUITests/AppStoreScreenshotUITests/$t || run "$t-again" -only-testing:AgathonUITests/AppStoreScreenshotUITests/$t
  done
  xcrun simctl status_bar "$SIM_UDID" clear
'

# 2752 × 2064, upright, no alpha channel (App Store Connect refuses transparency). XCUIScreen writes the
# panel's own portrait pixels with an orientation tag: turned upright here. The simulator is in iPadOS 26's
# windowed-apps mode, which draws a window resize grabber in the bottom-right corner (system chrome, not
# the app's, and absent in full-screen mode): painted over with the ground colour beside it.
flatten() { # in out
  magick "$1" -auto-orient -strip -background white -alpha remove -alpha off "$2"
  local w h c
  w=$(magick identify -format %w "$2"); h=$(magick identify -format %h "$2")
  c=$(magick "$2" -format "%[pixel:p{$((w - 6)),$((h - 100))}]" info:)
  magick "$2" -fill "$c" -draw "rectangle $((w - 80)),$((h - 80)) $((w - 1)),$((h - 1))" -alpha off "PNG24:$2"
}
for f in "$OUT"/raw/raw-*.png; do
  [ -f "$f" ] || continue
  name=$(basename "$f" .png); name=${name#raw-}
  flatten "$f" "$OUT/raw/$name.png"
  echo "$(sips -g pixelWidth -g pixelHeight -g hasAlpha "$OUT/raw/$name.png" | tail -3 | awk '{printf "%s ", $2}') $name"
done
echo "shots: $OUT/raw (number the chosen ones into docs/app-store/screenshots)"
