/**
 * Where the tutor writes a proof's next rows: the statement at the statement column's left edge,
 * the reason at the reason column's, both on one writing line, one row pitch under the last row.
 * One `HandPlan` for all the rows (statement, then reason, row by row), so the HandWriter reveals
 * them in order. Pure: the plan is in page coordinates.
 */
import type { Rect } from "../contracts";
import { paceFor, placeHandPlanOnBaseline, planHandwriting, HAND_WRITE, type HandLinePlan, type HandPlan } from "../handwriting";
import type { ProofRead } from "./read";

export interface RowText {
  statement: string;
  reasonLatex: string;
}

/** Meta key on the tutor's proof rows: the rows written, `[{ s, r }]` as JSON (the reader finds them again). */
export const PROOF_ROWS_META = "proofRows";

/**
 * The rows laid out under `read`'s last row. Null when the hand cannot write one of them (the
 * interlock: never half a row).
 */
export function proofRowsPlan(read: Pick<ProofRead, "statementX" | "reasonX" | "bottom" | "rowPitch" | "lineHeight">, rows: readonly RowText[], opts: { size: number; seed: number; shift?: number }): HandPlan | null {
  const lines: HandLinePlan[] = [];
  let t = 0;
  // the first new row's writing line: one pitch under the last row's, which is about its bottom
  let baseline = read.bottom + Math.max(read.rowPitch, 1.2 * read.lineHeight) + (opts.shift ?? 0) - 0.15 * read.lineHeight;
  const planned = rows.map((row, i) => ({
    s: planHandwriting([row.statement], { size: opts.size, seed: opts.seed + 2 * i }),
    r: planHandwriting([row.reasonLatex], { size: opts.size, seed: opts.seed + 2 * i + 1 }),
  }));
  if (planned.some(({ s, r }) => !s.plan || !r.plan || s.unsupported.length > 0 || r.unsupported.length > 0)) return null;
  // the reason column: never over a statement, and one column for all the rows written at once
  const widest = Math.max(0, ...planned.map(({ s }) => placeHandPlanOnBaseline(s.plan!, { x: read.statementX, baselineY: 0 }).bounds.w));
  const reasonX = Math.max(read.reasonX, read.statementX + widest + 0.8 * opts.size);
  for (const { s, r } of planned) {
    const sPlaced = placeHandPlanOnBaseline(s.plan!, { x: read.statementX, baselineY: baseline });
    const rPlaced = placeHandPlanOnBaseline(r.plan!, { x: reasonX, baselineY: baseline });
    for (const placed of [sPlaced, rPlaced]) {
      for (const line of placed.lines) {
        lines.push({ ...line, startMs: t });
        t += line.durationMs + HAND_WRITE.lineGapMs / 2;
      }
    }
    baseline += Math.max(read.rowPitch, 1.2 * read.lineHeight);
  }
  if (lines.length === 0) return null;
  const totalMs = Math.max(0, t - HAND_WRITE.lineGapMs / 2);
  const rects: Rect[] = lines.map((l) => {
    let maxX = 0;
    let maxY = 0;
    for (const st of l.strokes)
      for (const p of st.points) {
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
    return { x: l.x, y: l.y, w: maxX, h: maxY };
  });
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w));
  const y1 = Math.max(...rects.map((r) => r.y + r.h));
  return { lines, bounds: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, size: opts.size, totalMs, pace: paceFor(totalMs) };
}
