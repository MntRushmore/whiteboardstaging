/**
 * Scoring a worksheet split (pure: no canvas, no network) — see worksheets.ts for the pages and
 * the readers. A region that starts with a problem number opens that problem; every other region
 * belongs to the nearest number above it in its column; a problem is split right when the union of
 * its regions overlaps where it really is (IoU ≥ 0.5).
 */
import type { Rect } from "@/lib/live/contracts";
import type { PageRead, Worksheet } from "./worksheets";

export function union(rs: readonly Rect[]): Rect {
  const x0 = Math.min(...rs.map((r) => r.x));
  const y0 = Math.min(...rs.map((r) => r.y));
  const x1 = Math.max(...rs.map((r) => r.x + r.w));
  const y1 = Math.max(...rs.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function area(r: Rect): number {
  return Math.max(0, r.w) * Math.max(0, r.h);
}
function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}
function iou(a: Rect, b: Rect): number {
  const o = overlap(a, b);
  return o / Math.max(1, area(a) + area(b) - o);
}

/**
 * The problem number a region starts with and how it is written: `3.` (also as document layout's
 * `\begin{itemize} \item[3.]`) or `3)`; null when it starts with none.
 */
export function leadingNumber(text: string): { n: number; style: "." | ")" } | null {
  const m = /^\s*(?:\\begin\{(?:itemize|enumerate)\}\s*)?(?:\\item\s*\[\s*)?(?:\\\(\s*)?(?:\*\*)?\s*(\d{1,2})\s*(?:\\\)\s*)?([.)])(?!\d)/.exec(text);
  return m ? { n: Number(m[1]), style: m[2] as "." | ")" } : null;
}

export interface SplitScore {
  problems: number;
  regions: number;
  numbersFound: number;
  /** regions over one problem only (≥ 80 % of the region's area in one problem's box), of those over any */
  pureRegions: number;
  regionsOverProblems: number;
  splitRight: number;
  handwriting: number;
  handwritingAttached: number;
  /** the problems split right, by number */
  right: number[];
  /** what each problem's regions say, in Mathpix's order (` ⏎ ` between regions) */
  texts: Record<number, string>;
}

export function scoreSplit(sheet: Worksheet, read: PageRead): SplitScore {
  const sx = sheet.width / Math.max(1, read.width);
  const sy = sheet.height / Math.max(1, read.height);
  const regions = read.regions.map((r) => ({ ...r, box: { x: r.box.x * sx, y: r.box.y * sy, w: r.box.w * sx, h: r.box.h * sy } }));
  const truth = sheet.problems;
  // which problem each region sits in (by area), if any
  const homeOf = (box: Rect) => {
    let best: Worksheet["problems"][number] | null = null;
    let bestShare = 0;
    for (const p of truth) {
      const share = overlap(box, p.box) / Math.max(1, area(box));
      if (share > bestShare) [best, bestShare] = [p, share];
    }
    return { problem: best, share: bestShare };
  };
  const over = regions.filter((r) => homeOf(r.box).share > 0.2);
  const pure = over.filter((r) => homeOf(r.box).share >= 0.8);
  // the split: a numbered region opens a problem; a region belongs to the nearest opener above it in its column
  // a page numbered `1.` has its `6)` in a long division's bracket, not a problem; each number opens once
  const numbered = regions.map((r, i) => ({ i, lead: leadingNumber(r.text), box: r.box })).filter((o) => o.lead !== null);
  const dotted = numbered.some((o) => o.lead!.style === ".");
  const seen = new Set<number>();
  const openers = numbered
    .filter((o) => (!dotted || o.lead!.style === ".") && !seen.has(o.lead!.n) && Boolean(seen.add(o.lead!.n)))
    .map((o) => ({ i: o.i, n: o.lead!.n, box: o.box }));
  const groups = new Map<number, Rect[]>();
  const owner = new Map<number, number>();
  for (const [i, r] of regions.entries()) {
    const own = openers.find((o) => o.i === i);
    if (own) {
      groups.set(own.n, [...(groups.get(own.n) ?? []), r.box]);
      owner.set(i, own.n);
      continue;
    }
    // its column: the nearest numbers whose left edge is left of the region's middle; then the nearest above it there
    const cx = r.box.x + r.box.w / 2;
    const above = openers.filter((o) => o.box.y <= r.box.y + r.box.h * 0.5 && o.box.x <= cx + 40);
    if (above.length === 0) continue;
    const column = Math.max(...above.map((o) => o.box.x));
    const near = above.filter((o) => column - o.box.x < 150).reduce((a, b) => (b.box.y > a.box.y ? b : a));
    groups.set(near.n, [...(groups.get(near.n) ?? []), r.box]);
    owner.set(i, near.n);
  }
  const right: number[] = [];
  for (const p of truth) {
    const g = groups.get(p.n);
    if (g && iou(union(g), p.box) >= 0.5) right.push(p.n);
  }
  // the kid's writing: each handwritten box of the truth, is the region over it owned by its problem?
  let handwriting = 0;
  let attached = 0;
  for (const p of truth)
    for (const h of p.hand) {
      handwriting++;
      const i = regions.findIndex((r) => overlap(r.box, h) / Math.max(1, area(h)) >= 0.5);
      if (i >= 0 && owner.get(i) === p.n) attached++;
    }
  const texts: Record<number, string> = {};
  for (const [i, r] of regions.entries()) {
    const n = owner.get(i);
    if (n === undefined) continue;
    const t = r.text.replace(/\s+/g, " ").trim();
    texts[n] = texts[n] ? `${texts[n]} ⏎ ${t}` : t;
  }
  const numbers = new Set(openers.map((o) => o.n));
  return {
    problems: truth.length,
    regions: regions.length,
    numbersFound: truth.filter((p) => numbers.has(p.n)).length,
    pureRegions: pure.length,
    regionsOverProblems: over.length,
    splitRight: right.length,
    handwriting,
    handwritingAttached: attached,
    right,
    texts,
  };
}
