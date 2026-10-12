import type { VisualModel } from "../contracts";
import { fillInk, fillRect, handRect, measureLabel, MODEL_TEXT, ModelInk, numLatex, type LabelSize, type ModelSketch } from "./kit";
import { placeParts } from "./maths";

/**
 * An area model for a × b as a teacher draws one: a rectangle split by place value (23 → 20 + 3
 * across, 14 → 10 + 4 down), the parts written along the top and down the left, every partial
 * product worked out by the board and written in its cell (each cell lightly coloured in), and
 * under it their sum: `200 + 30 + 80 + 12 = 322`. Roughly to scale: each part's width follows its
 * value, but never so thin its product cannot be written in it. The number with more parts goes
 * across (a wide model reads better on a board); zeros are left out (205 → 200 + 5).
 */

type Area = Extract<VisualModel, { kind: "area_model" }>;

export const AREA = {
  /** the rectangle at most this wide / tall: a single cell (7 × 8) smaller than a split one */
  maxW: [380, 540, 600],
  maxH: [250, 340],
  /** …and at least this big: smaller is a scribble, not a model */
  minW: 150,
  minH: 100,
  /** a part's least share of its side, so a small part (the 3 of 23) still has a cell */
  minShare: 0.2,
  /** px round a product inside its cell */
  cellPad: 12,
  /** the parts' labels to the rectangle */
  labelGap: 12,
  /** the rectangle to the sum under it */
  sumGap: 20,
  inset: 5,
} as const;

/** Side lengths for parts by value, each at least `min[i]`, adding up to `total` (null when the mins alone do not fit). */
function sides(values: readonly number[], min: readonly number[], total: number): number[] | null {
  const share = values.map((v) => Math.max(AREA.minShare, v / values.reduce((a, b) => a + b, 0)));
  const fixed = new Set<number>();
  for (let round = 0; round <= values.length; round++) {
    const left = total - [...fixed].reduce((a, i) => a + min[i], 0);
    const free = values.map((_, i) => i).filter((i) => !fixed.has(i));
    const sum = free.reduce((a, i) => a + share[i], 0);
    const out = values.map((_, i) => (fixed.has(i) ? min[i] : (left * share[i]) / sum));
    const short = free.filter((i) => out[i] < min[i] - 1e-9);
    if (short.length === 0) return left >= -1e-9 ? out : null;
    for (const i of short) fixed.add(i);
  }
  return null;
}

/** The sum line, on one line or split before its `=` when too wide. */
function sumLines(products: readonly number[], total: number): string[][] {
  const terms = products.map(numLatex).join(" + ");
  return [[`${terms} = ${numLatex(total)}`], [terms, `= ${numLatex(total)}`]];
}

