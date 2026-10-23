#!/bin/bash
# The HEADLESS bench (docs/TRAINING-CENTER.md, "The headless bench"): the Training Center's auto bench
# without the UI — every catalogue case in every synthetic hand, and the brain's practice problems,
# through the real Live loop and the real routes of a server, judged by the in-app bench's own code.
# `AgathonLiveTests/TrainingBenchTests` on the simulator, through the one-at-a-time sim-run.sh.
#
#   scripts/ios-bench.sh [build] [run]            (default: both)
#
#   MODE=server|replay|oracle   server (default): the routes, cache first; replay: the cache alone;
#                               oracle: perfect reads, no server (triage, and counting a run's calls)
#   SERVER=prod|local           prod (default): www.agathon.app as qa-bench@agathon.app (the password is
#                               in the macOS Keychain, service "Agathon QA bench"); local: the dev server
#                               on PORT (default 3971) and the local Supabase, as training-admin@example.com
#   OUT=<dir>                   results (default: a temp folder); CACHE=<file> answers kept between runs
#   HANDS=clean,slanted,steep,messy,big,small   CASES=all|none|<ids or prefixes>
#   PRACTICE=<n> GRADES=K-2,3-4,5-6,7-8 PRACTICE_HANDS=deal|every SEED=<n>
#   MAX_RECOGNIZE=<n> MAX_OTHER=<n>   the budgets (default 0: no paid calls at all)
#   HINTS=local|server  PARALLEL=<n>  LABEL=<name>  DD=<DerivedData>  SIM=<simulator name>
#
# Production: training calls spend no ink (admins only), and the bench refuses to start unless the
# server says it takes them (GET /api/training/status). It never signs in as anyone but the QA account.
set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=${OUT:-$(mktemp -d -t agathon-bench)}
DD=${DD:-$HOME/whiteboardstaging/.dd-blitz}
SIM=${SIM:-"iPad Air 13-inch (M4)"}
MODE=${MODE:-server}
SERVER=${SERVER:-prod}
STEPS=${*:-build run}
mkdir -p "$OUT"

export TEST_RUNNER_AGATHON_BENCH=1
export TEST_RUNNER_AGATHON_BENCH_MODE=$MODE
export TEST_RUNNER_AGATHON_BENCH_OUT=$OUT
export TEST_RUNNER_AGATHON_BENCH_CACHE=${CACHE:-$OUT/cache.json}
export TEST_RUNNER_AGATHON_BENCH_HANDS=${HANDS:-clean,slanted,steep,messy,big,small}
export TEST_RUNNER_AGATHON_BENCH_CASES=${CASES:-all}
export TEST_RUNNER_AGATHON_BENCH_PRACTICE=${PRACTICE:-0}
export TEST_RUNNER_AGATHON_BENCH_GRADES=${GRADES:-K-2,3-4,5-6,7-8}
export TEST_RUNNER_AGATHON_BENCH_PRACTICE_HANDS=${PRACTICE_HANDS:-deal}
export TEST_RUNNER_AGATHON_BENCH_SEED=${SEED:-1}
export TEST_RUNNER_AGATHON_BENCH_MAX_RECOGNIZE=${MAX_RECOGNIZE:-0}
export TEST_RUNNER_AGATHON_BENCH_MAX_OTHER=${MAX_OTHER:-0}
export TEST_RUNNER_AGATHON_BENCH_HINTS=${HINTS:-local}
export TEST_RUNNER_AGATHON_BENCH_PARALLEL=${PARALLEL:-3}
export TEST_RUNNER_AGATHON_BENCH_LABEL=${LABEL:-bench-$MODE-$(date +%m%d-%H%M)}
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
    echo "bench → $OUT ($MODE, $SERVER, label $TEST_RUNNER_AGATHON_BENCH_LABEL)"
    ~/whiteboardstaging/sim-run.sh "$SIM" -- bash -c '
      xcodebuild test-without-building -project "$ROOT/ios/Agathon.xcodeproj" -scheme Agathon -destination "id=$SIM_UDID" \
        -derivedDataPath "$DD" -parallel-testing-enabled NO -only-testing:AgathonLiveTests/TrainingBenchTests \
        -resultBundlePath "$OUT/$TEST_RUNNER_AGATHON_BENCH_LABEL.xcresult" > "$OUT/$TEST_RUNNER_AGATHON_BENCH_LABEL.log" 2>&1
      grep -E "BENCH|Test .*(passed|failed)|error|issue" "$OUT/$TEST_RUNNER_AGATHON_BENCH_LABEL.log" | grep -v "^ *$" | head -60' ;;
  esac
done
