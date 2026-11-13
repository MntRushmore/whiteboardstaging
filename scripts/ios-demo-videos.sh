#!/bin/bash
# The school demo's screen recordings (docs/DEMO-VIDEOS.md): `DemoSessions` played on the real board
# against PRODUCTION as qa-bench@agathon.app (the password from the macOS Keychain, service "Agathon
# QA bench"; an admin, so the training flag spends no ink), the board as a kid's account shows it
# (`-demoRecording`), one `simctl io recordVideo` per take, through the one-at-a-time sim-run.sh — in
# batches, so other lanes get the simulator between them. Then each take is cut (scripts/demo-video-cut.py).
#
#   scripts/ios-demo-videos.sh [build] [run] [cut]      (default: all three)
#
#   DEMOS="d2-carry d7-slip-fix …"   which (default: all fourteen)
#   TAKE=<label>                      the take's name (default: the time)
#   OUT=<dir>                         default ~/whiteboardstaging/demo-videos-1113
#   DD=<DerivedData>                  default ~/whiteboardstaging/dd-videos
#   SIM=<simulator>                   default "iPad Air 11-inch (M4)"   BATCH=<n> takes per simulator hold (4)
set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=${OUT:-$HOME/whiteboardstaging/demo-videos-1113}
DD=${DD:-$HOME/whiteboardstaging/dd-videos}
SIM=${SIM:-"iPad Air 11-inch (M4)"}
BATCH=${BATCH:-4}
DEMOS=${DEMOS:-"dK-add d1-subtract d2-carry d3-multiply d4-divide d5-fractions d6-equation d7-slip-fix d8-help-me w1-pizza w2-change w3-recipe w4-speed w5-sale"}
TAKE=${TAKE:-$(date +%H%M)}
STEPS=${*:-build run cut}
mkdir -p "$OUT/raw" "$OUT/logs" "$OUT/results" "$OUT/shots"

