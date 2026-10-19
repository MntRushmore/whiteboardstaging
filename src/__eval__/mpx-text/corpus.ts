/**
 * The lines of the v3/text eval: every line the web's handwriting scoreboards write, kept with the
 * page-space strokes the board would crop (src/lib/live/inkCrop.ts draws those, not the normalized
 * payload) and with Mathpix's STROKES read of the same ink when one is already on disk.
 *
 * The same sets as the iPad reader study (ios/Packages/AgathonReader/Tools/reader-eval/export-corpus.mjs
 * on feat/ipad-reader):
 *  - `scoreboard`: src/__eval__/corpus.ts, every written line, in the four student hands of handwriting.ts;
 *  - `young`: young/corpus.ts, K–6 working (the lines a hand can write; stacks are `stacked`);
 *  - `bars`: drawings.ts, the divisors under a division bar, and long division;
 *  - `stacked`: stacked.test.ts's column sums, sent as ONE block (the board's `splitInk` stack);
 *  - `drawings`: drawings.ts, a drawing on its own — the negatives: no maths to read.
 *
 * Strokes reads are never fetched here: the scoreboard's cache (sha-1 of the request body,
 * src/__eval__/.cache/mathpix in this or a sibling checkout, read only), else
 * docs/eval/handwriting.json for the same problem, hand and line.
 *
 * Nothing in it is a child's writing: all of it is the tutor's hand engine (`layoutMath`) put
 * through the scoreboard's perturbations.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { InkLine, InkStroke, Rect, StrokePayload } from "@/lib/live/contracts";
import { splitInk } from "@/lib/live/diagrams";
import { toInkStrokes, writeStack } from "@/lib/live/__fixtures__/strokes";
import { unionRects } from "@/lib/live/strokeClusters";
import { buildPayload } from "@/lib/live/strokePayload";
import { CORPUS } from "../corpus";
import { BAR_DIVISORS, DRAWINGS } from "../drawings";
import { cacheKey, handInk, payloadFor, VARIANTS } from "../handwriting";
import { YOUNG_CORPUS } from "../young/corpus";

export const ROOT = resolve(__dirname, "..", "..", "..");

export type LineSet = "scoreboard" | "young" | "bars" | "stacked" | "drawings";

export type LineType =
  | "arithmetic"
  | "fractions"
  | "exponents / roots"
  | "equations"
  | "letters / variables"
  | "calculus, trig, units"
  | "long division"
  | "stacked sums"
  | "young kids' lines"
  | "drawing (no maths)";

export const LINE_TYPES: readonly LineType[] = [
  "arithmetic",
  "fractions",
  "exponents / roots",
  "equations",
  "letters / variables",
  "calculus, trig, units",
  "long division",
  "stacked sums",
  "young kids' lines",
  "drawing (no maths)",
];

export interface StrokesRead {
  latex: string;
  confidence: number;
  /** false: Mathpix answered that it could not read the ink (`api_error`) */
  ok: boolean;
  source: string;
}

export interface EvalLine {
  /** unique: set / id / line / hand */
  key: string;
  set: LineSet;
  id: string;
  type: LineType;
  /** the line has a letter that is a variable (not a function name, a unit or `\times`) */
  letters: boolean;
  variant: string;
  /** what was written ("" for a drawing) */
  latex: string;
  /** page-space strokes, one polyline per segment (what `captureInkCrop` draws) */
  segments: Array<Array<{ x: number; y: number }>>;
  /** page-space bounds of the line (the board's `line.bounds`) */
  bounds: Rect;
  payload: StrokePayload;
  cacheKey: string;
  strokes: StrokesRead | null;
}

// ---------------------------------------------------------------- line types

const LONG_DIVISION = /\\overline\s*\{\s*\\?\)|\\longdiv|\\enclose/;

