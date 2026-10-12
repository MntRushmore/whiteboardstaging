# Type it — math typed on a laptop, written on the board by hand

Owner's pick (2026-10-12): until there's an iPad app, a kid on a laptop types their maths
instead of writing it with a trackpad. A trackpad hand comes out tiny and wobbly, the reader
misreads it, and the tutor looks broken. The text tool was taken off the board (da3aabb)
because the tutor never reads typed boxes. So a typed line has to reach the tutor exactly
like a written one.

## What the kid sees

- **The bar.** A slim bar docked at the bottom of the board: a box, a live preview of the
  line in the board's hand, and a row of big maths keys (fraction, x², xⁿ, √, ×, ÷, π, ( ),
  ≤ ≥, =). A "New problem" key, and Enter.
- **Plain typing.** `3x+5=20`, `1/2+3/4`, `2 1/2`, `x^2`, `x^(n+1)`, `sqrt(16)`, `√16`,
  `5*4`, `20:4`, `20÷4`, `|x-3|`, `<=`, `>=`, `!=`, `$4.50`, `25%`, `pi`. The preview shows
  `1/2` as a real fraction while they type.
- **Enter writes it.** The line is written on the board in the kid's own ink colour, by the
  tutor's hand engine (`src/lib/hand`), on the next line of the problem they're working on.
  Enter again writes the next step under it. "New problem" (or Shift+Enter) starts a fresh
  problem.
- **No reading wait, no misreads.** The tutor gets the LaTeX directly. Feedback, Suggest,
  Solve, Auto, Help me, Ask and the learning record all work on a typed line as they do on a
  read one.
- **Fix any line by typing.** ↑ in the box walks back up the current problem's lines; the
  pencil beside a line (on hover) opens it in the box. Enter replaces it.
  - A typed line's ink is rewritten in place.
  - A pen line keeps its ink, and its reading becomes what they typed (the readback edit
    that exists today). The raw-LaTeX editor under the readback (`MathEditor`) takes plain
    typing too.
- **Pen and typing mix.** A kid can type a line, then write the next one with the pen.
- **Laptop first.** On a device whose main pointer is a mouse or trackpad (`(pointer: fine)`
  and `(hover: hover)`), the board opens with the bar open and focused, plus a one-time tip
  ("On a laptop? Type your math here — Enter puts it on the board."). On touch devices the
  bar sits behind a keyboard button in the toolbar; the pen stays first.
- **The old Math tool (`m`) goes.** Its typed boxes were never checked by the tutor. The
  `math` shape util stays registered so old boards load.

## How it works

```
 kid types ──► plainToLatex (lazy chunk) ──► preview (layoutMath → SVG)
                       │ Enter
                       ▼
 controller.writeTyped({ text, latex })            (LiveLoop, main bundle)
   1. spot   = typedSpot(): the current problem's next line (or a new problem)
   2. layout = layoutMath(latex, { size, seed })    (unsupported → refuse, the bar says so)
   3. ONE user history mark: N draw shapes, one per stroke, kid's colour,
      no `live` meta (it IS student ink), meta.typedId on each,
      typedLatex / typedText / typedCount on the first
   4. flush now (no quiet-gate wait)
 flush ──► whole typed groups skip the drawing split and the clusterer (a fixed line each)
 processLine ──► a line whose strokes are exactly one whole typed group:
                 its reading is typedLatex, provider "typed", confidence 1;
                 no recognize call, no second read; the normal path after a read
                 (echo, marks, Auto) runs as for any line
```

- **Stateless.** Everything the loop needs lives on the strokes' meta, so a reload, Undo,
  another tab or a sync replays it with no in-memory registry. If the kid erases a stroke
  of a typed line, the group isn't whole any more and the line is read like any ink. If they
  write next to it with the pen, the clusterer may join them, and the joined line is read.
  The hand's clean strokes read well.
- **Size.** Inside a column that already has the kid's writing, match its line height
  (`inlineHandSizeFor`). Otherwise use a readable default scaled by the board's fit zoom
  (`inkScale`).
- **Place.** Left edge of the problem's column, below the lowest thing in that column's
  x-span (the kid's ink, typed lines, the tutor's writing, readbacks, marks), with the
  steps' gap (`layoutSteps`). No room before the screen's bottom → the next column. A new
  problem → a new column, or below with a gap of at least 2.5× the line height (the
  new-problem rule, f911cac). Never under the bar: the camera keeps the new line in view.
- **Bundle.** The board page has about 10 KB gzip of headroom (docs/BUNDLE.md). The bar,
  the parser and the preview are one lazy chunk. Only `writeTyped`/`typedSpot`/
  `typedLines` and the typed-group check live in the loop.

## Contract (`src/lib/typeMath/contracts.ts`)

- `plainToLatex(text): TypedParse` and `latexToPlain(latex): string` in
  `src/lib/typeMath/parse.ts`: pure, no DOM, lazy-loaded by the bar only.
- `LiveController.writeTyped?(args)`, `typedSpot?(opts)`, `typedLines?()`: optional, like
  the chat's methods.
- Stroke meta keys `typedId`, `typedLatex`, `typedText`, `typedCount`.

## Analytics

`clientMetric("type.write" | "type.edit" | "type.refused" | "type.open", …)`, so /admin
shows who types and how often a typed line is refused.

## Phone as a pen (next)

A plan comes after Type it ships: docs/PHONE-PEN.md.