function attempt(spec: Area, box: { w: number; h: number }, seed: number, size: number): ModelSketch | null {
  const A = AREA;
  const pa = placeParts(spec.a);
  const pb = placeParts(spec.b);
  // the number with more parts across
  const [top, side] = pb.length > pa.length ? [pb, pa] : [pa, pb];
  const products = side.flatMap((s) => top.map((t) => s * t));
  const total = spec.a * spec.b;
  const m = (t: string): LabelSize | null => measureLabel(t, size);
  const topM = top.map((t) => m(numLatex(t)));
  const sideM = side.map((s) => m(numLatex(s)));
  const prodM = products.map((p) => m(numLatex(p)));
  if ([...topM, ...sideM, ...prodM].some((x) => !x)) return null;
  const sideW = Math.max(...sideM.map((x) => x!.w));
  const topH = Math.max(...topM.map((x) => x!.h));
  const prodH = Math.max(...prodM.map((x) => x!.h));
  const left = sideW + A.labelGap;
  const up = topH + A.labelGap;
  const one = top.length * side.length === 1;
  // the sum under it: one line when it fits the box, else two
  let sum: string[] = [];
  let sumH = 0;
  if (!one) {
    for (const lines of sumLines(products, total)) {
      const ms = lines.map((l) => m(l));
      if (ms.some((x) => !x)) return null;
      if (Math.max(...ms.map((x) => x!.w)) <= box.w - 8) {
        sum = lines;
        sumH = ms.reduce((a, x) => a + x!.h, 0) + (lines.length - 1) * 12 + A.sumGap;
        break;
      }
    }
    if (sum.length === 0) return null;
  }
  let W = Math.min(A.maxW[Math.min(top.length, 3) - 1], box.w - 8 - left);
  const colMin = top.map((_, c) => Math.max(topM[c]!.w + 10, ...side.map((_, r) => prodM[r * top.length + c]!.w + 2 * A.cellPad)));
  // down: in proportion to across as the numbers are, within what the box and the products allow
  const rowMin = side.map(() => prodH + 2 * A.cellPad);
  const room = box.h - 8 - up - sumH;
  const ratio = side.reduce((a, b) => a + b, 0) / top.reduce((a, b) => a + b, 0);
  const H = Math.min(A.maxH[Math.min(side.length, 2) - 1], room, Math.max(W * ratio, rowMin.reduce((a, b) => a + b, 0), W * 0.38));
  // a model taller than it may be (7 × 8) keeps its shape by being narrower, not by being squashed
  if (W * ratio > H + 1) W = Math.max(colMin.reduce((a, b) => a + b, 0), H / ratio);
  const widths = sides(top, colMin, W);
  if (!widths) return null;
  if (W < A.minW || H < A.minH) return null;
  const heights = sides(side, rowMin, H);
  if (!heights) return null;

  const ink = new ModelInk(seed);
  const x0 = left;
  const y0 = up;
  const xs = [x0];
  for (const w of widths) xs.push(xs[xs.length - 1] + w);
  const ys = [y0];
  for (const h of heights) ys.push(ys[ys.length - 1] + h);
  const Wd = xs[xs.length - 1] - x0;
  const Hd = ys[ys.length - 1] - y0;
  ink.draw("rect", (pen) => handRect(pen, { x: x0, y: y0, w: Wd, h: Hd }));
  if (top.length > 1) ink.draw("split:across", (pen) => xs.slice(1, -1).flatMap((x) => pen.line({ x, y: y0 }, { x, y: y0 + Hd })));
  if (side.length > 1) ink.draw("split:down", (pen) => ys.slice(1, -1).flatMap((y) => pen.line({ x: x0, y }, { x: x0 + Wd, y })));
  top.forEach((t, c) => ink.label(`top:${c}`, numLatex(t), { x: (xs[c] + xs[c + 1]) / 2, y: y0 - A.labelGap }, "center", "bottom", size));
  side.forEach((s, r) => ink.label(`side:${r}`, numLatex(s), { x: x0 - A.labelGap, y: (ys[r] + ys[r + 1]) / 2 }, "right", "middle", size));
  side.forEach((_, r) =>
    top.forEach((_, c) => {
      const cell = { x: xs[c], y: ys[r], w: widths[c], h: heights[r] };
      ink.fill(`cell:${r}:${c}`, (pen) => fillRect(pen, cell, A.inset), fillInk(r * top.length + c));
      ink.label(`product:${r}:${c}`, numLatex(products[r * top.length + c]), { x: cell.x + cell.w / 2, y: cell.y + cell.h / 2 }, "center", "middle", size);
    }),
  );
  let y = y0 + Hd + A.sumGap;
  sum.forEach((line, i) => {
    // centred under the rectangle, kept inside the box when it is the wider
    const half = (m(line)?.w ?? 0) / 2;
    const cx = Math.min(Math.max(x0 + Wd / 2, half), box.w - 8 - half);
    const r = ink.label(`sum:${i}`, line, { x: cx, y }, "center", "top", size);
    if (r) y = r.y + r.h + 12;
  });
  if (ink.texts.length !== top.length + side.length + products.length + sum.length) return null;
  return ink.finish(box);
}

export function planAreaModel(spec: Area, box: { w: number; h: number }, seed: number): ModelSketch | null {
  for (let size = MODEL_TEXT.label; size >= MODEL_TEXT.min; size -= 2) {
    const s = attempt(spec, box, seed, size);
    if (s) return s;
  }
  return null;
}
