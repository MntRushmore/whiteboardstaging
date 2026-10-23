#!/bin/bash
# Messy kid sessions on the real board (docs/KID-SESSIONS.md): `KidSessionUITests` against PRODUCTION
# as qa-bench@agathon.app (the password from the macOS Keychain, service "Agathon QA bench"), with the
# training flag (an admin's calls spend no ink), one session per xcodebuild run with a screen
# recording each, through the one-at-a-time sim-run.sh — in batches, so other lanes get the simulator
# between them. Then the app's results and screenshots are copied out and the report is written.
#
#   scripts/ios-kid-sessions.sh [build] [run] [report]      (default: all three)
#
#   SESSIONS="01 02 …"   which (default: all twelve; 00 signs in first and always runs)
#   OUT=<dir>            default ~/whiteboardstaging/qa-sessions/<date>
#   DD=<DerivedData>     default ~/whiteboardstaging/dd-human
#   SIM=<simulator>      default "iPad Air 11-inch (M4)"   BATCH=<n> sessions per simulator hold (4)
set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd)
DATE=$(date +%Y-%m-%d)
OUT=${OUT:-$HOME/whiteboardstaging/qa-sessions/$DATE}
DD=${DD:-$HOME/whiteboardstaging/dd-human}
SIM=${SIM:-"iPad Air 11-inch (M4)"}
BATCH=${BATCH:-4}
SESSIONS=${SESSIONS:-"01 02 03 04 05 06 07 08 09 10 11 12"}
RUN=${RUN:-$(date +%m%d-%H%M)}
STEPS=${*:-build run report}
mkdir -p "$OUT/shots" "$OUT/video" "$OUT/logs" "$OUT/results"

export TEST_RUNNER_AGATHON_KID_SESSIONS=1
export TEST_RUNNER_KID_EMAIL=qa-bench@agathon.app
export TEST_RUNNER_KID_RUN=$RUN
export TEST_RUNNER_KID_SHOTS=$OUT/shots
unset TEST_RUNNER_AGATHON_API_URL TEST_RUNNER_SUPABASE_URL TEST_RUNNER_SUPABASE_ANON_KEY
export ROOT DD OUT RUN

for step in $STEPS; do
  case $step in
  build)
    (cd "$ROOT/ios" && xcodegen generate -q)
    xcodebuild build-for-testing -project "$ROOT/ios/Agathon.xcodeproj" -scheme Agathon -destination "generic/platform=iOS Simulator" \
      -derivedDataPath "$DD" -parallel-testing-enabled NO -quiet 2>&1 | grep -E "error:|BUILD FAILED" | head -30
    [ "${PIPESTATUS[0]}" = 0 ] || exit 1 ;;
  run)
    TEST_RUNNER_KID_PASSWORD=$(security find-generic-password -s "Agathon QA bench" -w) || { echo "no Keychain item 'Agathon QA bench'" >&2; exit 1; }
    export TEST_RUNNER_KID_PASSWORD
    set -- $SESSIONS
    first=1
    while [ $# -gt 0 ]; do
      batch=""
      for _ in $(seq 1 "$BATCH"); do [ $# -gt 0 ] && { batch="$batch $1"; shift; }; done
      [ $first = 1 ] && batch="00$batch" && first=0
      echo "kid sessions:$batch → $OUT (run $RUN)"
      BATCH_LIST=$batch ~/whiteboardstaging/sim-run.sh "$SIM" -- bash -c '
        for n in $BATCH_LIST; do
          case $n in 00) t=test00SignIn ;; *) t=testS$n ;; esac
          xcrun simctl io "$SIM_UDID" recordVideo --codec=h264 --force "$OUT/video/s$n.mp4" >/dev/null 2>&1 &
          rec=$!
          sleep 2
          xcodebuild test-without-building -project "$ROOT/ios/Agathon.xcodeproj" -scheme Agathon -destination "id=$SIM_UDID" \
            -derivedDataPath "$DD" -parallel-testing-enabled NO -only-testing:AgathonUITests/KidSessionUITests/$t \
            > "$OUT/logs/s$n.log" 2>&1
          kill -INT $rec 2>/dev/null; wait $rec 2>/dev/null
          printf "  %s: %s\n" "$t" "$(grep -E "Test (case|Case) .*(passed|failed|skipped)" "$OUT/logs/s$n.log" | tail -1 | sed -E "s/.*(passed|failed|skipped).*/\1/")"
        done
        # the player wrote its results in the app'"'"'s Documents
        data=$(xcrun simctl get_app_container "$SIM_UDID" app.agathon.Agathon data 2>/dev/null)
        [ -n "$data" ] && cp -R "$data/Documents/kid-sessions/$RUN/." "$OUT/results/" 2>/dev/null
        true'
    done ;;
  report)
    node "$ROOT/scripts/kid-sessions-report.mjs" "$OUT" && echo "report: $OUT/report.html" ;;
  esac
done
