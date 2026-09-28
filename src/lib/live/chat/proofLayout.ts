import type { Rect } from "../contracts";
import { Pen } from "../graphing/pen";
import { planFromGroups } from "../graphing/plan";
import { placeHandPlan, placeHandPlanOnBaseline, planHandwriting, type HandPlan } from "../handwriting";
import { givenLineLatex, proveLineLatex } from "./proof";
import { joinPlans } from "./layout";

/**
 * Where the board chat writes a two-column proof (`write_proof`) on a 1600×900 screen: the figure
 * top right; `Given:` and `Prove:` top left; under them the table — `Statements | Reasons` over a
 * level rule, an upright rule between the columns — and, for a worked proof, every row in it.
 *
 * Laid out EXACTLY as the proof reader reads a student's proof (`proof/read.ts`), because that is
 * how the board knows it afterwards: the Given line (with its continuation lines under it), the
 * Prove line, the header, then each row's statement at the statement column's left edge and its
 * reason level with it at the reason column's. A proof set up for the student (`worked: false`)
 * leaves the table empty down to the bottom of the screen: the student writes rows in it and gets
 * ticks and rings; Help / Solve continue it (`ProofDesk`), their rows going under the header, the
 * reason under `Reasons`.
 *
 * Rows are at least `rowPitchMin` apart: the reader groups the tutor's strokes into lines by block
 * and LaTeX (`tutorLinesOf`), and two rows with the same reason (`Given`, `CPCTC`) must stay two.
 * Pure: plans in page px; the desk writes them.
 */

export const PROOF_LAYOUT = {
  /** hand sizes tried, largest first, until the proof fits */
  sizes: [34, 31, 28, 25],
  /** figure boxes tried, largest first */
  figureBoxes: [
    { w: 460, h: 380 },
    { w: 400, h: 330 },
    { w: 340, h: 290 },
  ],
  /** screen margins (the board's bar floats over the top edge) */
  marginX: 56,
  marginTop: 84,
  marginBottom: 40,
  /** between the text column and the figure */
  figureGap: 56,
  /** between two rows, at least (px) and as a share of the hand size */
  rowPitchMin: 56,
  rowPitchFactor: 1.75,
  /** a proof set up for the student: its statement column's share of the table, and the room its rows need */
  setupStatementShare: 0.54,
  setupRowsRoom: 5 * 80,
} as const;

export interface ProofLayoutInput {
  screen: Rect;
  /** the Given statements and the Prove statement, as the board writes them (`CheckedProof`) */
  given: readonly string[];
  prove: string;
  /** the rows of a worked proof; null sets it up for the student */
  rows: ReadonlyArray<{ statement: string; reasonLatex: string }> | null;
  /** the figure drawn into a box (px from 0, 0); null when it cannot be */
  figure: (box: { w: number; h: number }) => HandPlan | null;
  seed: number;
}

export interface ProofLayout {
  size: number;
  /** placed plans, in the order the hand writes them */
  figure: HandPlan;
  /** `Given:` (and its continuation lines) and `Prove:` */
  statements: HandPlan;
  /** the table's two rules */
  table: HandPlan;
  /** `Statements`, `Reasons` and the rows */
  body: HandPlan;
  /** where things are (page px), for the tests and the desk */
  statementX: number;
  reasonX: number;
  dividerX: number;
  barY: number;
  tableBottom: number;
  bounds: Rect;
}

const HEADER = { statements: "\\text{Statements}", reasons: "\\text{Reasons}" } as const;

function line(latex: string, size: number, seed: number): HandPlan | null {
  const r = planHandwriting([latex], { size, seed });
  return r.plan && r.unsupported.length === 0 ? r.plan : null;
}

function union(rects: readonly Rect[]): Rect {
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w));
  const y1 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

const right = (r: Rect) => r.x + r.w;
const bottom = (r: Rect) => r.y + r.h;

/**
 * The Given statements on as few lines as fit the width: `Given: g1, g2` and the rest on the lines
 * under it, indented past `Given:` (the reader takes those as the Given line continued).
 */
function givenLines(given: readonly string[], width: number, size: number, seed: number): { first: HandPlan; rest: HandPlan[]; indent: number } | null {
  const label = line("\\text{Given:}", size, seed);
  if (!label) return null;
  const indent = label.bounds.w + 0.45 * size;
  let first: HandPlan | null = null;
  let taken = 0;
  for (let k = given.length; k >= 1; k--) {
    const p = line(givenLineLatex(given.slice(0, k)), size, seed);
    if (!p) return null;
    if (p.bounds.w <= width || k === 1) {
      first = p;
      taken = k;
      break;
    }
  }
  if (!first) return null;
  const rest: HandPlan[] = [];
  let pending = given.slice(taken);
  while (pending.length > 0) {
    let placed = false;
    for (let k = pending.length; k >= 1; k--) {
      const p = line(pending.slice(0, k).join(", \\ "), size, seed + rest.length + 1);
      if (!p) return null;
      if (p.bounds.w <= width - indent || k === 1) {
        rest.push(p);
        pending = pending.slice(k);
        placed = true;
        break;
      }
    }
    if (!placed) return null;
  }
  return { first, rest, indent };
}