/** The line's kind for the report (first match wins), from the LaTeX that was written. */
export function lineType(latex: string, set: LineSet): LineType {
  if (set === "drawings") return "drawing (no maths)";
  if (set === "stacked") return "stacked sums";
  if (LONG_DIVISION.test(latex)) return "long division";
  if (set === "young") return "young kids' lines";
  if (/\\int|\\lim|\\frac\{d\^?\{?\d*\}?\}\{d|\\sum|\\prime|'|\\(sin|cos|tan|ln|log)\b|\\mathrm|\\text|\?|%|\\circ/.test(latex)) return "calculus, trig, units";
  if (/\\frac/.test(latex)) return "fractions";
  if (/\^|\\sqrt/.test(latex)) return "exponents / roots";
  const letters = hasLetters(latex);
  if (letters && /=|<|>|\\le|\\ge|\\neq/.test(latex)) return "equations";
  if (letters) return "letters / variables";
  return "arithmetic";
}

/** A letter that is a variable: not inside a command name (`\times`, `\frac`), a function or a unit. */
export function hasLetters(latex: string): boolean {
  const bare = latex
    .replace(/\\(?:mathrm|text|operatorname)\s*\{[^{}]*\}/g, " ")
    .replace(/\\[a-zA-Z]+/g, " ")
    .replace(/\b(?:sin|cos|tan|ln|log|lim|dx|dy|dt)\b/g, " ");
  return /[a-zA-Z]/.test(bare);
}

// ---------------------------------------------------------------- strokes reads already on disk

/** The scoreboard's Mathpix caches: this checkout's and every sibling checkout's (read only). */
export function strokesCacheDirs(root = ROOT): string[] {
  const own = join(root, "src/__eval__/.cache/mathpix");
  const parent = dirname(root);
  const siblings = existsSync(parent)
    ? readdirSync(parent)
        .map((d) => join(parent, d, "src/__eval__/.cache/mathpix"))
        .filter((d) => d !== own && existsSync(d))
    : [];
  return [...(existsSync(own) ? [own] : []), ...siblings];
}

function checkoutOf(cacheDir: string): string {
  return basename(resolve(cacheDir, "..", "..", "..", ".."));
}

export function makeStrokesLookup(root = ROOT): (key: string, set: LineSet, ref?: string) => StrokesRead | null {
  const dirs = strokesCacheDirs(root);
  const fromJson = new Map<string, StrokesRead>();
  const file = join(root, "docs/eval/handwriting.json");
  if (existsSync(file)) {
    const board = JSON.parse(readFileSync(file, "utf8")) as { runs: Array<{ id: string; variant: string; lines: Array<{ read: string; recognized: string; confidence: number }> }> };
    for (const run of board.runs)
      run.lines.forEach((l, i) => {
        if (l.read === "skipped" || l.read === "unwritable") return;
        fromJson.set(`${run.id}/${run.variant}/${i}`, { latex: l.recognized, confidence: l.confidence, ok: l.read !== "failed", source: "handwriting.json" });
      });
  }
  return (key, set, ref) => {
    for (const dir of dirs) {
      const f = join(dir, `${key}.json`);
      if (!existsSync(f)) continue;
      const rec = JSON.parse(readFileSync(f, "utf8")) as { ok: boolean; latex: string; confidence: number };
      return { latex: rec.ok ? rec.latex : "", confidence: rec.ok ? rec.confidence : 0, ok: rec.ok, source: `cache:${checkoutOf(dir)}` };
    }
    return set === "scoreboard" && ref ? (fromJson.get(ref) ?? null) : null;
  };
}

// ---------------------------------------------------------------- the sets

function segmentsOf(strokes: readonly InkStroke[]): Array<Array<{ x: number; y: number }>> {
  return strokes.flatMap((s) => s.segments.map((seg) => seg.map((p) => ({ x: p.x, y: p.y }))));
}

/** The young corpus' extra long divisions (the board reads `9 \longdiv{144}` style brackets; prod: `144 \div 9`). */
export const LONG_DIVISIONS = ["3 \\overline{)126}", "9 \\overline{)144}", "7 \\overline{)84}", "4 \\overline{)128}", "6 \\overline{)252}"];

/** The column sums of stacked.test.ts (one hand: the fixture's), with the result each must work out to. */
export const STACKS: ReadonlyArray<readonly [rows: string, write: () => ReturnType<typeof writeStack>, result: string]> = [
  ["286 \\\\ +680 \\\\ \\hline 966", () => writeStack(["286", "+680"], "966", { carries: [{ place: 2, digit: "1" }] }), "966"],
  ["286 \\\\ +680 \\\\ \\hline 866", () => writeStack(["286", "+680"], "866"), "966"],
  ["52 \\\\ -17 \\\\ \\hline 35", () => writeStack(["52", "-17"], "35", { borrow: { place: 1, digit: "4" } }), "35"],
  ["23 \\\\ \\times 4 \\\\ \\hline 92", () => writeStack(["23", "\\times 4"], "92"), "92"],
  ["125 \\\\ 48 \\\\ +302 \\\\ \\hline 475", () => writeStack(["125", "48", "+302"], "475"), "475"],
  ["3.50 \\\\ +12.25 \\\\ \\hline 15.75", () => writeStack(["3.50", "+12.25"], "15.75"), "15.75"],
  ["4807 \\\\ +3295 \\\\ \\hline 8102", () => writeStack(["4807", "+3295"], "8102", { carries: [{ place: 1, digit: "1" }, { place: 2, digit: "1" }] }), "8102"],
  ["347 \\\\ +285 \\\\ \\hline 632", () => writeStack(["347", "+285"], "632", { carries: [{ place: 1, digit: "1" }, { place: 2, digit: "1" }] }), "632"],
  ["503 \\\\ -168 \\\\ \\hline 335", () => writeStack(["503", "-168"], "335"), "335"],
  ["64 \\\\ \\times 3 \\\\ \\hline 192", () => writeStack(["64", "\\times 3"], "192", { carries: [{ place: 1, digit: "1" }] }), "192"],
];

/** The sum a stack must work out to, by its rows' LaTeX. */
export const STACK_RESULTS = new Map(STACKS.map(([rows, , result]) => [`\\begin{array}{r} ${rows} \\end{array}`, result]));

/** Every line of every set (deterministic: the same corpus every run). */
export function buildCorpus(root = ROOT): EvalLine[] {
  const lookup = makeStrokesLookup(root);
  const out: EvalLine[] = [];
  const seen = new Set<string>();
  const push = (line: EvalLine) => {
    if (seen.has(line.key)) return;
    seen.add(line.key);
    out.push(line);
  };
  const handLine = (set: LineSet, id: string, variant: (typeof VARIANTS)[number], latex: string, key: string, ref?: string) => {
    const ink = handInk(latex, variant);
    if (ink.unsupported.length > 0) return;
    const lp = payloadFor(ink.strokes);
    if (!lp.payload) return;
    const k = cacheKey(lp.payload);
    push({
      key,
      set,
      id,
      type: lineType(latex, set),
      letters: hasLetters(latex),
      variant: variant.name,
      latex,
      segments: segmentsOf(ink.strokes),
      bounds: unionRects(ink.strokes.map((s) => s.bounds)),
      payload: lp.payload,
      cacheKey: k,
      strokes: lookup(k, set, ref),
    });
  };

  // 1. the scoreboard, in the four hands
  for (const variant of VARIANTS)
    for (const p of CORPUS) p.lines.forEach((latex, i) => handLine("scoreboard", p.id, variant, latex, `scoreboard/${p.id}/${i}/${variant.name}`, `${p.id}/${variant.name}/${i}`));

  // 2. young kids' working (stacks are set 4)
  for (const variant of VARIANTS)
    for (const c of YOUNG_CORPUS)
      for (const latex of [...(c.problem ? [c.problem] : []), ...c.work.map(([l]) => l)]) {
        if (/\\begin\{array\}/.test(latex)) continue;
        handLine("young", c.id, variant, latex, `young/${latex}/${variant.name}`);
      }

  // 3. division bars: the divisor under a bar, and long division
  for (const variant of VARIANTS) for (const latex of [...BAR_DIVISORS, ...LONG_DIVISIONS]) handLine("bars", latex, variant, latex, `bars/${latex}/${variant.name}`);

  // 4. stacked sums, one block each (the board's `splitInk` stack, as stacked.test.ts sends it)
  for (const [rows, write] of STACKS) {
    const latex = `\\begin{array}{r} ${rows} \\end{array}`;
    const ink = toInkStrokes(write().all);
    const [stack] = splitInk(ink).stacks;
    if (!stack) continue;
    const byId = new Map(ink.map((s) => [s.id as string, s]));
    const strokes = stack.strokeIds.map((id) => byId.get(id)!).filter(Boolean);
    const line: InkLine = { id: "eval", strokeIds: stack.strokeIds, bounds: unionRects(strokes.map((s) => s.bounds)), column: 0, row: 0, hash: "" };
    const payload = buildPayload(line, ink);
    if (!payload) continue;
    const k = cacheKey(payload);
    push({ key: `stacked/${rows}`, set: "stacked", id: rows, type: "stacked sums", letters: false, variant: "fixture", latex, segments: segmentsOf(strokes), bounds: line.bounds, payload, cacheKey: k, strokes: lookup(k, "stacked") });
  }

  // 5. drawings alone (the negatives)
  for (const variant of VARIANTS) {
    let seed = 900 + VARIANTS.indexOf(variant) * 50;
    for (const [name, make] of Object.entries(DRAWINGS)) {
      const strokes = make(0, 0, ++seed).strokes;
      const line: InkLine = { id: "eval", strokeIds: strokes.map((s) => s.id), bounds: unionRects(strokes.map((s) => s.bounds)), column: 0, row: 0, hash: "" };
      const payload = buildPayload(line, strokes);
      if (!payload) continue;
      const k = cacheKey(payload);
      push({ key: `drawings/${name}/${variant.name}`, set: "drawings", id: name, type: "drawing (no maths)", letters: false, variant: variant.name, latex: "", segments: segmentsOf(strokes), bounds: line.bounds, payload, cacheKey: k, strokes: lookup(k, "drawings") });
    }
  }
  return out;
}
