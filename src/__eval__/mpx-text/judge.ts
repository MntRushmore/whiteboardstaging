/**
 * Was the line read as written? The web scoreboard's own judge (`judgeRead`, src/__eval__/handwriting.ts:
 * `exact` once spacing, braces and `\left` are ignored, `semantic` when the engine's oracle finds the
 * same maths) for an ordinary line; for the two layouts it cannot parse, the board's own readers:
 *
 *  - a stacked sum: `parseStacked` (engine/columnArithmetic.ts) on the read and on what was written,
 *    and the same operator, operands and answer;
 *  - a long division: the divisor and dividend of the bracket, as `primaryWork.ts` reads one
 *    (`\longdiv{126}`, `\enclose{longdiv}`, `\overline{)126}`, `3)\overline{126}`, `\right)`).
 *
 * A drawing on its own is read right when nothing is read from it (an empty read, or the reader
 * saying it cannot read it).
 */
import { parseStacked } from "@/lib/live/engine/columnArithmetic";
import { judgeRead } from "../handwriting";
import type { EvalLine } from "./corpus";

export type Verdict = "exact" | "semantic" | "wrong" | "failed";

export const isRight = (v: Verdict | null | undefined): boolean => v === "exact" || v === "semantic";

/** primaryWork.ts' `BRACKETS` (not exported there): the bracket's divisor and dividend. */
const BRACKETS = [
  /(\d+)\s*\\longdiv\s*\{\s*([\d\s]+)\}/,
  /(\d+)\s*\\longdiv\s*(\d+)/,
  /(\d+)\s*\\enclose\s*\{\s*longdiv\s*\}\s*\{\s*([\d\s]+)\}/,
  /(\d+)\s*\\overline\s*\{\s*\\?\)\s*([\d\s]+)\}/,
  /(\d+)\s*\\?\)\s*\\overline\s*\{\s*([\d\s]+)\}/,
  /(\d+)\s*\\right\s*\)\s*\{?\s*(\d+)/,
];

export function readBracket(latex: string): { divisor: number; dividend: number } | null {
  for (const re of BRACKETS) {
    const m = re.exec(latex);
    if (!m) continue;
    const divisor = Number(m[1]);
    const dividend = Number(m[2].replace(/\s+/g, ""));
    if (divisor && Number.isFinite(dividend)) return { divisor, dividend };
  }
  return null;
}

/** The LaTeX of a read, as a judge sees it (a read on several lines is one array). */
function oneLine(read: string): string {
  return read.trim();
}

/** The verdict on one read of `line`; `ok: false` is the reader answering it could not read the ink. */
export function judgeLine(line: Pick<EvalLine, "type" | "latex" | "set">, read: { ok: boolean; latex: string }): Verdict {
  if (line.set === "drawings") return !read.ok || read.latex.trim() === "" ? "exact" : "wrong";
  if (!read.ok) return "failed";
  const got = oneLine(read.latex);
  if (!got) return "wrong";
  if (line.type === "stacked sums") {
    const want = parseStacked(line.latex);
    const have = parseStacked(got.replace(/^\\\[|\\\]$/g, "").trim());
    if (!want || !have) return "wrong";
    const same = want.op === have.op && want.answer === have.answer && want.operands.join("|") === have.operands.join("|");
    return same ? "semantic" : "wrong";
  }
  if (line.type === "long division") {
    const want = readBracket(line.latex);
    const have = readBracket(got);
    return want && have && want.divisor === have.divisor && want.dividend === have.dividend ? "semantic" : "wrong";
  }
  try {
    return judgeRead(line.latex, got);
  } catch {
    return "wrong";
  }
}