function layoutAt(input: ProofLayoutInput, size: number, box: { w: number; h: number }): ProofLayout | null {
  const L = PROOF_LAYOUT;
  const s = input.screen;
  const area = { x: s.x + L.marginX, y: s.y + L.marginTop, w: s.w - 2 * L.marginX, h: s.h - L.marginTop - L.marginBottom };
  const figurePlan = input.figure(box);
  if (!figurePlan) return null;
  const figure = placeHandPlan(figurePlan, { x: right(area) - figurePlan.bounds.w, y: area.y });
  const x0 = area.x;
  const textRight = figure.bounds.x - L.figureGap;
  const width = textRight - x0;
  if (width < 320) return null;
  const seed = input.seed;

  // Given (continued) and Prove, stacked from the top
  const given = givenLines(input.given, width, size, seed);
  const prove = line(proveLineLatex(input.prove), size, seed + 11);
  if (!given || !prove || prove.bounds.w > width) return null;
  const gap = 0.5 * size;
  const top: HandPlan[] = [];
  let y = area.y;
  top.push(placeHandPlan(given.first, { x: x0, y }));
  y = bottom(top[0].bounds) + gap;
  for (const r of given.rest) {
    const placed = placeHandPlan(r, { x: x0 + given.indent, y });
    top.push(placed);
    y = bottom(placed.bounds) + gap;
  }
  const provePlaced = placeHandPlan(prove, { x: x0, y });
  top.push(provePlaced);
  y = bottom(provePlaced.bounds) + 0.8 * size;

  // the rows' plans, to size the columns
  const rows = (input.rows ?? []).map((row, i) => ({ s: line(row.statement, size, seed + 20 + 2 * i), r: line(row.reasonLatex, size, seed + 21 + 2 * i) }));
  if (rows.some((row) => !row.s || !row.r)) return null;
  const hS = line(HEADER.statements, size, seed + 13);
  const hR = line(HEADER.reasons, size, seed + 14);
  if (!hS || !hR) return null;
  const colGap = 0.55 * size;
  let dividerX: number;
  let tableRight: number;
  if (input.rows) {
    const stmtW = Math.max(hS.bounds.w, ...rows.map((row) => row.s!.bounds.w));
    const reasonW = Math.max(hR.bounds.w, ...rows.map((row) => row.r!.bounds.w));
    dividerX = x0 + stmtW + colGap;
    tableRight = dividerX + colGap + reasonW + 0.3 * size;
  } else {
    dividerX = x0 + Math.max(hS.bounds.w + colGap, Math.min(560, L.setupStatementShare * width));
    tableRight = textRight;
  }
  if (tableRight > textRight) return null;
  const reasonX = dividerX + colGap;

  // the header on one writing line, the level rule under it
  const headTop = y;
  const headBase = headTop + Math.max(hS.lines[0].baseline, hR.lines[0].baseline);
  const header = [placeHandPlanOnBaseline(hS, { x: x0, baselineY: headBase }), placeHandPlanOnBaseline(hR, { x: reasonX, baselineY: headBase })];
  const barY = Math.max(...header.map((h) => bottom(h.bounds))) + 0.35 * size;

  // the rows, one pitch apart, each on one writing line
  const pitch = Math.max(L.rowPitchMin, L.rowPitchFactor * size);
  const placedRows: HandPlan[] = [];
  let base = 0;
  let lastBottom = barY;
  rows.forEach((row, i) => {
    const ascent = Math.max(row.s!.lines[0].baseline, row.r!.lines[0].baseline);
    base = i === 0 ? barY + 0.4 * size + ascent : base + pitch;
    // never onto the row above (a tall `\overline` row after a deep one)
    if (base - ascent < lastBottom + 0.25 * size) base = lastBottom + 0.25 * size + ascent;
    const st = placeHandPlanOnBaseline(row.s!, { x: x0, baselineY: base });
    const re = placeHandPlanOnBaseline(row.r!, { x: reasonX, baselineY: base });
    placedRows.push(st, re);
    lastBottom = Math.max(bottom(st.bounds), bottom(re.bounds));
  });
  const areaBottom = bottom(area);
  const tableBottom = input.rows ? lastBottom + 0.45 * size : areaBottom;
  if (!input.rows && tableBottom - barY < L.setupRowsRoom) return null;
  if (tableBottom > areaBottom + 0.5 || bottom(figure.bounds) > areaBottom + 0.5) return null;

  // the T: a level rule under the header, an upright one between the columns
  const pen = new Pen(seed + 5);
  const table = planFromGroups(
    [
      { label: "", strokes: pen.line({ x: x0 - 0.3 * size, y: barY }, { x: tableRight, y: barY }) },
      { label: "", strokes: pen.line({ x: dividerX, y: headTop - 0.15 * size }, { x: dividerX, y: tableBottom }) },
    ],
    size,
  );
  const statements = joinPlans(top, 300);
  const body = joinPlans([...header, ...placedRows], 250);
  if (!table || !statements || !body) return null;
  const all = [figure.bounds, statements.bounds, table.bounds, body.bounds];
  const bounds = union(all);
  if (bounds.x < s.x || right(bounds) > right(s) || bounds.y < s.y || bottom(bounds) > bottom(s)) return null;
  // nothing written over the figure
  const text = union([statements.bounds, table.bounds, body.bounds]);
  if (right(text) > figure.bounds.x - 0.5 * L.figureGap) return null;
  return { size, figure, statements, table, body, statementX: x0, reasonX, dividerX, barY, tableBottom, bounds };
}

/**
 * The proof laid out on the screen: the largest hand and figure that fit, the figure top right and
 * clear of all the writing. Null when it does not fit even at the smallest.
 */
export function layoutProof(input: ProofLayoutInput): ProofLayout | null {
  // the figure is planned once per box (its labels' layout is the slow part)
  const figures = new Map<string, HandPlan | null>();
  const figure = (box: { w: number; h: number }) => {
    const k = `${box.w}x${box.h}`;
    if (!figures.has(k)) figures.set(k, input.figure(box));
    return figures.get(k) ?? null;
  };
  for (const size of PROOF_LAYOUT.sizes) {
    for (const box of PROOF_LAYOUT.figureBoxes) {
      const out = layoutAt({ ...input, figure }, size, box);
      if (out) return out;
    }
  }
  return null;
}
