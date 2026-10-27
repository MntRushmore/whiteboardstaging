#!/bin/bash
# Build the iPad app for the App Store and (with --upload) send it to App Store Connect
# (docs/APP-STORE-LAUNCH.md, "Uploading a build").
#
#   scripts/ios-release.sh                  bump the build number, archive, export Agathon.ipa (no upload)
#   scripts/ios-release.sh --upload         the same, then validate and upload it with an API key
#   scripts/ios-release.sh --no-bump        keep the build number in ios/project.yml as it is
#   scripts/ios-release.sh --build 12       set the build number to 12 first
#   scripts/ios-release.sh --archive-only   stop after the archive (no signing for distribution)
#
# Environment:
#   OUT=<folder>          where the archive, the .ipa and the logs go (default: build/ios-release/<version>-<build>)
#   DD=<folder>           DerivedData (default: $OUT/../DerivedData; keep it out of other worktrees')
#   ASC_KEY_ID            App Store Connect API key id        } needed for --upload; with all three set,
#   ASC_ISSUER_ID         its issuer id                       } signing talks to Apple with the key too,
#   ASC_KEY_PATH          the AuthKey_<id>.p8 file's path     } so no Apple ID is needed in Xcode
#                         Never commit the .p8 (keep it in ~/.appstoreconnect/private_keys, chmod 600).
#   UPLOAD_WITH=xcodebuild  upload by `xcodebuild -exportArchive` (destination upload) instead of altool
#
# What it checks on the way (and stops on): the Release entitlements say App Attest "production",
# the archive carries the privacy manifest and no StoreKit test file, the plist says
# ITSAppUsesNonExemptEncryption = NO and iPad only, and the exported app is signed for distribution
# (Apple Distribution, no get-task-allow).
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
IOS="$ROOT/ios"
TEAM=SG4YJW2K5Z
BUNDLE=app.agathon.ios

UPLOAD=0; BUMP=1; SET_BUILD=""; ARCHIVE_ONLY=0
while [ $# -gt 0 ]; do
  case $1 in
    --upload) UPLOAD=1 ;;
    --no-bump) BUMP=0 ;;
    --build) SET_BUILD=${2:?"--build needs a number"}; shift ;;
    --archive-only) ARCHIVE_ONLY=1 ;;
    -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
    *) echo "ios-release: unknown option $1" >&2; exit 2 ;;
  esac
  shift
done

say() { printf '\n== %s\n' "$*"; }
fail() { echo "ios-release: $*" >&2; exit 1; }

command -v xcodegen >/dev/null || fail "xcodegen is missing (brew install xcodegen)"

