#!/bin/bash
# The iPad app's version and build number (docs/APP-STORE-LAUNCH.md, "Version and build numbers").
#
# ios/project.yml is the one source: MARKETING_VERSION is the version people see in the App Store
# ("1.0"), CURRENT_PROJECT_VERSION the build number App Store Connect needs to go up with every
# upload of that version. This edits project.yml and regenerates Agathon.xcodeproj (xcodegen), so
# Info.plist's $(MARKETING_VERSION) / $(CURRENT_PROJECT_VERSION) pick them up. It does not commit.
#
#   scripts/ios-bump-build.sh                 build number + 1                 (prints the new number)
#   scripts/ios-bump-build.sh 7               build number = 7 (must be higher than the last upload)
#   scripts/ios-bump-build.sh --version 1.0.1 a new version; the build number starts again at 1
#   scripts/ios-bump-build.sh --show          prints "1.0 (3)" and changes nothing
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
YML="$ROOT/ios/project.yml"

current_build() { sed -nE 's/^    CURRENT_PROJECT_VERSION: "?([0-9]+)"?$/\1/p' "$YML" | head -1; }
current_version() { sed -nE 's/^    MARKETING_VERSION: "?([0-9.]+)"?$/\1/p' "$YML" | head -1; }

build=$(current_build)
version=$(current_version)
[ -n "$build" ] && [ -n "$version" ] || { echo "ios-bump-build: no MARKETING_VERSION / CURRENT_PROJECT_VERSION in $YML" >&2; exit 1; }

case "${1:-}" in
  --show)
    echo "$version ($build)"; exit 0 ;;
  --version)
    new_version=${2:?"--version needs a value like 1.0.1"}
    [[ $new_version =~ ^[0-9]+(\.[0-9]+){1,2}$ ]] || { echo "ios-bump-build: '$new_version' is not like 1.0 or 1.0.1" >&2; exit 1; }
    sed -i '' -E "s/^    MARKETING_VERSION: .*/    MARKETING_VERSION: \"$new_version\"/" "$YML"
    new_build=1 ;;
  "")
    new_build=$((build + 1)) ;;
  *)
    [[ $1 =~ ^[0-9]+$ ]] || { echo "ios-bump-build: '$1' is not a whole number" >&2; exit 1; }
    new_build=$1
    if [ "$new_build" -le "$build" ]; then
      echo "ios-bump-build: $new_build is not higher than the current $build (App Store Connect refuses a build number it has seen)" >&2
      exit 1
    fi ;;
esac

sed -i '' -E "s/^    CURRENT_PROJECT_VERSION: .*/    CURRENT_PROJECT_VERSION: \"$new_build\"/" "$YML"
(cd "$ROOT/ios" && xcodegen --quiet)
[ "$(current_build)" = "$new_build" ] || { echo "ios-bump-build: project.yml didn't take the new build number" >&2; exit 1; }
echo "$new_build"
