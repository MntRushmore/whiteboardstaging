#!/bin/bash
# The iPad app's integration QA against the LOCAL stack (docs/IPAD-HANDOFF.md, "The integration's QA"):
# the kid journey from a fresh install, the family switch, Today's practice, out of ink (kid and
# grown-up), the board's resilience (network lost and found through a cutting proxy, killed before the
# save, background, turning while Ask streams), the VoiceOver audit, and the design pass's shots.
#
# Needs: the local Supabase (`npm run db:start`; never reset it, it is shared), a dev server on
# $PORT (`APPLE_ENVIRONMENT=Xcode npx next dev -p 3901`: the app tests post Xcode-signed Apple
# purchases, which only a dev server with that setting takes), and ~/whiteboardstaging/sim-run.sh
# (one simulator at a time).
# Never touches production: the tests refuse any SUPABASE_URL that isn't the local stack.
#
#   scripts/ios-integration-qa.sh [steps…]     steps: build journey family ink resilience a11y design
#                                              (default: all of them, in that order)
#   OUT=<folder>  where shots and logs go (default: a temp folder)
set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd)
PORT=${PORT:-3901}
OUT=${OUT:-$(mktemp -d -t agathon-ios-qa)}
DD=${DD:-$OUT/dd}
SIM=${SIM:-"iPad Pro 11-inch (M5)"}
mkdir -p "$OUT/shots" "$OUT/results"
ANON=$(grep -E "^NEXT_PUBLIC_SUPABASE_ANON_KEY=" "$ROOT/.env.local" | cut -d= -f2-)
export TEST_RUNNER_AGATHON_INTEGRATION=1
export TEST_RUNNER_AGATHON_API_URL=http://localhost:$PORT
export TEST_RUNNER_SUPABASE_URL=http://127.0.0.1:54321
export TEST_RUNNER_SUPABASE_ANON_KEY=$ANON
export TEST_RUNNER_JOURNEY_STATE=$OUT/journey-email.txt
export TEST_RUNNER_JOURNEY_SHOTS=$OUT/shots
STEPS=${*:-build journey family ink resilience a11y design}

# A cold `next dev` compiles a route on its first call, slower than the app waits: compile them first.
warmup() {
  for r in /api/client-errors /api/family /api/email/welcome /api/app/attest/register /api/app/attest/challenge \
    /api/billing/apple/transaction /api/family/pin /api/family/switch /api/family/kids /api/start/ink /api/start/step \
    /api/live/speak /api/live/recognize /api/live/solve /api/live/ask /api/live/reread /api/live/setup /api/live/check \
    /api/live/transcribe /api/try/check /api/try/help /api/live/ask/memory /api/live/ask/history /api/live/ask/history/move; do
    curl -s -m 120 -o /dev/null -X POST -H 'content-type: application/json' -d '{}' "http://localhost:$PORT$r" &
  done
  wait
}

psqlq() { docker exec supabase_db_whiteboardstaging psql -U postgres -tAc "$1"; }

run() { # name, xcodebuild args… (inside sim-run)
  local name=$1; shift
  echo "=== $name"
  xcodebuild test-without-building -project "$ROOT/ios/Agathon.xcodeproj" -scheme Agathon -destination "id=$SIM_UDID" \
    -derivedDataPath "$DD" -parallel-testing-enabled NO -resultBundlePath "$OUT/results/$name-$(date +%H%M%S).xcresult" \
    "$@" 2>&1 | grep -E "Test Case .*(passed|failed)|error:|Executed" | tail -20
}
export -f run psqlq warmup
export ROOT DD OUT PORT

for step in $STEPS; do
  case $step in
  build)
    xcodebuild build-for-testing -project "$ROOT/ios/Agathon.xcodeproj" -scheme Agathon -destination "generic/platform=iOS Simulator" \
      -derivedDataPath "$DD" -parallel-testing-enabled NO -quiet || exit 1 ;;
  journey)
    warmup
    ~/whiteboardstaging/sim-run.sh "$SIM" -- bash -c 'xcrun simctl uninstall "$SIM_UDID" app.agathon.Agathon >/dev/null 2>&1;
      run journey -only-testing:AgathonUITests/KidJourneyUITests/test1Journey' ;;
  family)
    ~/whiteboardstaging/sim-run.sh "$SIM" -- bash -c 'run family -only-testing:AgathonUITests/KidJourneyUITests/test2FamilySwitch \
      -only-testing:AgathonUITests/KidJourneyUITests/test2bTodaysPractice' ;;
  ink)
    EMAIL=$(cat "$TEST_RUNNER_JOURNEY_STATE")
    psqlq "update profiles set ink_balance=0 where user_id=(select id from auth.users where email='$EMAIL')" >/dev/null
    TEST_RUNNER_JOURNEY_INK_EMPTY=1 ~/whiteboardstaging/sim-run.sh "$SIM" -- bash -c 'run ink \
      -only-testing:AgathonUITests/KidJourneyUITests/test3OutOfInkKid -only-testing:AgathonUITests/KidJourneyUITests/test4OutOfInkGrownUp'
    psqlq "update profiles set ink_balance=300 where user_id=(select id from auth.users where email='$EMAIL')" >/dev/null ;;
  resilience)
    rm -f "$OUT/netcut.flag"
    node "$ROOT/scripts/lib/netcut-proxy.mjs" "$OUT/netcut.flag" > "$OUT/netcut.log" 2>&1 &
    PROXY=$!
    sleep 1
    TEST_RUNNER_NETCUT_FLAG=$OUT/netcut.flag TEST_RUNNER_NETCUT_API_URL=http://127.0.0.1:3902 TEST_RUNNER_NETCUT_SUPABASE_URL=http://127.0.0.1:54329 \
      ~/whiteboardstaging/sim-run.sh "$SIM" -- bash -c 'run resilience -only-testing:AgathonUITests/BoardResilienceUITests'
    kill $PROXY; rm -f "$OUT/netcut.flag" ;;
  a11y)
    ~/whiteboardstaging/sim-run.sh "$SIM" -- bash -c 'run a11y -only-testing:AgathonUITests/BoardAccessibilityUITests' ;;
  design)
    for variant in landscape portrait split ax; do
      case $variant in
      portrait) export TEST_RUNNER_JOURNEY_PORTRAIT=1 TEST_RUNNER_JOURNEY_ARGS="" ;;
      split) export TEST_RUNNER_JOURNEY_PORTRAIT=0 TEST_RUNNER_JOURNEY_ARGS="-windowWidth 507" ;;
      ax) export TEST_RUNNER_JOURNEY_PORTRAIT=0 TEST_RUNNER_JOURNEY_ARGS="-UIPreferredContentSizeCategoryName UICTContentSizeCategoryAccessibilityXXXL" ;;
      *) export TEST_RUNNER_JOURNEY_PORTRAIT=0 TEST_RUNNER_JOURNEY_ARGS="" ;;
      esac
      TEST_RUNNER_JOURNEY_VARIANT=$variant ~/whiteboardstaging/sim-run.sh "$SIM" -- bash -c "run design-$variant -only-testing:AgathonUITests/DesignPassUITests"
    done ;;
  esac
done
echo "shots and results: $OUT"
