/**
 * The hand engine — LaTeX in, hand-drawn strokes out.
 *
 * A pure renderer for the AI tutor's handwriting. No React, no tldraw, no DOM, no
 * network, no LLM. The *maths* is always computed by the deterministic Live engine
 * (`src/lib/live/engine`); this module only writes down what that engine already said.
 *
 * ## Coordinates and units
 *
 * Glyphs are authored on a 10 x 14 em box with the baseline at y = 11 (`atlas.ts`).
 * `layoutMath` lays out in those units and then scales by `size / 14` into px, so
 * `size` is roughly the height of a capital letter plus its descender room. The result
 * is a top-left-origin box: every point lies in `[0, width] x [0, height]`, and the
 * writing line is at `y = baseline`.
 *
 * ## Turning a layout into canvas strokes
 *
 * ```ts
 * const layout = layoutMath("x = \\frac{-b \\pm \\sqrt{b^{2} - 4ac}}{2a}", { size: 28, seed });
 * if (layout.unsupported.length > 0) {
 *   //  Do NOT draw a partial expression — show the typeset KaTeX shape instead.
 *   return fallbackToTypeset();
 * }
 * //  Put the writing line where the student's own line is, and nudge right of their ink.
 * const placed = placeStrokes(layout.strokes, { x: inkRight + 24, y: inkBaselineY - layout.baseline });
 * for (const stroke of placed) {
 *   //  one tldraw draw shape per stroke, or one shape with one segment per stroke
 *   segments.push({ type: "free", points: stroke.points });  //  points carry x, y and pressure z
 * }
 * ```
 *
 * ## Animating the reveal
 *
 * `strokes` are already in drawing order (`stroke.order` ascends, and a fraction is
 * written numerator -> bar -> denominator, a radical hook before its radicand, a box
 * after the answer inside it). Reveal them progressively at a human writing speed:
 *
 * ```ts
 * let t = 0;
 * for (const stroke of layout.strokes) {
 *   schedule(t, () => show(stroke));
 *   t += strokeDurationMs(stroke) + STROKE_GAP_MS;
 * }
 * //  totalDurationMs(layout.strokes) is the same number, for planning the whole write.
 * ```
 *
 * For a worked solution use `layoutSteps`, which stacks lines on a baseline grid; each
 * line carries its own `strokes` (already in block coordinates) and baseline `y`, so a
 * caller can reveal a line, pause, then reveal the next.
 *
 * ## What it can write
 *
 * Arithmetic, algebra (surds, `\pm`, absolute values, logs, trig, Greek, sets and
 * intervals, `cases` and matrices), calculus (integrals with limits that grow with their
 * integrand, `\lim`, `\sum`, primes, evaluation brackets and bars) and upright formulas
 * and units (`\mathrm{Fe_{2}O_{3}}`, `\mathrm{m/s^{2}}`). The contract with the engine
 * is the table in `__tests__/coverage.test.ts`; what the hand looks like is
 * `docs/hand/gallery.png`, regenerated with `npx jiti src/lib/hand/__tests__/gallery.ts`.
 *
 * The board carries no words: `\text{…}` is written only while it is a short
 * mathematical word ("or", "no solution", a unit). A sentence is reported in
 * `unsupported`, like any other construct the hand will not draw.
 */

export {
  EM_BASELINE,
  EM_HEIGHT,
  EM_WIDTH,
  ATLAS,
  COMMON_LETTERS,
  LIGATURES,
  glyphKey,
  hasGlyph,
  tokenizeHand,
  type Glyph,
} from "./atlas";

export { mulberry32, polylineToSvgD, samplePath, withTremor, type InkPt, type Pt } from "./path";

export {
  HAND_SIZE,
  NOTE_HAND_SIZE,
  LINE_HEIGHT,
  composeHandwriting,
  composeArrow,
  composeAngleArc,
  composeCaret,
  composeCircle,
  composeTickMarks,
  composeUnderline,
  pickGlyph,
  type ComposedInk,
  type GlyphPick,
  type InkSegment,
} from "./compose";

export {
  layoutMath,
  placeStrokes,
  strokeBounds,
  strokeDurationMs,
  totalDurationMs,
  STROKE_GAP_MS,
  type MathLayout,
  type MathLayoutOptions,
  type Stroke,
  type StrokeKind,
} from "./mathLayout";

export { layoutSteps, type StepLine, type StepsLayout, type StepsOptions } from "./writeSteps";
