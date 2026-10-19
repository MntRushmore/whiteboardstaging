# iPad: a faster tutor, Apple Intelligence, Math Notes (the FAST lane)

2026-10-18, branch `feat/ipad-fast` (off `feat/ipad-app`). The owner's ask: "now that it's iPad native,
can we use Apple Intelligence or something to make the math engine faster, or borrow what
Calculator's Math Notes has?", with the rule "see where we can use it best WITHOUT making the app too
complicated or slower".

Where the time goes (the tutor lane's measurement, confirmed here): pen-up → tick ≈ 1.0–1.1 s =
the 600 ms quiet gate + ≈ 400 ms recognize round trip (Mathpix through `/api/live/recognize`) + a few
ms of maths. The maths engine is not the bottleneck; waiting is. Help me → the first words of a hint
≈ 1.3–2.5 s (the server's check model).

## 1. Reading early (shipped, on by default)

`AgathonLive/Loop/LiveLoop+ReadEarly.swift`, `Logic/ReadEarly.swift` (`PenRhythm`, `LineShape`).

The read starts as soon as a line looks finished instead of 600 ms after the last stroke:

- **The Pencil hovers away from the line** (iPads and Pencils that report hover, such as the owner's
  iPad Air M3 with an Apple Pencil Pro or USB-C, iPad Pro M2/M4, the A17 Pro mini; a trackpad
  pointer too): read at once.
  `CanvasLiveBoard` reports hover through a `UIHoverGestureRecognizer` (it never touches drawing).
- **A pause on a line that looks finished:** the stroke just written ends the line's ink on the
  right, and the line is a relation whose right side is under way (`2x = 8`; an `=` is two stacked
  flat bars). In Solve, or with the grown-ups' "answer after =", a line that ends with its `=` counts
  too (`36 + 2 =`). The pause is a little longer than nine in ten of this kid's own pauses inside a
  line (200–450 ms; 450 ms until their rhythm is known; never for a kid whose long pauses are longer).
  Anything else (no `=`, a stroke that went back left, a growing right side) waits for the gate.

Nothing is read twice: the reply goes into the payload-hash cache; if the gate runs out first, its
read waits for the early one (`earlyReply`); if the early read lands first and the kid has not
written since, the gate is let off at once. New ink in that line cancels the early read and drops its
reply; ink elsewhere keeps it for the gate. Early reads respect the 2-slot limiter (they never queue),
and never run offline, rate limited, out of ink, signed out, or with the vision reader. A failed early
read is the gate's answer (no second call). The 600 ms gate is unchanged as the fallback, and
`LiveLoop.readsEarly = false` turns all of it off.

Also: the first pen-down after a minute with no call warms the road with the free capabilities GET
(the connection, the function and the sign-in cache are warm by the time the line is read). Not
measurable locally (no cold starts on `next dev`).

### Numbers

Replayed hands (`ReadEarlyBench`): the loop on the real clock, the four fixture hands written stroke by
stroke at a kid's pace (`KidPace`: pauses inside a glyph, between glyphs, before the answer after an
`=`, between lines — assumptions, not measurements of children), the recognizer a fake answering in
400 ± 60 ms. 12 right chains per row (36 lines, 24 ticks). "Hover" moves the hovering pen down to the
next line from 40 ms after the line's last stroke.

| pace | gate only (before) | reading early, no hover | reading early + hover |
| --- | --- | --- | --- |
| brisk | tick p50 1034 / p90 1100 ms · 1.11 calls/line | **805** / 954 · 1.11 | **589** / 663 · 1.17 |
| typical | 1071 / 1125 · 1.56 | 1023 / 1124 · 1.56 | **598** / 676 · 1.56 |
| slow | 1052 / 1154 · 2.92 | 1051 / 1108 · 3.03 | **579** / 687 · 3.08 |

What it says:

- **With hover the tick comes in about half the time** (≈1.05 s → ≈0.59 s) at every pace, with no
  more reads than before at a typical pace (+0.06 brisk, +0.17 slow; the slow ones are first lines,
  read before the kid's rhythm is known).
- **Without hover the gain is small**, because the only safe wait is the kid's own long pause: a
  brisk writer's ticks come ≈22 % sooner, a typical or slow writer's about as before (their long
  pauses inside a line are near the gate itself, so the pause trigger mostly stays off). Zero extra
  reads at brisk and typical pace.
- **A short fixed wait is fast and wasteful** (typical pace, no hover): 150 ms → 580 ms ticks but 2.14
  calls/line (+37 %); 200 ms → 616 ms, 2.03 (+30 %); 250 ms → 671 ms, 1.97 (+27 %). Every multi-digit
  answer (`11`, `15`) gets read half-written. Not shipped; the adaptive wait keeps reads level.

Real reads (`ReadEarlyRealBench`, local stack, real Mathpix, 18 recognize calls in all): one chain in
two hands at a typical pace, no hover. The route answered in 240–390 ms (p50 ≈ 285 ms on localhost).
Gate only: pen-up → read p50 957 ms, → tick p50 926 ms; reading early: 906 / 932 ms (the pause
trigger did not fire at this pace, as above); 1.5 calls/line both. The bench's `wrong` column counts
Mathpix's own spelling (`2 x+3=11`), not wrong marks.

Found on the way (not changed): a slow writer's quiet gate reads a line ≈3 times (every pause of
600 ms or more mid-line, mostly before the answer after `=`, reads the half line). Deferring the read
of a line that ends in a bare `=` when no answer is wanted (`LineShape` can tell) would cut those
reads (ink and money) without slowing a tick. A follow-up.

How to run: `TEST_RUNNER_LIVE_BENCH=1 xcodebuild test-without-building -scheme AgathonLive
-only-testing:AgathonLiveTests/ReadEarlyBench …` (≈4 min); the real one needs `next dev` on the local
stack (see the test's comment). On a device, the Live Lab's pace picker (`-liveLabPace typical`) and
its stats line show the same numbers live.

## 2. Apple Intelligence (evaluated; kept behind a debug switch, not shipped to kids)

**Verdict: not shipped to kids. Behind the Live Lab's "iPad hint words" switch for the owner to try.**

Where it could fit, and the only place it does: the words of a hint for a step the **engine** has
already found wrong (a ring) when the kid taps Help me in Hint. The engine decided what is wrong; the
model would only say where to look, so the server's check (3 ink, ≈2 s) would not be needed for it.
`Services/HintWording.swift`: the engine's facts in (the step before, the kid's step, which side
differs from the engine's next step — never the answer itself), one sentence out, then rules before a
kid sees it (`HintWording.accept`: 3–22 words, never "wrong", no LaTeX, no number the kid did not
write — so never the answer and no arithmetic of its own; "!" becomes "."). Anything refused, slow
(1.5 s) or unavailable goes to the server's check as today. The writer is weak-linked
(`FoundationModels` is `LC_LOAD_WEAK_DYLIB`), gated by `#available(iOS 26)` and
`SystemLanguageModel.default.availability`, made only when the switch is on, and prewarmed when the
first ring is drawn, not at launch.

Why not shipped:

- **It could not be measured here.** This Mac (M4, macOS 26.3.1) has Apple Intelligence switched off
  (`unavailable(appleIntelligenceNotEnabled)`), and the simulator uses the host's model, so neither
  can run it. (Turning it on is a system setting; left as it is.)
- **The bar is "clearly faster and at least as good", and only the first half is likely.** The
  server's words, measured today on 16 slips through the real check route on localhost: first words
  p50 **1.30 s**, p90 1.87 s, max 2.06 s (plus Vercel's round trip in production, the tutor lane's
  1.8–2.5 s). Apple's published figures for its ≈3B on-device model (≈0.6 ms per prompt token to the
  first token, ≈30 tokens/s on an A17 Pro) put this prompt (≈250 tokens in, ≈25 out) near 0.6–1.0 s:
  about a second faster, on one path. The server's words are specific ("Check your division on the
  right side of line 3", "Look at how you distributed the 3 on the left side of line 2"); a 3B model
  is weak at arithmetic, and the rules can stop a wrong number but not a vague or misleading sentence.
- **It is not where the wait is.** Pen-up → tick has no words in it: recognition and the engine. Help
  me in Hint on a ring is one path among several, and a slower one to begin with.
- Rephrasing for younger grades would add a model step after the server's (slower). Read-aloud text
  needs no model (the readback's plain text already reads well with `AVSpeechSynthesizer`).

**What the owner should try on the iPad Air (M3, iPadOS 27):** Settings → Apple Intelligence on; run a
Debug build; Labs → Live Lab → switch on "iPad hint words" → "Hint words: iPad vs server" → Run. It
writes all 16 slips of `HintCorpus` on the iPad and shows each beside the server's words, with both
times and whether the rules let the iPad's words through (also logged as `LIVELAB hint …`). Then in the
Lab, write a slip ("Slip: 2x+3=11 / 2x=8 / x=5") and tap Help me: the card's words come from the iPad
(the stats line shows "iPad hints … ms"). Ship it to kids only if the iPad is under ≈0.8 s at p50, at
least 14 of 16 pass the rules, and the owner finds the words as good as the server's side by side.

## 3. Math Notes, kid-safe (shipped)

- **Graph it.** A line the engine reads as a function (`y = 2x + 1`, `f(x) = x^{2}`, kind `function`)
  gets a small Blocks chip beside it for 12 s after it is read (once per reading). A tap puts the
  board's own graph object (`GraphRecord`, plotted by AgathonBoard, movable and resizable, the tutor's
  cobalt) beside the line, else under it, on the screen and clear of everything there; the engine's
  `sketchGraph` picks the window (intercepts in view) and points, the line's own `plot` is the
  fallback. Nothing is graphed unasked; Off shows no chip; rubbing the line out (or rewriting it)
  takes its graph away. `LiveLoop+Graph.swift`, `GraphChip` in `LiveOverlay`.
- **"Show the answer when I write ="** (For grown-ups, default OFF: tutoring shouldn't hand out
  answers). On: a sum the kid ends with `=` is answered after it in the tutor's hand as soon as it is
  read, in any mode (homework checking, practice checking), with Auto on or off. The engine works the
  line out as in Solve (the policy still decides). With it on, such lines are read early too.
  `LiveSettings.answerOnEquals` (old saved settings still load), `LivePolicy.Input.answerOnEquals`.

## Tests

`ReadEarlyTests` (the loop on the test clock: read before the gate, no relation → gate, `=` at the
end only when an answer is wanted, new ink stops it, the gate joins the in-flight read, a failed read
is not repeated, ink elsewhere keeps it, hover, off/offline, the warm road), `ReadEarlyLogicTests`
(the `=` in all four hands, finished-looking lines, the rhythm's delay, joining and leaving a line),
`MathNotesTests`, `HintWordingTests`, `HintCorpusTests`. The opt-in benches: `ReadEarlyBench`
(`TEST_RUNNER_LIVE_BENCH=1`) and `ReadEarlyRealBench` (`TEST_RUNNER_LIVE_BENCH_REAL=1`, local stack).
The gate's own tests (`LoopTimingTests`) run with reading early off. `SnapshotLook`
(`TEST_RUNNER_LIVE_SNAPSHOTS=<dir>`) renders the "Graph it" chip and the grown-ups' settings to PNGs to
look at. Final run (2026-10-18, iPad Air 13-inch (M4) simulator): AgathonLive 82 tests in 16 suites
pass; the whole Agathon scheme passes (444 Swift Testing tests across the packages and the app, the
UI flows skipped without the local-stack flags).
