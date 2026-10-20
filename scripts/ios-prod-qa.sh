#!/bin/bash
# The iPad app against PRODUCTION on the simulator (docs/IPAD-HANDOFF.md, "Production QA"): one
# throwaway account `qa-ipad-<timestamp>@agathon.app`, made by the app's own first run, used for the
# kid's journey and the grown-up's places, then deleted by the app's own delete flow; whatever a
# failed step left is deleted as that account (rpc delete_own_account), and every table is checked
# for rows left.
#
#   scripts/ios-prod-qa.sh [build] [run] [cleanup]     (default: all three)
#   OUT=<folder>   shots, logs, results, accounts.txt (default: a temp folder)
#
# Never touches anyone else: the tests refuse any email that isn't qa-ipad-…@agathon.app, and the
# cleanup only ever signs in as that account. Real AI calls: about 15–25 (recognize, check, a hint,
# one Ask question). The simulator can't attest (App Attest), so the first run's try is typed.
set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=${OUT:-$(mktemp -d -t agathon-ios-prodqa)}
DD=${DD:-$OUT/dd}
SIM=${SIM:-"iPad Pro 11-inch (M5)"}
mkdir -p "$OUT/shots" "$OUT/results"
EMAIL=${PROD_QA_EMAIL:-qa-ipad-$(date +%Y%m%d-%H%M%S)@agathon.app}
PASSWORD=${PROD_QA_PASSWORD:-qa-$(openssl rand -hex 10)}
STEPS=${*:-build run cleanup}
ACCOUNTS="$ROOT/scripts/lib/prod-qa-accounts.sh"
echo "$EMAIL $PASSWORD" >> "$OUT/accounts.txt"
chmod 600 "$OUT/accounts.txt"
echo "QA account: $EMAIL (out: $OUT)"

export TEST_RUNNER_AGATHON_PROD_QA=1 TEST_RUNNER_PROD_QA_EMAIL=$EMAIL TEST_RUNNER_PROD_QA_PASSWORD=$PASSWORD
export TEST_RUNNER_PROD_QA_SHOTS=$OUT/shots
unset TEST_RUNNER_AGATHON_API_URL TEST_RUNNER_SUPABASE_URL TEST_RUNNER_SUPABASE_ANON_KEY

run() { # name, xcodebuild args… (inside sim-run)
  local name=$1; shift
  echo "=== $name"
  xcodebuild test-without-building -project "$ROOT/ios/Agathon.xcodeproj" -scheme Agathon -destination "id=$SIM_UDID" \
    -derivedDataPath "$DD" -parallel-testing-enabled NO -resultBundlePath "$OUT/results/$name-$(date +%H%M%S).xcresult" \
    "$@" 2>&1 | tee "$OUT/$name.log" | grep -E "Test Case .*(passed|failed)|error:|Executed" | tail -30
}
export -f run
export ROOT DD OUT

for step in $STEPS; do
  case $step in
  build)
    xcodebuild build-for-testing -project "$ROOT/ios/Agathon.xcodeproj" -scheme Agathon -destination "generic/platform=iOS Simulator" \
      -derivedDataPath "$DD" -parallel-testing-enabled NO -quiet || exit 1 ;;
  run)
    # a fresh install: the first run makes the account and keeps it; then the rest, in order; the last
    # one deletes it through the app
    TEST_RUNNER_PROD_QA_KEEP=1 ~/whiteboardstaging/sim-run.sh "$SIM" -- bash -c '
      xcrun simctl uninstall "$SIM_UDID" app.agathon.Agathon >/dev/null 2>&1
      run onboarding -only-testing:AgathonUITests/ProdOnboardingUITests
      "'"$ACCOUNTS"'" ids "'"$EMAIL"'" > "$OUT/ids.txt"; echo "ids: $(tr "\n" " " < "$OUT/ids.txt")"
      run app -only-testing:AgathonUITests/ProdQAUITests' ;;
  cleanup)
    # anything a failed step left: deleted as the account itself, then every table checked
    [ -s "$OUT/ids.txt" ] || "$ACCOUNTS" ids "$EMAIL" > "$OUT/ids.txt"
    "$ACCOUNTS" ids "$EMAIL" | grep -q . && "$ACCOUNTS" delete "$EMAIL" "$PASSWORD"
    if [ -s "$OUT/ids.txt" ]; then
      # shellcheck disable=SC2046
      "$ACCOUNTS" verify $(cat "$OUT/ids.txt") | tee "$OUT/verify.txt" | grep -E "LEFT|rows left"
    else
      echo "no account was made"
    fi ;;
  esac
done