ASC_AUTH=()
if [ -n "${ASC_KEY_ID:-}${ASC_ISSUER_ID:-}${ASC_KEY_PATH:-}" ]; then
  [ -n "${ASC_KEY_ID:-}" ] && [ -n "${ASC_ISSUER_ID:-}" ] && [ -n "${ASC_KEY_PATH:-}" ] \
    || fail "ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_PATH go together"
  [ -f "$ASC_KEY_PATH" ] || fail "ASC_KEY_PATH: no file at $ASC_KEY_PATH"
  case "$ASC_KEY_PATH" in "$ROOT"/*) fail "the .p8 key is inside the repo ($ASC_KEY_PATH): move it out (~/.appstoreconnect/private_keys)";; esac
  ASC_AUTH=(-authenticationKeyPath "$ASC_KEY_PATH" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")
fi
if [ $UPLOAD = 1 ] && [ ${#ASC_AUTH[@]} = 0 ]; then
  fail "--upload needs ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_PATH (docs/APP-STORE-LAUNCH.md, 'The upload key')"
fi

# 1. the tree and the build number
if [ -n "$(git -C "$ROOT" status --porcelain -- ios)" ]; then
  echo "ios-release: note: ios/ has uncommitted changes; the build carries them" >&2
fi
if [ -n "$SET_BUILD" ]; then
  "$ROOT/scripts/ios-bump-build.sh" "$SET_BUILD" >/dev/null
elif [ $BUMP = 1 ]; then
  "$ROOT/scripts/ios-bump-build.sh" >/dev/null
else
  (cd "$IOS" && xcodegen --quiet)
fi
VB=$("$ROOT/scripts/ios-bump-build.sh" --show)
VERSION=${VB% (*}; BUILD=${VB##*(}; BUILD=${BUILD%)}
OUT=${OUT:-$ROOT/build/ios-release/$VERSION-$BUILD}
DD=${DD:-$(dirname "$OUT")/DerivedData}
mkdir -p "$OUT"
ARCHIVE="$OUT/Agathon.xcarchive"
say "Agathon $VERSION ($BUILD) → $OUT"

# 2. what must be true before Apple sees it
grep -q '<string>production</string>' "$IOS/Support/Agathon.entitlements" \
  || fail "ios/Support/Agathon.entitlements must set App Attest to production"
grep -q 'NSPrivacyAccessedAPITypes' "$IOS/Agathon/Resources/PrivacyInfo.xcprivacy" || fail "no privacy manifest"

# 3. the archive (Release, any iPad)
say "archive"
xcodebuild archive -project "$IOS/Agathon.xcodeproj" -scheme Agathon -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$ARCHIVE" -derivedDataPath "$DD" \
  -allowProvisioningUpdates ${ASC_AUTH[@]+"${ASC_AUTH[@]}"} DEVELOPMENT_TEAM=$TEAM AGATHON_COMMIT="$(git -C "$IOS/.." rev-parse --short HEAD)" \
  > "$OUT/archive.log" 2>&1 || { tail -40 "$OUT/archive.log"; fail "the archive failed (log: $OUT/archive.log)"; }

APP="$ARCHIVE/Products/Applications/Agathon.app"
PL="$APP/Info.plist"
pl() { /usr/libexec/PlistBuddy -c "Print :$1" "$PL" 2>/dev/null || true; }
[ "$(pl CFBundleIdentifier)" = "$BUNDLE" ] || fail "bundle id is $(pl CFBundleIdentifier), not $BUNDLE"
[ "$(pl CFBundleShortVersionString)" = "$VERSION" ] || fail "version is $(pl CFBundleShortVersionString), not $VERSION"
[ "$(pl CFBundleVersion)" = "$BUILD" ] || fail "build is $(pl CFBundleVersion), not $BUILD"
[ "$(pl ITSAppUsesNonExemptEncryption)" = "false" ] || fail "ITSAppUsesNonExemptEncryption must be NO"
[ "$(pl UIDeviceFamily:0)" = "2" ] && [ -z "$(pl UIDeviceFamily:1)" ] || fail "the app must be iPad only (UIDeviceFamily [2])"
[ -f "$APP/PrivacyInfo.xcprivacy" ] || fail "PrivacyInfo.xcprivacy is not in the app"
[ -z "$(find "$APP" -name '*.storekit')" ] || fail "a StoreKit test configuration is inside the app"
AENT=$(codesign -d --entitlements - --xml "$APP" 2>/dev/null || true)
grep -q 'appattest-environment</key><string>production' <<<"$AENT" || fail "the archived app's App Attest environment isn't production"
# every permission the code can ask for has its purpose string (a missing one crashes the app)
SYMS="$OUT/binary-strings.txt"
{ strings -a "$APP/Agathon"; nm -u "$APP/Agathon" 2>/dev/null; } > "$SYMS"
need_key() { # what the binary uses, the Info.plist key it needs
  if grep -q "$1" "$SYMS" && [ -z "$(pl "$2")" ]; then fail "the app uses $1 but Info.plist has no $2"; fi
}
need_key UIImagePickerController NSCameraUsageDescription
need_key AVAudioRecorder NSMicrophoneUsageDescription
need_key SFSpeechRecognizer NSSpeechRecognitionUsageDescription
need_key UIImageWriteToSavedPhotosAlbum NSPhotoLibraryAddUsageDescription
need_key CLLocationManager NSLocationWhenInUseUsageDescription
rm -f "$SYMS"
echo "archive ok: $(du -sh "$APP" | cut -f1) app, min iPadOS $(pl MinimumOSVersion)"
[ $ARCHIVE_ONLY = 1 ] && { echo "archive: $ARCHIVE"; exit 0; }

# 4. export for App Store Connect (re-signed for distribution)
say "export"
OPTS="$OUT/ExportOptions.plist"
cp "$IOS/ExportOptions.plist" "$OPTS"
if [ $UPLOAD = 1 ] && [ "${UPLOAD_WITH:-altool}" = xcodebuild ]; then
  /usr/libexec/PlistBuddy -c "Set :destination upload" "$OPTS"
fi
xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportOptionsPlist "$OPTS" -exportPath "$OUT/export" \
  -allowProvisioningUpdates ${ASC_AUTH[@]+"${ASC_AUTH[@]}"} > "$OUT/export.log" 2>&1 \
  || { tail -40 "$OUT/export.log"
         if grep -q "No Accounts" "$OUT/export.log"; then
           echo "ios-release: signing for the App Store needs Apple: sign in to Xcode › Settings › Accounts as the team's" >&2
           echo "  account holder, or set ASC_KEY_ID / ASC_ISSUER_ID / ASC_KEY_PATH (an Admin key) and run again with --no-bump." >&2
         fi
         fail "the export failed (log: $OUT/export.log)"; }
if [ "$(/usr/libexec/PlistBuddy -c 'Print :destination' "$OPTS")" = upload ]; then
  say "uploaded by xcodebuild: App Store Connect › TestFlight shows $VERSION ($BUILD) once Apple has processed it (5–30 min)"
  exit 0
fi
IPA="$OUT/export/Agathon.ipa"
[ -f "$IPA" ] || fail "no Agathon.ipa in $OUT/export"

# the exported app: signed for distribution
CHECK="$OUT/ipa-check"; rm -rf "$CHECK"; mkdir -p "$CHECK"
unzip -q "$IPA" -d "$CHECK"
EAPP="$CHECK/Payload/Agathon.app"
SIG=$(codesign -dvv "$EAPP" 2>&1 || true)
grep -q "Authority=Apple Distribution" <<<"$SIG" || fail "the .ipa isn't signed with Apple Distribution"
ENT=$(codesign -d --entitlements - --xml "$EAPP" 2>/dev/null || true)
if grep -q 'get-task-allow</key><true/>' <<<"$ENT"; then fail "the .ipa allows a debugger (get-task-allow)"; fi
grep -q 'appattest-environment</key><string>production' <<<"$ENT" || fail "the .ipa's App Attest environment isn't production"
rm -rf "$CHECK"
echo "export ok: $IPA ($(du -h "$IPA" | cut -f1))"

if [ $UPLOAD = 0 ]; then
  say "dry run done (no upload). To send it: scripts/ios-release.sh --upload --no-bump  (with the ASC_* variables)"
  exit 0
fi

# 5. validate, then upload (App Store Connect API key; the key never leaves this Mac)
say "validate"
xcrun altool --validate-app -f "$IPA" -t ios --api-key "$ASC_KEY_ID" --api-issuer "$ASC_ISSUER_ID" --p8-file-path "$ASC_KEY_PATH" \
  2>&1 | tee "$OUT/validate.log"
if grep -qiE "error|failed" "$OUT/validate.log" && ! grep -qi "No errors" "$OUT/validate.log"; then fail "validation failed (log: $OUT/validate.log)"; fi
say "upload"
xcrun altool --upload-package "$IPA" --api-key "$ASC_KEY_ID" --api-issuer "$ASC_ISSUER_ID" --p8-file-path "$ASC_KEY_PATH" \
  2>&1 | tee "$OUT/upload.log"
grep -qiE "UPLOAD SUCCEEDED|No errors uploading" "$OUT/upload.log" || fail "the upload didn't say it succeeded (log: $OUT/upload.log)"
say "uploaded: App Store Connect › TestFlight shows $VERSION ($BUILD) once Apple has processed it (5–30 min)"
echo "Commit the build number: git add ios/project.yml ios/Agathon.xcodeproj && git commit -m 'chore(ios): build $BUILD'"
