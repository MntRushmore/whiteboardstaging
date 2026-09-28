import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CORPUS } from "./corpus";
import { checkWriting, renderDrawingsMarkdown, runBarEval, runDrawingEval } from "./drawings";

/**
 * The drawings scoreboard (offline, no recognizer): generated drawings beside lines of maths,
 * grouped the way the board did before drawings were told apart and the way it does now, plus
 * every corpus line in every hand split on its own — nothing written may be taken for a drawing.
 *
 *   npm run eval:drawings     same run, and writes docs/eval/drawings.{md,json}
 */
const ROOT = resolve(__dirname, "..", "..");

/** Writing that is shaped like drawing, beyond the corpus: every one must stay writing. */
const WRITING_EXTRAS = [
  "\\sqrt{b^{2} - 4ac}",
  "x = \\frac{-b \\pm \\sqrt{b^{2} - 4ac}}{2a}",
  "\\sqrt{\\frac{x + 1}{x - 1}}",
  "3 \\overline{)126}",
  "\\int_{0}^{2} 3x^{2} \\, dx",
  "\\left( \\frac{x + 1}{2} \\right)^{2}",
  "\\left| \\frac{x}{2} - 1 \\right| = 3",
  "\\frac{3x^{2} + 2x - 1}{x - 4}",
  "\\begin{cases} x + y = 3 \\\\ x - y = 1 \\end{cases}",
  "\\begin{bmatrix} 1 & 2 \\\\ 3 & 4 \\end{bmatrix}",
  "\\left[ x^{3} \\right]_{0}^{2}",
  "\\sum_{i=1}^{10} i",
  "\\overline{AB} = 5",
  "\\vec{v} = 3",
];

describe("eval: drawings beside maths", () => {
  it("keeps the maths intact and the drawings out, and takes no written line for a drawing", () => {
    const lines = [...new Set([...CORPUS.flatMap((p) => p.lines), ...WRITING_EXTRAS])];
    const writing = checkWriting(lines);
    const board = runDrawingEval();
    const bars = runBarEval();
    const n = board.scenes;
    console.log(
      `eval:drawings: ${n} scenes; maths intact ${board.before.mathIntact} -> ${board.after.mathIntact}; drawings out ${board.before.drawingOut} -> ${board.after.drawingOut}; stray lines ${board.before.strayLines} -> ${board.after.strayLines}; labels attached ${board.after.labelsAttached}/${board.after.labels}; writing: ${writing.misread.length} of ${writing.lines} lines' strokes misread; division bars ${bars.bars.found}/${bars.bars.total}, look-alikes taken ${bars.lookalikes.taken}/${bars.lookalikes.total}`,
    );

    // the writing never changes: no stroke of any written line is a drawing, a mark or a label
    expect(writing.misread).toEqual([]);
    expect(writing.regrouped).toBe(0);
    // every drawing is kept out of every line, and the maths line survives nearly always
    expect(board.after.drawingOut).toBe(n);
    expect(board.after.mathIntact).toBeGreaterThanOrEqual(Math.floor(0.98 * n));
    expect(board.after.mathIntact).toBeGreaterThan(board.before.mathIntact);
    expect(board.after.strayLines).toBeLessThanOrEqual(Math.ceil(0.01 * n));
    expect(board.after.labelsAttached).toBeGreaterThanOrEqual(Math.floor(0.98 * board.after.labels));
    // no drawing beside maths is ever a division bar
    expect(board.after.bars).toBe(0);
    // a bar under a whole equation with the divisor under it is found, the student's own lines
    // stay whole; an underline, a rule over a line, a number line, a T-table, a fraction bar are not
    expect(bars.failures.map((f) => f.id)).toEqual([]);
    expect(bars.bars.found).toBe(bars.bars.total);
    expect(bars.lookalikes.taken).toBe(0);

    if (process.env.EVAL_WRITE === "1") {
      const dir = join(ROOT, "docs", "eval");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "drawings.md"), renderDrawingsMarkdown(board, writing, bars));
      writeFileSync(
        join(dir, "drawings.json"),
        JSON.stringify(
          {
            scenes: n,
            before: board.before,
            after: board.after,
            byDrawing: board.byDrawing,
            byPlacement: board.byPlacement,
            writing,
            failures: board.failures.map((f) => f.id),
            stray: board.stray.map((f) => f.id),
            divisionBars: { scenes: bars.scenes, bars: bars.bars, lookalikes: bars.lookalikes, byKind: bars.byKind, failures: bars.failures.map((f) => f.id) },
          },
          null,
          1,
        ) + "\n",
      );
    }
  }, 180_000);
});
