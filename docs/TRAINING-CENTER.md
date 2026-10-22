# The Training Center (iPad, admins only)

2026-10-20, branch `feat/ipad-training`. The owner's ask: "a training center for me where we can
brute-test the AI whiteboard to make sure it all works with real math". Then: "I will do the math and
try different handwritings! also we need ... a different page for each problem".

**Where:** Account → **Training Center**. The tab only shows when `is_admin()` says so, and never for
a kid profile. In a Debug build it is also under Labs → "Training Center".

The Center works on the real board (the Blocks editor, problem pages, "I read", Check), with the real
tutor (the Live loop, the desk that writes problems on their own pages), and through the real routes
of whichever backend the build calls (production by default; the local stack when the scheme points
there). The Center names the target in a pill: Production (tomato) or Local (cobalt).

## My Pencil

1. **Start writing.** Each page holds one problem:
   - **a generated problem.** Pick a grade (K-2 … HS) and a topic. The tutor writes a problem from
     the brain's practice generator at the top of a fresh page.
   - **My own problem.** A blank page with the page template. The first line written is the problem.
2. **Handwriting** in the top bar: Neat, Fast, Messy, Big kid letters, Small, Slanted, Left-handed,
   or Other (your own words). A page keeps the tag it had when its first line was written. A tag
   picked after that applies to the next page, and the pill says "(next page)".
3. **Write** with the Pencil. Every tutor feature is on: When done checking, the answer spot, Check,
   "I read", hints.
4. Once the tutor has answered a line (marked it, or checked it and left it), a strip asks about it:
   - 👍 means it was right.
   - 👎 asks what it should have done: **Tick it / Leave it / Ring it / Read it as…** (type the right
     LaTeX), plus an optional note.
   - **Lines n/m** lists every line on the page, with its read, its mark and its review.
5. **Next** saves the page and opens a fresh one: a new problem, or a blank page of your own.
6. Each page is saved as a `training_cases` row: the strokes, every recognizer answer, the
   verdicts, the marks, the reviews, the tag, and a snapshot of any page with a 👎. Results (from
   the Runs list) give accuracy by handwriting style, by problem and by grade, the read latency,
   and the calls.

## The auto bench

