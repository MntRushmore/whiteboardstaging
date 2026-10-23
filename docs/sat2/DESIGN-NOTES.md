# SAT v2: design notes for the iPad lane

2026-10-23, branch `feat/sat2-design`. The spec is `docs/SAT-V2.md`; this file is how it looks.
Mockups: `docs/sat2/mockups.html` (all frames with captions; `#f01` … `#f13` shows one) and
`docs/sat2/mock-NN-*.png` (2×, iPad Air 13"). `./render.sh` renders them again;
`npx jiti docs/sat2/ink-gen.ts` regenerates the handwriting (the real hand engine, `src/lib/hand`).

Questions in the mockups are real bank items: `algebra-linear-two-var-0102` (plot, mcq),
`geometry_trig-lines-angles-triangles-0001` (shape, grid-in), `psda-probability-0107` (two-way table,
mcq). The nudge, the `why` notes and the `desmos_steps` shown are mock copy; the bank lane writes the
real ones.

## Units

- The question page is **1600 page units wide**, the same in both orientations. The camera fits the
  width: landscape k = 1366/1600 = 0.854 (1 u ≈ 0.85 pt), portrait k = 1024/1600 = 0.64.
- The page is never re-laid out when the iPad turns. The question block, and any ink on it, stays at
  the same page coordinates. Only the page's height and the answer row move (see "The page grows").
- Chrome (top bar, dock, Help me, Check, sheets) is view space, in pt, and floats over the paper.
- In portrait, the page sits `max(0, 84 − 104·k)` pt lower (17 pt) so the question never goes under
  the top bar.

## The page, top to bottom (page units)

| part | where | look |
|---|---|---|
| top lane | y 0 … 104 | blank paper under the top bar |
| question number | (72, 106), 44 × 44, radius 12 | ink fill, white Lexend SemiBold 22: hangs in the margin like a printed test |
| stem | x 140, from y 104; 680 wide beside a figure, 1388 without one | Lexend Regular 25, line height 40, ink; inline math KaTeX-style (SwiftMath), 1.06× the text size; paragraphs 14 apart |
| figure, beside | x 880, from y 108, at most 648 wide | printed in ink (see Figures) |
| figure, below | x 140, at stem bottom + 28, at most 1388 wide | |
| work area | everything between the question block and the answer row | dotted paper |
| answer row | its bottom sits at page bottom − the dock lane | cards or the grid-in box |
| dock lane | the last 110 pt of the screen (129 u landscape, 172 u portrait) | blank; the dock floats here |

### Figure placement

- **Beside** (the default): the stem takes the 680 column and the figure the 648 column to its right.
  Plots and shapes go beside. Tables go beside when their natural width is ≤ 648 (a 4-column two-way
  table is ~560).
- **Below**: when the figure is wider than 648 (a wide table, a long bar chart), or when the stem in
  the 680 column would run past 9 lines (360 u). Then the stem goes full width (1388) and the figure
  sits under it, left-aligned at x 140.
- Figure sizes: a plot is a 640 × 470 box (92 left for tick labels and the rotated y label, 70 below
  for tick labels and the x label). A shape is drawn at 52 u per figure unit with 50 / 40 of padding.
  A table is natural size: header row 56 tall on chalk (radius 14 at the ends), body rows 54 with a
  1.5 hairline (`line`), cells padded 22, Lexend 21 (header SemiBold 19), tabular digits, the Total
  row SemiBold.
- Printed figure style: grid 1.4 `line`; axes 2.2 ink; function 3 ink, round caps; points r 6.5 ink
  with a 2.5 paper halo; point labels Lexend SemiBold 18 ink; tick labels Lexend 16 `inkSecondary`;
  axis labels Lexend Medium 16 `inkSecondary`; polygon edges 2.6 ink; angle arcs 2 ink, r 40 (34 for
  the unknown), label at r + 34 on the bisector; shape labels KaTeX 26, angle labels 24.
- Point labels avoid the line: the label goes to the side the line isn't on. A point on the y-axis
  puts its label left of the axis, below the point (the `(0, 19)` in the mockups), since the rise
  and run get sketched just right of it.

### The work area

- It is **L-shaped**: it starts 48 below the stem on the stem side, and 24 below the figure on the
  figure side, so the space under a short stem is work space too. It ends 32 above the answer row.
- **Dotted paper**: dots every 36, r 1.8, colour `templateDot` #D3D6DF (new: a flat grey between
  `line` and `faint`; add it to `CanvasAppearance`). No dots inside the question block's keep-out
  boxes (stem + 24 around, figure + 24/28 around, the figure box runs to the page's right edge).
  It is template (drawn by the canvas, never a record), like the problem pages' guide lines.
- Minimums: **360** under the stem (the stem column) and **200** full width under the whole question
  block. Either one failing makes the page taller (below).
- The tutor's notes and the readbacks use the space to the right of the student's line; nothing is
  reserved for them.

### The answer row

- **Cards**: 4 across, gap 24, each (1456 − 72)/4 = 346 wide; **112 tall**, **132** when any choice
  holds a fraction (shown in display style, so it reads at full size); radius 26; `surfaceSunken`.
  Inside: padding 22 left / 20 right; the letter in a 52 paper circle (Lexend SemiBold 23); the
  choice at 28; the eliminator (an ×, 44 circle, `faint`) on the right.
- States: chosen = ink fill, white text, white letter circle. Crossed out = letter and text `faint`,
  a 3-wide `inkSecondary` stroke through the choice at −18° (so it never hides in a fraction bar), the
  eliminator becomes undo (↺) on a paper circle. Checked wrong = `tryAgain` (sunny) fill, ink text,
  no eliminator. Checked right = `success` fill, white text, a white check where the eliminator was.
- A choice that won't fit 346 on one line (a word answer) switches the row to a 2 × 2 grid, each
  card 716 wide, the same heights. (Not in the mockups; no current bank item needs it.)
- **Grid-in** (row height 132): "YOUR ANSWER" (Lexend SemiBold 17 caps, +1.2 tracking,
  `inkSecondary`) at (72, rowTop − 4); the field 400 × 84, radius 26, chalk, a 3-wide `focus` ring
  while active, Lexend Medium 40 tabular, cobalt caret; the rule ("Up to 5 characters. A fraction like
  3/4 or a decimal.") Lexend 17 `inkSecondary` at x 496. The keypad sits right-aligned in the same
  row: 7 × 2 keys of 96 × 60, radius 18, gaps 10 across and 12 down; digits on chalk, `. / −` and ⌫
  on `guide`; Lexend SemiBold 28. Only the characters a grid-in allows. Check needs a non-empty answer
  that passes the SPR length rule.

### The page grows (long questions)

```
rowH   = 112 | 132 (fractions or a grid-in)
pageH  = max( viewport height in u,
              104 + stemH + 48 + 360 + 32 + rowH + dockLane,     // the stem column keeps 360
              qBottom + 32 + 200 + 32 + rowH + dockLane )        // a full-width band keeps 200
rowTop = pageH − dockLane − rowH
```

- The answer row is always at the bottom of the page, the question always at the top; the work area
  takes whatever is between. A tall question makes a page that scrolls (vertical only, one finger
  with the finger tool, two with the pencil), never a squeezed work area.
- Orientation: the page's height is recomputed for the new viewport and the answer row re-anchors to
  the new bottom. It never moves above the lowest ink + 32 (the page grows instead), so turning the
  iPad can't put a card on top of work.
- When the answer row is scrolled out of view, the top bar's ‹ n/N › keeps working and Check scrolls
  the row into view before it checks.
- Frame 9 (a 6-line stem and a 5 × 4 table) still fits one landscape screen: the table goes beside,
  the work area keeps the whole left side under the stem and a band under the table.

## Ink

| ink | colour | width (u) | notes |
|---|---|---|---|
| student pencil | `ink` #14151F | **2.9** | 0.65 × the app's default draw width (size m: (3.5 + 1) × scale = 4.5); the owner, twice: kid ink was too thick |
| tutor hand | `tutorInk` #2D5BFF | 3.6 | the hand engine, size 38 for work lines, 28 for labels on a figure |
| tutor tick | `tutorInk` | 4.4 | one stroke: short down, long sweep up, about 30 × 42 |
| tutor ring | `tutorInk` | 3.6 | a loop of a little more than one turn, 34 past the line's ends |

- The tutor writes math only (the hand's no-words rule). Words from the tutor are typeset (Lexend,
  cobalt), never handwritten.
- Ink on the figure is ink on the board, over the printed figure (z above the template). It is read
  in the figure's coordinates (`docs/SAT-V2.md`).

## The tutor's ladder: placements

All in page units, relative to the student's ink, so it travels with the page.

- **Rung 1, nudge** (frame 3): a cobalt note, 420 wide, radius 6 / 24 / 24 / 24 (the tail corner
  toward the line), padding 16 / 22 / 18. "NUDGE" (Lexend SemiBold 14 caps, +1.4), the nudge (Lexend 21,
  line 1.4, white), then a footer that names the next tap ("Stuck still? Tap Help me again for one
  step.", Lexend 15, white). Placed at (last line's right + 48, its top − 4). If that runs past the
  work area's right edge or into the figure's keep-out, it goes under the line instead, at x = the
  line's left, 24 below its ink. It stays until the student writes again or taps it.
- **Rung 2, one step** (frame 4): the tutor writes ONE line in its hand, left-aligned with the
  student's last line, baseline 118 below the student's last baseline (one work row; more if the
  student's line has a descending fraction). Then "Your turn: the next line." (Lexend SemiBold 20,
  cobalt) at the tutor line's right + 40, on its x-height. No note, no buttons.
- **Rung 3, walk me through it** (frame 5): the solution's steps in the work area, from the top of
  the stem column (x 140): each step is a caption (a 30 cobalt badge with its number, then the step's
  text in Lexend Medium 19 cobalt) and the step's math in the tutor's hand 92 below the caption (116
  for a fraction line); steps are ~150 apart. A step that is about the figure is also drawn ON the
  figure (the rise and the run as cobalt legs, their sizes as cobalt labels). The next step's caption
  waits in `faint` with a `tutorInkEmpty` badge. Check (next to Help me, bottom left) is replaced by a cobalt 64 pt pill:
  three 22 × 6 step bars (white = shown, `cobaltDeep` = waiting) + "Step 2 of 3 · Tap to go on" + →.
  A tap anywhere on the board goes on; the last step turns the pill back into Check. If the student
  already has ink in the stem column, the walk-through starts under their last line instead.
- **The Help me button** shows the rung: three 22 × 5 bars under the label (ink = used, an ink
  outline = still to come). Hidden until the first tap.
- **Wrong-answer diagnosis** (frame 6): a cobalt note above the chosen card: left edge on the card's
  left, bottom 24 above the answer row, 600 wide, the tail corner (6) bottom-left, toward the card.
  "YOU PICKED B" label, "That's what you get if you …" (21), then two 56 pt buttons: "Try again"
  (paper, ink text) and "Walk me through it" (`cobaltDeep`, white). When the tutor can find the line
  that made the mistake (it read "m = 31 − 19 = 12"), it rings that line too. A miss with no `why`
  gets the card's Look again state and the two buttons, no sentence.
- **Capped** (frame 10): no ticks, rings or readbacks (the tutor isn't reading). A quiet pill in the
  top bar, left of Mark: a 10 pt `inkSecondary` ring dot + "Tutor checks used up today: 20 of 20.
  Help me still works." (Lexend 15, on chalk, 40 tall), with the caller's own cap. Help me climbs the
  same three rungs from the bank (rung 2 writes the bank's next step in the same cobalt hand). The
  first time it happens, an ink card lays the ladder out once, the three rungs side by side: 760 pt
  wide, at x 20, its bottom 20 above the answer row, radius 28 with the bottom-left corner 6 (toward
  Help me, right below it). It goes on the next tap.
- **The solution, two ways** (frame 7): a sheet from y 504 pt to the bottom, `ground`, radius 32
  at the top; the question and figure stay in view above it. Header: a 44 `success` circle with a
  check, "A is right." (Bricolage ExtraBold 24) and the answer in math; "Back to my work" (paper) and
  "Next question" (sunny, large) on the right. Two paper cards, 633 pt each, 20 apart: "THE PAPER WAY"
  (the bank's steps: numbered chalk badges, Lexend 17 text, the math in display style at 21) and
  "THE DESMOS WAY" (`desmos_steps`: each expression in a calculator-style row, 48 tall, chalk, with a
  `guide` gutter holding the row number; a table step as a small two-column table). No Desmos logo
  or colours. Portrait: the same sheet, the two ways as a segmented control. No Desmos way: the paper
  way takes the whole width.

## Chrome (pt)

- **Top bar**, no background, on the paper: close (48 round, chalk) at (20, 14); "Q4 of 10"
  Bricolage ExtraBold 21 + " · Linear equations in two variables" Lexend Medium 16 `inkSecondary`
  at x 84; on the right, Mark (48 pill, bookmark icon, Lexend SemiBold 16) and ‹ 4/10 › (48 pill,
  36 chevrons), 10 apart, 20 from the edge. The skill name is the bank's, sentence case. The
  status bar is hidden during a set.
- **Bottom row** (owner, 2026-10-23): **Help me, then Check, at the bottom LEFT** (from x 20, 10
  apart); **the pen dock at the bottom RIGHT** (its right edge 20 from the screen's); nothing in
  between. All three sit 20 above the bottom edge, in the dock lane.
- **Dock** (72 tall, ink): lasso, pencil (active = sunny), highlighter, eraser, Graph it | undo,
  redo | three pens (ink, red, green; 44 targets, 26 dots). No page arrows (the top bar has them).
- **Check** 64 pt ink pill (a 42 `onInkFaint` badge with a check, Bricolage ExtraBold 24); off until a
  choice or an answer exists: `guide` fill, `faint` text, `line` badge. **Help me** 72 pt sunny, the
  mark in ink, Bricolage ExtraBold 26, always the biggest thing on the board. Help me is first from
  the left, Check right after it.

## Type (all Blocks styles)

| use | font | size |
|---|---|---|
| stem | Lexend Regular | 25 u (21 pt landscape, 16 pt portrait), line 40 u |
| choices | KaTeX-style math | 28 u |
| tutor note text | Lexend Regular | 21 u |
| walk-through captions | Lexend Medium | 19 u |
| figure point labels / ticks | Lexend SemiBold 18 / Regular 16 | u |
| top bar title / skill | Bricolage ExtraBold 21 / Lexend Medium 16 | pt |
| sheets, SAT home, summary | DS styles: `display` 52–72, `title` 32, `headline` 24, `body` 17, `caption` 14, `label` 13 caps | pt |

## Colours

Only `DS.Color` tokens, flat, plus `templateDot` #D3D6DF for the dot grid. Cobalt is the tutor only
(notes, captions, tutor ink, the walk pill, the tutor-left bar on SAT home). Sunny is Help me, go
buttons and Look again. `success` only on the checked right card and "A is right." Tomato only to
flag a weak skill on SAT home. No gradients, shadows, glass, mascot faces, stickers or confetti
anywhere in SAT mode; missed questions are ink rings, never red.

## SAT home and the end of a set

- **SAT home** (frame 12): left column (760 pt): Today, "3 to review" (display 52) with the deck drawn
  as three flat stacked cards (`line`, `guide`, chalk), "Practice 10" (sunny, large) with "3 reviews,
  then 7 new picked for you.", then answered / right today and the free tutor left as a cobalt bar.
  Under it, Progress: the estimate band on a 200–800 line with its honest note, then the four domains
  as bars. Right column (526 pt): Skills, by domain, each a row with an ink bar and r/a; a skill
  under 50% gets a tomato bar and a "PRACTICE" tag; untried skills show an empty bar and "—". Tapping
  a skill starts a set of it.
- **End of a set** (frame 11): "SET DONE · MIXED PRACTICE", the score in display 72, time and Help
  me count, ten marks (ink dot = right, ink ring = missed), the per-question list (missed rows say
  "Into the deck"), and the mistake deck card: "3 come back tomorrow.", the 1-day/3-day rule in one
  sentence, the front card (a real missed stem, "Back in 1 day"), "Practice 10 more" (sunny) and "See
  the 3 missed".

## Open questions for the owner

1. **Portrait: scale the page, or reflow it?** The mockup scales the same 1600-wide page to the
   width, so in portrait the stem is 16 pt and figure labels about 10 pt, with a very tall work area.
   Reflowing (figure under the stem, bigger type) would move the figure and any ink on it whenever
   the iPad turns. *Recommendation: scale it, as mocked. Ink never moves, and a double-tap on the
   question zooms the camera to it.*
2. **How Help me shows the rung.** The mockups use three small bars under the label plus a footer in
   the nudge ("Tap Help me again for one step"). The other option is a label that changes ("More help",
   then "Walk me through it"). *Recommendation: the bars and the footer. "Help me" stays one
   recognisable button, and the note says what the next tap does.*
3. **When the wrong-answer note shows.** It could show on the first wrong check, or only after a
   second miss. *Recommendation: the first wrong check. It names the mistake, not the answer, and
   that's when it's most useful. "Try again" is the first button.*
4. **Grid-in by pencil.** The mockup has a typed keypad. Writing the answer in the box with the pencil
   would need recognition and a confirm step. *Recommendation: keypad only this round (exact, like
   test day, and no pencil gestures this round). Handwritten answers can come later.*
5. **Dotted paper.** The work area is dotted (36 u pitch); the problem pages for younger kids use
   lines. *Recommendation: dots for SAT. They read as a grown-up pad, give you a grid for sketches,
   and keep the printed question visibly separate from your work.*
6. **The number in the margin.** The page prints "4" beside the stem (like a test booklet) as well
   as "Q4 of 10" in the top bar. *Recommendation: keep it. It anchors the printed sheet, and it
   survives in screenshots and thumbnails, where the top bar doesn't.*
