#!/bin/bash
# The REAL-INK bench (docs/TRAINING-CENTER.md, "Real handwriting"): children's own handwriting from the
# private corpus (outside every repo — this repo is public) through the real Live loop and the real
# routes, judged as a teacher would. `AgathonLiveTests/RealInkBenchTests` on the simulator, through the
# one-at-a-time sim-run.sh. Same server, mode, budget and cache rules as scripts/ios-bench.sh.
#
#   scripts/ios-realink-bench.sh [build] [run]          (default: both)
#
#   CASES=<file>   the corpus's bench cases (default ~/whiteboardstaging/agathon-corpus/bench/cases.json)
#   ONLY=<ids, id prefixes or tag:<tag>>   PACE=real|fast|line   CHECK=whenDone|asIGo
#   HOLD=<ms>   the wait before a ring or "?" on a line still being written (0: none; default the app's)
#   MODE=server|replay|oracle  SERVER=prod|local  OUT=<dir>  CACHE=<file>
#   MAX_RECOGNIZE=<n> MAX_OTHER=<n>   the budgets (default 0: no paid calls at all)
#   PARALLEL=<n>  LABEL=<name>  DD=<DerivedData>  SIM=<simulator name>
set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=${OUT:-$(mktemp -d -t agathon-realink)}
DD=${DD:-$HOME/whiteboardstaging/dd-realink}
SIM=${SIM:-"iPad Air 13-inch (M4)"}
MODE=${MODE:-server}
SERVER=${SERVER:-prod}
STEPS=${*:-build run}
mkdir -p "$OUT"

export TEST_RUNNER_AGATHON_REALINK=1
export TEST_RUNNER_AGATHON_REALINK_CASES=${CASES:-$HOME/whiteboardstaging/agathon-corpus/bench/cases.json}
export TEST_RUNNER_AGATHON_REALINK_ONLY=${ONLY:-}
export TEST_RUNNER_AGATHON_REALINK_PACE=${PACE:-real}
export TEST_RUNNER_AGATHON_REALINK_DEBUG=${DEBUG:-0}
export TEST_RUNNER_AGATHON_REALINK_CHECK=${CHECK:-whenDone}
export TEST_RUNNER_AGATHON_REALINK_HOLD=${HOLD:-}
export TEST_RUNNER_AGATHON_BENCH_MODE=$MODE
export TEST_RUNNER_AGATHON_BENCH_OUT=$OUT
export TEST_RUNNER_AGATHON_BENCH_CACHE=${CACHE:-$OUT/cache.json}
export TEST_RUNNER_AGATHON_BENCH_MAX_RECOGNIZE=${MAX_RECOGNIZE:-0}
export TEST_RUNNER_AGATHON_BENCH_MAX_OTHER=${MAX_OTHER:-0}
export TEST_RUNNER_AGATHON_BENCH_PARALLEL=${PARALLEL:-3}
export TEST_RUNNER_AGATHON_BENCH_LABEL=${LABEL:-realink-$MODE-$(date +%m%d-%H%M)}
unset TEST_RUNNER_AGATHON_API_URL TEST_RUNNER_SUPABASE_URL TEST_RUNNER_SUPABASE_ANON_KEY
if [ "$MODE" = server ]; then
  if [ "$SERVER" = local ]; then
    PORT=${PORT:-3971}
    export TEST_RUNNER_AGATHON_API_URL=http://localhost:$PORT
    export TEST_RUNNER_SUPABASE_URL=http://127.0.0.1:54321
    export TEST_RUNNER_SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY:-$(cd "$ROOT" && npx supabase status -o env 2>/dev/null | sed -n 's/^ANON_KEY="\(.*\)"$/\1/p')}
    export TEST_RUNNER_AGATHON_BENCH_EMAIL=${BENCH_EMAIL:-training-admin@example.com}
    export TEST_RUNNER_AGATHON_BENCH_PASSWORD=${BENCH_PASSWORD:-password123}
  else
    export TEST_RUNNER_AGATHON_BENCH_EMAIL=qa-bench@agathon.app
    TEST_RUNNER_AGATHON_BENCH_PASSWORD=$(security find-generic-password -s "Agathon QA bench" -w) || { echo "no Keychain item 'Agathon QA bench'" >&2; exit 1; }
    export TEST_RUNNER_AGATHON_BENCH_PASSWORD
  fi
fi
export ROOT DD OUT

for step in $STEPS; do
  case $step in
  build)
    xcodebuild build-for-testing -project "$ROOT/ios/Agathon.xcodeproj" -scheme Agathon -destination "generic/platform=iOS Simulator" \
      -derivedDataPath "$DD" -parallel-testing-enabled NO -quiet 2>&1 | grep -E "error:|BUILD FAILED" | head -30
    [ "${PIPESTATUS[0]}" = 0 ] || exit 1 ;;
  run)
    echo "real-ink bench → $OUT ($MODE, $SERVER, label $TEST_RUNNER_AGATHON_BENCH_LABEL)"
    ~/whiteboardstaging/sim-run.sh "$SIM" -- bash -c '
      xcodebuild test-without-building -project "$ROOT/ios/Agathon.xcodeproj" -scheme Agathon -destination "id=$SIM_UDID" \
        -derivedDataPath "$DD" -parallel-testing-enabled NO -only-testing:AgathonLiveTests/RealInkBenchTests \
        -resultBundlePath "$OUT/$TEST_RUNNER_AGATHON_BENCH_LABEL.xcresult" > "$OUT/$TEST_RUNNER_AGATHON_BENCH_LABEL.log" 2>&1
      grep -E "REALINK|Test .*(passed|failed)|error|issue" "$OUT/$TEST_RUNNER_AGATHON_BENCH_LABEL.log" | grep -v "^ *$" | head -80' ;;
  esac
done
