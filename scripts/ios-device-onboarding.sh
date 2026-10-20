#!/bin/bash
# The whole first run against PRODUCTION on the owner's iPad (real App Attest, so the try is read and
# ticked by the server): fresh first run → hello → name → grade → the try (Debug's autowrite writes
# the answer) → the tick → the plan → hand back → the gate → the account (a throwaway
# qa-ipad-device-<timestamp>@agathon.app) → the trial's "Not now" (no App Store product yet) → the
# PIN → the kid's profile → the first board → the grown-up's PIN → the account deleted in the app.
# Then every production table is checked for rows of that account left (read-only SQL), and anything a
# failed step left is deleted as that account itself.
#
#   scripts/ios-device-onboarding.sh            build, install, run, check
#   scripts/ios-device-onboarding.sh build      build for an iPad only (checks it compiles and signs; no
#                                               iPad needed; DEST=device builds for the owner's)
#   FRESH_INSTALL=1 scripts/ios-device-onboarding.sh   uninstall the app first (loses anything kept only
#                                                       on this iPad: unsaved board backups)
#   DEVICE=<xcodebuild id>  DEVICECTL=<devicectl id>  OUT=<folder>
#
# On the iPad it: signs the app's current session out (on this iPad only: `-onboardingFresh`), starts
# the first run over, and leaves the app signed out at the end (the owner signs in again). It never
# changes the iPad's Settings. Run it only when the owner says the iPad is free, unlocked, on Wi-Fi,
# and with the screen kept awake. Real AI calls: the try's read and check (2–4).
set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd)
DEVICE=${DEVICE:-00008122-000E45D42298401C}
DEVICECTL=${DEVICECTL:-B734D02E-4AB7-5E09-89C4-7369EE3FB405}
OUT=${OUT:-$(mktemp -d -t agathon-ios-device)}
DD=${DD:-$OUT/dd}
ACCOUNTS="$ROOT/scripts/lib/prod-qa-accounts.sh"
mkdir -p "$OUT/shots" "$OUT/results"
COMMON=(-project "$ROOT/ios/Agathon.xcodeproj" -scheme Agathon -destination "platform=iOS,id=$DEVICE"
  -allowProvisioningUpdates -allowProvisioningDeviceRegistration -derivedDataPath "$DD" -parallel-testing-enabled NO)

if [ "${1:-}" = "build" ]; then
  # compile and sign for an iPad without one attached (the owner's when it is: DEST=device)
  DEST=$([ "${DEST:-generic}" = "device" ] && echo "platform=iOS,id=$DEVICE" || echo "generic/platform=iOS")
  xcodebuild build-for-testing -project "$ROOT/ios/Agathon.xcodeproj" -scheme Agathon -destination "$DEST" \
    -allowProvisioningUpdates -allowProvisioningDeviceRegistration -derivedDataPath "$DD" -parallel-testing-enabled NO -quiet &&
    echo "built for the iPad ($DEST): $DD"
  exit $?
fi

EMAIL=${PROD_QA_EMAIL:-qa-ipad-device-$(date +%Y%m%d-%H%M%S)@agathon.app}
PASSWORD=${PROD_QA_PASSWORD:-qa-$(openssl rand -hex 10)}
echo "$EMAIL $PASSWORD" >> "$OUT/accounts.txt"
chmod 600 "$OUT/accounts.txt"
echo "QA account: $EMAIL (out: $OUT)"
export TEST_RUNNER_AGATHON_PROD_QA=1 TEST_RUNNER_PROD_QA_EMAIL=$EMAIL TEST_RUNNER_PROD_QA_PASSWORD=$PASSWORD
export TEST_RUNNER_PROD_QA_SHOTS=$OUT/shots
unset TEST_RUNNER_PROD_QA_KEEP TEST_RUNNER_AGATHON_API_URL TEST_RUNNER_SUPABASE_URL TEST_RUNNER_SUPABASE_ANON_KEY

if [ "${FRESH_INSTALL:-0}" = "1" ]; then
  xcrun devicectl device uninstall app --device "$DEVICECTL" app.agathon.Agathon || true
fi

# the account's ids while it exists (the test deletes it at the end): asked every 10 s
( while true; do
    ids=$("$ACCOUNTS" ids "$EMAIL" 2>/dev/null)
    [ "$(printf '%s' "$ids" | grep -c .)" -gt "$(grep -c . "$OUT/ids.txt" 2>/dev/null || echo 0)" ] && printf '%s\n' "$ids" > "$OUT/ids.txt"
    sleep 10
  done ) &
WATCH=$!
trap 'kill $WATCH 2>/dev/null' EXIT

xcodebuild test "${COMMON[@]}" -resultBundlePath "$OUT/results/device-onboarding-$(date +%H%M%S).xcresult" \
  -only-testing:AgathonUITests/ProdOnboardingUITests/testFirstRunThenDelete 2>&1 | tee "$OUT/device.log" |
  grep -E "Test Case .*(passed|failed)|error:|Executed|\*\* TEST" | tail -20
kill $WATCH 2>/dev/null

# anything a failed step left: deleted as the account itself; then every table checked
if "$ACCOUNTS" ids "$EMAIL" | grep -q .; then
  "$ACCOUNTS" ids "$EMAIL" > "$OUT/ids.txt"
  "$ACCOUNTS" delete "$EMAIL" "$PASSWORD"
fi
if [ -s "$OUT/ids.txt" ]; then
  # shellcheck disable=SC2046
  "$ACCOUNTS" verify $(cat "$OUT/ids.txt") | tee "$OUT/verify.txt" | grep -E "LEFT|rows left"
else
  echo "no account was made (see $OUT/device.log)"
fi
echo "shots: $OUT/shots"
