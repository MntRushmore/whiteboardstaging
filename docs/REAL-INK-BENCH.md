# The real-ink bench

Children's own handwriting, from production boards, through the iPad tutor: the closest thing to a
kid at the iPad without a kid at the iPad. It sits beside the synthetic bench (`TrainingBenchTests`,
docs/TRAINING-CENTER.md), which writes the catalogue in six made-up hands; this one writes what real
kids actually wrote — big, small, drifting, crossed out, side by side, answers at the top, their own
ticks and circles, "=" first, carries over the sum.

## Privacy — read this first

The ink is children's. This repo is **public**. So:

- The corpus lives only in `~/whiteboardstaging/agathon-corpus/` on the owner's machine, outside
  every repo. Nothing from it — strokes, renders, labels, what a kid wrote, ids — is ever committed,
  pasted into a PR, a doc, an issue or an artifact.
- It is pulled **read-only** and de-identified on arrival: random case and user ids; no titles,
  previews, emails or typed text. QA, demo and scripted (ruler-straight) ink is left out.
- Real ink goes only where the product already sends it: our own API (and so Mathpix).
- The repo's code reads the corpus only behind `AGATHON_REALINK=1` and stops, saying so, when it is
  absent. Regression fixtures for what it finds are **re-drawn in a synthetic hand**, never real ink.
- Delete the folder when the work is done or when asked.

## The pieces

| Piece | Where |
| --- | --- |
| pull (read-only), cluster into attempts, render sheets, export | `scripts/realink/*.py` (tools only, no data) |
| hand labels: each line's LaTeX and what a teacher wants (tick / calm / quiet / ring + right value) | `agathon-corpus/labels.txt` (private) |
| bench cases (strokes in writing order, real pauses, scaled so a glyph is ~52 page units) | `agathon-corpus/bench/cases.json` (private) |
| the suite | `ios/Packages/AgathonLive/Tests/AgathonLiveTests/RealInkBenchTests.swift` |
| the runner | `scripts/ios-realink-bench.sh` |

An attempt is a kid's ink inside one of the web tutor's problem cells (the problem comes with it),
else a loose cluster on their own page. Each attempt is written on a fresh problem page of a test
board with the real loop: stroke by stroke where the kid put it (relative to the work area), with the
kid's own pause before each stroke where the board kept timing (`meta.t`/`t1`, capped at 5 s), a
kid's pace where it did not; then Check. Ink no labeled line owns (a stray, a doodle, the kid's own
tick or circle) is written too, but not judged — except that a ring on it counts as a stray ringed.

## Running it

```bash
# free: perfect reads (the tutor's logic alone) and a count of the calls a server run would make
MODE=oracle scripts/ios-realink-bench.sh
# production, as qa-bench@agathon.app (training calls: no ink spent), within a budget, cached
MODE=server MAX_RECOGNIZE=300 MAX_OTHER=150 CACHE=~/whiteboardstaging/agathon-corpus/runs/cache.json \
  OUT=~/whiteboardstaging/agathon-corpus/runs scripts/ios-realink-bench.sh
# again, for free, after a fix: the cache alone
MODE=replay CACHE=… scripts/ios-realink-bench.sh
# a slice
ONLY=tag:stacked-sum,tag:annotations scripts/ios-realink-bench.sh run
# check as I go, with and without the wait before a ring or "?" on a line still being written
CHECK=asIGo MODE=replay CACHE=… scripts/ios-realink-bench.sh run
HOLD=0 CHECK=asIGo MODE=replay CACHE=… scripts/ios-realink-bench.sh run
```

The wait (`PageTiming.doubtHoldMs` / `LIVE_TIMING.doubtHoldMs`, 2.5 s) comes from the corpus's own
timing: kids' pauses inside a line are p90 1.3 s, p95 2.4 s. On 2026-10-22 (all 208 cases, check as I
go) it took rings on half-written lines from 55 to 14; what is left follows pauses longer than it.

Keep `OUT` inside the corpus folder: the results name what kids wrote.

## What it reports

Ranked by what a kid feels:

1. **Rings on right work** (and strays ringed) — the worst thing the tutor can do.
2. **Missed slips** — a wrong line left alone.
3. **"?" on right work** — the tutor could not read it.
4. Lines judged right, read right, kept as one line; pages solved as expected; read and mark
   latency after pen-up.

Every piece a labeled line became is looked at, not just the main one, so a line split in two with a
ring on one half still counts as a ring on right work.