**Set up a bench** lets you choose:
- grades, and the kinds of writing
- hands: clean, slanted, steep, messy (the web scoreboard's four), big, small
- the number of cases (up to 40)
- the kid's pace: brisk, typical or slow
- when the tutor checks: when they're done, or as they go
- right and deliberately wrong solutions
- the brain's practice problems
- a call budget

Before it starts, the setup asks the server whether it takes training calls. A server that does not
(an older web deployment) would charge your ink. The screen says so, and only starts if you switch
on "Run anyway and spend my ink".

For each case the bench works like this:
1. It opens a fresh problem page. The tutor writes the problem at the top through the desk, or the
   page is left blank for a kid's own problem.
2. It writes each line in the case's synthetic hand, through the canvas's touch path, at a kid's
   pace (`KidPace`). Lines go on the guide lines, in the answer spot, or beside the line before.
   Some lines are rubbed out with the eraser or crossed out first, as the case says.
3. It lets the reads land, then taps Check.
4. It reads what the tutor did with each line off the loop and the board: which tutor line(s) the
   strokes became, the read with its provider and confidence, the "I read" state, the engine's
   verdict and value, the mark, and whether the line is still held. It then judges them
   (`TrainingJudge`).
5. It stops at the budget, on Stop, or when the board is full (50 pages).

**Results** show:
- pages and lines right, and reads as written
- pen up → read, and Check → marks, at p50 and p90
- the calls, and the ink they would have cost
- rings on right work, and slips not ringed
- tables by kind of writing, by hand and by grade
- why lines failed
- every failure: the page as it looked, written vs read vs expected vs done, and why

Each failure can be **run again** (a fresh page, the same hand) or **saved as a regression test**.

### The catalogue (134 cases)

`AgathonLive/Training/TrainingCatalogue.swift` holds how kids really write. Each case is a problem
page with what a teacher wants of each line:
- `tick`
- `quiet` (no mark)
- `ring`, with the right value when there is one
- `calm` (a tick or no mark, never a ring)

A line carried on from a ringed slip gets no mark of its own, so it is `quiet`. The cases come in
right versions and deliberately wrong ones (43 wrong). The categories are:

- running totals (the owner's `+3 = 767`)
- `=` on the next line (the owner's `= 431` under `767 − 336`)
- chains
- multi-step equations
- true steps that are not the answer
- facts
- fractions
- mixed numbers
- decimals
- negatives
- exponents
- order of operations
- word-problem setups
- long division (the bracket as a stack)
- stacked and column sums
- rewrites and corrections (a slip put right, rubbed out, crossed out)
- a kid's own tick
- spacing quirks (`2 x=8`, wide `=`, indented work, side work)
- the kid's own problem

The bench mixes in the brain's own practice problems (`TrainingGenerator`):
- the worked steps come from `localSolve`;
- the right version has its last step in the answer spot;
- the slip version has that answer off by one.

### The hands

`StudentHand` is the web scoreboard's `handInk` (src/__eval__/handwriting.ts) in Swift:
- the glyphs come from the brain's `layoutMath`;
- `mulberry32`, the warp, the slant, the tilt and the per-stroke nudge are ported exactly. The tests
  hold it to `kid-hands.json` to 0.01 for every line and hand.

The result is then scaled to a kid's size (1.6×; big 2.1×, small 1.15×). None of it is a real
child's writing.

## Cost

Every paid call from the Center carries `"training": true`. On a server with the training pass
(src/lib/server/training.ts):
- **Who:** only admins (`adminStatus`; a non-admin gets 403 `forbidden`).
- **Ink:** spends no ink and does not count toward fair use (`enforceInk` and the refunds skip it).
- **Rate limits:** liveTraining, 180 calls a minute per admin, and liveTrainingDay, 4000 a day.
- **Logging:** each call is an `app_events` row with code `training_call`.

`GET /api/training/status` (admins only) is how the app tells this server from an older one.

On the iPad side, `TrainingServices` makes a call fail at once once the run's budget is spent, so a
run never costs more than the budget set. Results show what the calls would have cost in ink
without the pass.

## Storage

- **Tables:** `training_runs` and `training_cases`, from
  `supabase/migrations/20261020000000_training_center.sql`.
- **Access:** RLS through `is_admin()`. Only admins read or write, an insert must be the admin's own
  row, and the service role has everything.
- **Data:** only admins' own writing and synthetic hands, never kids' data.
- **On the iPad:** every run is also kept as JSON (`TrainingStore`, Application Support/Training).
  Without the tables (the migration not applied yet) the run stays there, and the run says "Kept on
  this iPad".

## Regression tests

"Save as regression test" does three things:
- it flags the row (`regression`, with `fixture`, the case as JSON);
- it offers the fixture to share;
- in a Debug build on the simulator, it writes the fixture straight into
  `ios/Packages/AgathonLive/Tests/AgathonLiveTests/Fixtures/training/`.

`npm run training:fixtures` pulls the flagged rows into that same folder. It reads the local stack
by default; `--prod` needs explicit credentials.

`TrainingFixtureTests` replays every fixture through the loop:
- the page is set up as it was;
- the strokes go where they were written;
- the recognizer answers with the reads recorded when the case ran (no Mathpix);
- each line is judged as the bench judged it.

A fixture with status `open` is a known issue: the test says so when it starts passing, and then
someone flips it to `fixed`. A `fixed` fixture must stay passing.

## Running it

- **On the owner's iPad:** Account → Training Center → My Pencil, or Set up a bench (start with the
  default: 12 cases, clean and messy, 60 calls).
- **The UI tests** (local stack only):
  ```
  TEST_RUNNER_AGATHON_INTEGRATION=1 TEST_RUNNER_AGATHON_API_URL=http://localhost:3961 \
  TEST_RUNNER_SUPABASE_URL=http://127.0.0.1:54321 TEST_RUNNER_SUPABASE_ANON_KEY=<anon> \
  TEST_RUNNER_AGATHON_TEST_EMAIL=training-admin@example.com TEST_RUNNER_AGATHON_QA_SHOTS_DIR=<dir> \
  xcodebuild test-without-building … -only-testing:AgathonUITests/TrainingCenterUITests
  ```
  The local admin `training-admin@example.com` (password123) has 0 ink, so a call the training pass
  did not take would fail with 402.
- **Debug launch arguments:**

  | Argument | What it does |
  |---|---|
  | `-lab training` | opens the Training Center |
  | `-trainingOpen pencil\|bench` | goes straight into My Pencil or the bench setup |
  | `-trainingSource own\|<grade>:<skill>` | where My Pencil's problems come from |
  | `-trainingSeed n` | the seed for generated problems |
  | `-trainingStyle messy` | the handwriting tag to start with |
  | `-trainingAutowrite "steps\|answer\|slip\|answer:x = 4\|problem:3x - 5 = 10\|<latex>"` | My Pencil's autowrite button: the simulator has no Pencil |
  | `-trainingHand messy` | the synthetic hand the autowrite writes in |
  | `-trainingBench "count=6;budget=24;hands=clean,messy;pace=brisk;seed=5;grades=K-2,3-4;wrong=1;generated=0"` | fills in the bench setup |

## The headless bench

2026-10-21, branch `feat/ipad-blitz`. The auto bench without the UI, for benches at scale:
`AgathonLiveTests/TrainingBenchTests` drives the real Live loop on a test board through the real
routes of a server. There is no canvas and no kid's pace: a line's strokes go down at once and the
loop's clock is moved by hand, so the network is the only wait. The whole catalogue in six hands
takes about 20 minutes against production.

It shares the in-app bench's code:
- the cases (`TrainingCatalogue`, `TrainingGenerator`);
- the hands (`StudentHand`, which now draws a stacked sum's bars: the hand's layout left out `\hline`);
- where a line goes (`TrainingBench.origin`);
- what the tutor did (`TrainingBench.observe`) and the judging (`TrainingJudge`).

The page is set up the way the desk writes a practice page (the desk's check, then the tutor's hand at
72 down to 32). The regression fixtures replay through the same page setup, so a failure saved from a
headless run replays exactly.

```
scripts/ios-bench.sh [build] [run]
  MODE=server|replay|oracle  SERVER=prod|local  OUT=<dir>  CACHE=<file>
  HANDS=clean,slanted,steep,messy,big,small  CASES=all|<ids or prefixes>
  PRACTICE=<n> GRADES=K-2,3-4,5-6,7-8  MAX_RECOGNIZE=<n> MAX_OTHER=<n>  HINTS=local|server  PARALLEL=<n>
```

- **server:** the routes, with every answer kept in `CACHE`. A later run asks the server only about
  ink it has never seen, so a bench after a fix costs only what the fix changed. It refuses to start
  unless `GET /api/training/status` says the server takes training calls.
- **replay:** the cache alone, at no cost. A miss is read as unreadable, and the run counts the misses.
- **oracle:** no server. A line is read as exactly what was written, when its strokes are whole
  written lines. This shows the tutor's logic with perfect reads, and counts the reads a server run
  would make.

The budgets (reads, and everything else) refuse a call once spent. A ringed slip's hint is worded by
the loop (`HINTS=local`) unless asked otherwise, because the bench judges marks, not hint words.

Each run writes these files to `OUT`:
- `<label>-summary.txt`: lines and pages right by kind of writing, hand and grade, the failure classes
  and every failure;
- `<label>-run.json`: the `TrainingRun`;
- `<label>-calls.json`;
- `fixtures/`: a regression fixture for every failure.

### Results (production, the whole catalogue in six hands + 20 practice problems)

| run | pages right | lines right | rings on right work (report) | every ring on a right line* | calls |
|---|---|---|---|---|---|
| `prod-before` (2026-10-21, `68b0c57`) | 607/824 (73.7%) | 1193/1385 (86.1%) | 23 | 36 | 1140 reads, 6 re-reads |
| `prod-after` (2026-10-22, `b3bc48ac`) | 710/824 (86.2%) | 1298/1385 (93.7%) | 1 | 9 | 0 reads (all cached), 128 re-reads |
| `prod-after` replayed with the `lost-numerator` check (production's own answers, no calls) | 710/824 (86.2%) | 1298/1385 (93.7%) | 1 | 7 | none |

\* The report's count leaves out a ring it blames on a misread (`misread`); this column counts every
ring on a line that wants a tick, no mark or quiet. Reads right stayed 91–92%, since the same ink was
read from the cache. The seven left: one on a wrong answer whose slip line was merged (`rt-767-slip`,
big), and six misreads in the messy and steep hands that the second look could not fix (`= 47` read
`-97`, `8` read `0`, `2.75` read `275`, a stacked `138` read `130`).

What moved it, by kind of writing: stacked sums 0% → 89% (pages), their own problem 33% → 100%, long
division 53% → 83%, a kid's own tick 56% → 89%, running totals 67% → 90%, rewrites 79% → 100%, negatives
69% → 80%. The fixes:

- `a1ee1a9a`: stacked sums worked as sums, the board's flush (cells, mates, strays), division bars, and a
  child's numbers read as words (`\text{ 767-336 }`, a tick read as `\sqrt{}`);
- `9f07114c`: the answer spot is the work's last step, a page of the kid's own heads its work, two facts
  side by side and an `=` read as a minus are never ringed (`ArithmeticTruth.trueAsMeant`);
- `c6cae954`: a crossed-out line is never judged (`StruckLine`), and a ring waits for a second look at
  the step and the line above it (`LiveLoop+Chain`, the web's `holdRing`);
- the `lost-numerator` read check (web and iPad): `\bar{2}=\bar{6}` for `\frac{1}{2} = \frac{3}{6}` is
  not believed (it made the only two new rings in `prod-after`).

Still open (each a fixture marked open, `TrainingFixtureTests`): word problems (30 pages: the desk will
not write `\text{}` problems on a page), side-by-side facts kept as one line (deliberate, as on the
web), a big hand's two rows clustered as one, a steep hand's fractions and a lone answer cut in two,
misreads the second reader cannot fix (`2.75` read `275`, `8` read `0`), and `3x + 4 - 2x = x + 4`
ticked.

### The QA account (production)

The bench signs in to production only as **`qa-bench@agathon.app`**, an admin made for benches
(2026-10-21):
- signed up through the auth API;
- added to `public.admins` through the Management API;
- its password is in the macOS Keychain: service "Agathon QA bench", account `qa-bench@agathon.app`,
  never in git.

Training calls from it spend no ink. Its rows are training rows only (`app_events` `training_call`).
Keep it.