export TEST_RUNNER_AGATHON_KID_SESSIONS=1
export TEST_RUNNER_KID_EMAIL=qa-bench@agathon.app
export TEST_RUNNER_KID_RUN=demo-$TAKE
export TEST_RUNNER_KID_SHOTS=$OUT/shots
unset TEST_RUNNER_AGATHON_API_URL TEST_RUNNER_SUPABASE_URL TEST_RUNNER_SUPABASE_ANON_KEY
export ROOT DD OUT TAKE

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
    set -- $DEMOS
    while [ $# -gt 0 ]; do
      batch=""
      for _ in $(seq 1 "$BATCH"); do [ $# -gt 0 ] && { batch="$batch $1"; shift; }; done
      echo "demo videos:$batch → $OUT (take $TAKE)"
      BATCH_LIST=$batch ~/whiteboardstaging/sim-run.sh "$SIM" -- bash -c '
        xcrun simctl bootstatus "$SIM_UDID" >/dev/null 2>&1
        xcrun simctl status_bar "$SIM_UDID" override --time 9:41 --batteryState charged --batteryLevel 100 --wifiBars 3 --cellularMode notSupported
        # signed in as the QA bench (another lane may have signed the simulator in as someone else)
        xcodebuild test-without-building -project "$ROOT/ios/Agathon.xcodeproj" -scheme Agathon -destination "id=$SIM_UDID" \
          -derivedDataPath "$DD" -parallel-testing-enabled NO -only-testing:AgathonUITests/KidSessionUITests/test00SignIn \
          > "$OUT/logs/signin-$TAKE.log" 2>&1
        echo "  sign-in: $(grep -E "Test (case|Case) .*(passed|failed)" "$OUT/logs/signin-$TAKE.log" | tail -1 | sed -E "s/.*(passed|failed).*/\1/")"
        for id in $BATCH_LIST; do
          name="$id-$TAKE"
          rm -f "$OUT/raw/$name.rec.log"
          xcrun simctl io "$SIM_UDID" recordVideo --codec=h264 --force "$OUT/raw/$name.mp4" > "$OUT/raw/$name.rec.log" 2>&1 &
          rec=$!
          for _ in $(seq 1 50); do grep -q "Recording started" "$OUT/raw/$name.rec.log" 2>/dev/null && break; sleep 0.1; done
          python3 -c "import time; print(time.time())" > "$OUT/raw/$name.t0"
          TEST_RUNNER_KID_DEMO=$id xcodebuild test-without-building -project "$ROOT/ios/Agathon.xcodeproj" -scheme Agathon -destination "id=$SIM_UDID" \
            -derivedDataPath "$DD" -parallel-testing-enabled NO -only-testing:AgathonUITests/KidSessionUITests/testDemo \
            > "$OUT/logs/$name.log" 2>&1
          kill -INT $rec 2>/dev/null; wait $rec 2>/dev/null
          printf "  %s: %s\n" "$name" "$(grep -E "Test (case|Case) .*(passed|failed|skipped)" "$OUT/logs/$name.log" | tail -1 | sed -E "s/.*(passed|failed|skipped).*/\1/")"
        done
        # the player wrote its results in the app'"'"'s Documents
        data=$(xcrun simctl get_app_container "$SIM_UDID" app.agathon.ios data 2>/dev/null)
        [ -z "$data" ] && data=$(xcrun simctl get_app_container "$SIM_UDID" app.agathon.Agathon data 2>/dev/null)
        [ -n "$data" ] && mkdir -p "$OUT/results/$TAKE" && cp -R "$data/Documents/kid-sessions/demo-$TAKE/." "$OUT/results/$TAKE/" 2>/dev/null
        true'
    done ;;
  pictures)
    # the picture tutor's clips (scripts/demo-pen.py writes their scripts): PICTURES="p1-pizza p3-area"
    TEST_RUNNER_KID_PASSWORD=$(security find-generic-password -s "Agathon QA bench" -w) || { echo "no Keychain item 'Agathon QA bench'" >&2; exit 1; }
    export TEST_RUNNER_KID_PASSWORD
    python3 "$ROOT/scripts/demo-pen.py" --font "${FONT:-$OUT/fonts/EMSReadabilityItalic.svg}" --out "$OUT/scripts" $PICTURES || exit 1
    set -- $PICTURES
    while [ $# -gt 0 ]; do
      batch=""
      for _ in $(seq 1 "$BATCH"); do [ $# -gt 0 ] && { batch="$batch $1"; shift; }; done
      echo "picture demos:$batch → $OUT (take $TAKE)"
      BATCH_LIST=$batch ~/whiteboardstaging/sim-run.sh "$SIM" -- bash -c '
        xcrun simctl bootstatus "$SIM_UDID" >/dev/null 2>&1
        xcrun simctl status_bar "$SIM_UDID" override --time 9:41 --batteryState charged --batteryLevel 100 --wifiBars 3 --cellularMode notSupported
        xcodebuild test-without-building -project "$ROOT/ios/Agathon.xcodeproj" -scheme Agathon -destination "id=$SIM_UDID" \
          -derivedDataPath "$DD" -parallel-testing-enabled NO -only-testing:AgathonUITests/KidSessionUITests/test00SignIn \
          > "$OUT/logs/signin-$TAKE.log" 2>&1
        echo "  sign-in: $(grep -E "Test (case|Case) .*(passed|failed)" "$OUT/logs/signin-$TAKE.log" | tail -1 | sed -E "s/.*(passed|failed).*/\1/")"
        for id in $BATCH_LIST; do
          name="$id-$TAKE"
          rm -f "$OUT/raw/$name.rec.log"
          xcrun simctl io "$SIM_UDID" recordVideo --codec=h264 --force "$OUT/raw/$name.mp4" > "$OUT/raw/$name.rec.log" 2>&1 &
          rec=$!
          for _ in $(seq 1 50); do grep -q "Recording started" "$OUT/raw/$name.rec.log" 2>/dev/null && break; sleep 0.1; done
          python3 -c "import time; print(time.time())" > "$OUT/raw/$name.t0"
          TEST_RUNNER_PICTURE_DEMO="$OUT/scripts/$id.json" xcodebuild test-without-building -project "$ROOT/ios/Agathon.xcodeproj" -scheme Agathon \
            -destination "id=$SIM_UDID" -derivedDataPath "$DD" -parallel-testing-enabled NO \
            -only-testing:AgathonUITests/KidSessionUITests/testPictureDemo > "$OUT/logs/$name.log" 2>&1
          kill -INT $rec 2>/dev/null; wait $rec 2>/dev/null
          printf "  %s: %s\n" "$name" "$(grep -E "Test (case|Case) .*(passed|failed|skipped)" "$OUT/logs/$name.log" | tail -1 | sed -E "s/.*(passed|failed|skipped).*/\1/")"
        done
        data=$(xcrun simctl get_app_container "$SIM_UDID" app.agathon.ios data 2>/dev/null)
        [ -n "$data" ] && mkdir -p "$OUT/results/$TAKE" && cp -R "$data/Documents/picture-demos/demo-$TAKE/." "$OUT/results/$TAKE/" 2>/dev/null
        true'
    done ;;
  cut)
    for id in $DEMOS; do python3 "$ROOT/scripts/demo-video-cut.py" "$OUT" "$id" "$TAKE"; done ;;
  esac
done
