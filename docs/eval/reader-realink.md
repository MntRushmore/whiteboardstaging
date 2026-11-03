# The reader on real kids' ink: the crop reader, the second opinion, and what was fixed

> The real-ink bench (docs/REAL-INK-BENCH.md): 208 attempts, 320 labeled lines, children's own
> handwriting from production boards, kept outside every repo. **Aggregate numbers and failure-class
> names only** — nothing here says what any child wrote. Run 2026-11-03 on `feat/ipad-reader2`
> (off main 0caf6605), iPad Air 13-inch (M4) simulator, through `scripts/ios-realink-bench.sh`.

## How it was measured

The two route flags are off on production, so `MODE=server` against production could not test them.
Instead the bench ran against this checkout's `next dev` and the local Supabase stack
(`SERVER=local`, the training admin), with the flags set in the dev server's environment, starting
from a copy of the 2026-10-22 production read cache. Only reads the cache did not have were made:

- **crop reader** (`RECOGNIZE_CROP_READER=mathpix-text`): the reads missing from the cache, as the
  route answers them with the flag on;
- **second opinion** (`RECOGNIZE_SECOND_OPINION=mathpix-text` + the iPad's `pages.secondOpinion`):
  `SECOND=1` sends every read's crop and asks for the second opinion. The bench reads each crop once
  with Mathpix v3/text (a crop-only read on a server with the crop reader on), caches it by the crop,
  and says whether it agrees with the strokes read with the route's own `sameRead` — 1,205 crops.

Then every configuration was replayed from its cache (`MODE=replay`, `PARALLEL=1`, so the runs are
deterministic; with `PARALLEL=3` a replay moves by about one case either way).

## Results

| | teacher-right | read right (with a stacked sum's rows) | "?" on right work | rings on right work (strays ringed) | missed slips | asks "Is this right?" (on right reads) |
| --- | --- | --- | --- | --- | --- | --- |
| production today (main, both flags off) | 182/208 = 87.5 % | 75.5 % (83.1 %) | 11 | 0 (2) | 6 of 22 | 46 (28) |
| + crop reader | 182/208 = 87.5 % | 75.5 % (83.1 %) | 11 | 0 (2) | 6 | 46 (28) |
| + second opinion (+ crop reader) | 181/208 = 87.0 % | 75.5 % (83.1 %) | 11 | 0 (1) | 8 | 69 (41) |
| **this branch, crop reader on** | **187/208 = 89.9 %** | **77.8 % (85.3 %)** | **7** | **0 (2)** | **5** | **26 (13)** |
| this branch, crop reader off (its crops go to the vision model) | 187/208 = 89.9 % | 77.8 % (85.3 %) | 7 | 0 (2) | 5 | 26 (13) |
| this branch + second opinion | 185/208 = 88.9 % | 77.8 % (85.3 %) | 7 | 0 (1) | 8 | 62 (39) |

"Read right" is the bench's comparison of the line's reading with what was written; a stacked sum is
read as one block by design, so the number in brackets also counts a row read right inside its block
(`rowOfStack`). The 2026-10-22 production run (81.7 %) was older code; main had already moved to 87.5 %.

Read after pen-up is the bench's simulated clock (600 ms median in every row), so latency comes from
the route itself, measured from this Mac:

| read | p50 | p90 |
| --- | --- | --- |
| Mathpix strokes (production, the cache) | 0.46 s | 0.64 s |
| Mathpix v3/text on a line's crop (the second opinion; 98 % of 1,205 crops answered) | 0.26 s | 0.42 s |
| the crop retry of an unreadable line, v3/text (7 of 8) | 0.21 s | 0.27 s |
| the crop retry of an unreadable line, vision model (8 of 8, crop reader off) | 1.30 s | 4.9 s (max) |

## What the flags do on real ink

**The crop reader changed nothing — because the iPad never asked it.** It reads a crop only after a
strokes read failed. Mathpix found 8 of about 1,225 strokes reads unreadable (`strokes_no_content`), and
the route answered `unreadable` + `needsCrop`; the web board then sends the crop once, but the iPad
took `unreadable` as final. Fixed on this branch (below). With the fix, v3/text read 7 of the 8 crops
in about 0.2 s and the vision model the last; the vision model alone read all 8 with the same marks,
in about 1.3 s each. So the flag buys speed on those lines, not accuracy.

**The second opinion asks too often on real ink, and catches too little.** Mathpix v3/text is much
weaker on children's real handwriting than on the synthetic hands: it disagreed with a right strokes
read on 28 of 241 lines (12 %; synthetic: 2.7–4.5 % of all lines), often with CJK or kana characters
for a child's digits, and agreed with a strokes misread on 37 of 78. Disagreement caught 32 of 78
misreads (41 %; synthetic: 71–88 %). Asking holds back a slip's ring, so missed slips went from 6 to 8
and teacher-right fell by a case, and it doubles Mathpix's calls.

## What was fixed (each with a synthetic regression test)

| failure class | fix | lines |
| --- | --- | --- |
| never read: strokes Mathpix finds unreadable | the iPad reads them once more from the crop, as the web does (`LiveLoop.recognizeAgain`) | "?" → read |
| "?" on right work: text-mode junk in a read of numbers (CJK/kana for a stroke, full-width signs, a bar for a 1) | `textAsKidMeant` in `mathsOfText` (youngHand.ts) | 2 |
| misread: a letter written low after a number read as its subscript | `NUMBER_SUBSCRIPT_RE` | 1 |
| misread: a plus written high read as an exponent; her x read as a lone times sign | applied to every read, not only the second look before a ring | 3 |
| "?" on right work: "divide both sides" drawn under the tutor's problem on a problem page | `divisionBars` reaches further under a problem the tutor wrote (`divisionAboveTutorFactor`, `divisionTutorSpanShare`) | 2 |
| asked instead of ringing / nagging on right reads | "Is this right?" below Mathpix confidence 0.9, not 0.99 (`PageTiming.askBelowConfidence`): reads at 0.9–0.99 were right 16 times in 19, the 3 wrong never ringed; at 0.85 a stray was ringed | asks on right reads 30 → 13, a slip ringed |

What is left (29 failing lines; 21 cases not teacher-right): one line taken as two or two as one
(10: side-by-side answers, notes beside a step, "÷ n" under each side); misreads (6: a digit dropped
or a sign added at confidence 1.0, words read for a formula, a stacked sum read as a fraction or with
its answer twice); a "?" (6, most on reads under Mathpix confidence 0.6); lines still held at Check
(3); a slip asked about at confidence 0.88–0.89 (2); and tutor-logic cases with every line read right
(a page not counted solved, a stray scratch ringed). Read right stays
under 88 % mostly because of the grouping cases, which are the tutor-logic lane's.

## Recommendation for production

1. **Ship this branch's iPad build** (the crop retry, the read fixes, the 0.9 ask threshold) — the
   accuracy gain (87.5 % → 89.9 % teacher-right, "?" on right work 11 → 7, no new rings) is all client
   side, plus `brain.js`.
2. **`RECOGNIZE_CROP_READER=mathpix-text`: turn on**, once a build with the crop retry is out (before
   it, the iPad never reaches it; the web board's crop retries do). It does not change marks; it reads
   an unreadable line in about 0.2 s instead of the vision model's 1.3 s (up to 4.9 s). Cost: about
   0.65 % of reads × $0.002 — for a session of about 80 reads (the bench averages 3.8 reads a line,
   early reads included; 20 lines) that is about $0.001.
3. **`RECOGNIZE_SECOND_OPINION`: leave off.** On real ink it asks about 12 % of right lines, misses 59 %
   of misreads, costs a slip's ring now and then, and doubles Mathpix's cost per read: +$0.002 a read,
   about +$0.16 a session of 80 reads (today's strokes reads are the same again, about $0.16).

Spend for this study: 1,267 Mathpix calls (≈ $2.53: 1,205 second-opinion crops, 46 strokes reads,
16 crop retries), about 30 OpenRouter vision reads (≈ $0.01).
