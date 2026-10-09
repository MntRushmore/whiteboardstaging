import { describe, expect, it } from "vitest";
import type { InkLine } from "@/lib/live/contracts";
import { splitInk } from "@/lib/live/diagrams";
import { parseStacked, workStacked } from "@/lib/live/engine/columnArithmetic";
import { unionRects } from "@/lib/live/strokeClusters";
import { buildPayload } from "@/lib/live/strokePayload";
import { handRow, handRule, toInkStrokes, writeStack, type StackShapes } from "@/lib/live/__fixtures__/strokes";
import { isMathpixConfigured } from "@/lib/server/mathpix";
import { loadEnvLocal, recognizeCached, type CallBudget } from "./handwriting";

/**
 * What Mathpix reads a stacked sum as (`stackedSums.ts`, `engine/columnArithmetic.ts`): the tutor's
 * hand writes each layout as the student, the board finds the block and sends it as ONE line, carry
 * and borrow marks left out, and the read must parse as the sum that was written. Read row by row
 * instead, `+680` came back as prose (`\text { +680 }`, 0.84) and the clusterer's line of `+680`,
 * the rule and `966` as `\frac{+680}{966}` — the owner's `= 0.7039`. With the marks sent, a crossed
 * `5` read `8` and the borrowed `4` replaced it (`42`).
 *
 * Costs Mathpix calls (about ten; cached on disk under src/__eval__/.cache/), so it only runs with
 * RUN_LIVE_EVAL=1.
 */
const LIVE = process.env.RUN_LIVE_EVAL === "1";

/** long multiplication: two rows of partial products and a second rule under the first answer */
function longMultiplication(): StackShapes {
  const ink = writeStack(["23", "\\times 45"], "115");
  const bottom = (shapes: StackShapes["all"]) => Math.max(...toInkStrokes(shapes).map((s) => s.bounds.y + s.bounds.h));
  const second = handRow("920", 400, bottom(ink.answer) + 10, 40, 30);
  const rule2 = handRule(330, 406, bottom(second) + 8);
  const total = handRow("1035", 400, bottom(second) + 18, 40, 31);
  return { ...ink, all: [...ink.all, ...second, rule2, ...total] };
}

const LAYOUTS: Array<[string, () => StackShapes, string | null]> = [
  ["the owner's sum, a carry over the 2", () => writeStack(["286", "+680"], "966", { carries: [{ place: 2, digit: "1" }] }), "966"],
  ["a wrong answer", () => writeStack(["286", "+680"], "866"), "966"],
  ["an empty answer", () => writeStack(["286", "+680"], null), "966"],
  ["taking away, a borrow crossed out", () => writeStack(["52", "-17"], "35", { borrow: { place: 1, digit: "4" } }), "35"],
  ["multiplying by one digit", () => writeStack(["23", "\\times 4"], "92"), "92"],
  ["three numbers", () => writeStack(["125", "48", "+302"], "475"), "475"],
  ["decimals", () => writeStack(["3.50", "+12.25"], "15.75"), "15.75"],
  ["four digits, two carries", () => writeStack(["4807", "+3295"], "8102", { carries: [{ place: 1, digit: "1" }, { place: 2, digit: "1" }] }), "8102"],
  // read before as `115 \\ \frac{920}{1035}` under the rule: the second rule taken for a fraction's bar,
  // which `parseStacked` now reads as the last row over the sum
  ["long multiplication: two rows, then their sum", longMultiplication, "1035"],
];

describe.skipIf(!LIVE)("eval: stacked sums → Mathpix (RUN_LIVE_EVAL=1)", () => {
  it(
    "reads each layout as the sum that was written",
    async () => {
      loadEnvLocal();
      expect(isMathpixConfigured()).toBe(true);
      const budget: CallBudget = { remaining: 20, calls: 0, hits: 0 };
      for (const [name, write, result] of LAYOUTS) {
        const ink = toInkStrokes(write().all);
        const [stack] = splitInk(ink).stacks;
        expect(stack, name).toBeDefined();
        const byId = new Map(ink.map((s) => [s.id as string, s]));
        const line: InkLine = { id: "eval", strokeIds: stack.strokeIds, bounds: unionRects(stack.strokeIds.map((id) => byId.get(id)!.bounds)), column: 0, row: 0, hash: "" };
        const read = await recognizeCached(buildPayload(line, ink)!, budget);
        const parsed = parseStacked(read.latex);
        console.log(`${name}: ${read.latex.replace(/\s+/g, " ")} (${read.confidence.toFixed(3)})`);
        if (result === null) {
          expect(parsed, name).toBeNull();
          continue;
        }
        expect(parsed, `${name}: ${read.latex}`).not.toBeNull();
        expect(workStacked(parsed!)?.result, name).toBe(result);
        expect(read.confidence, name).toBeGreaterThan(0.85);
      }
      console.log(`eval:stacked: ${budget.calls} Mathpix calls, ${budget.hits} cached`);
    },
    120_000,
  );
});
