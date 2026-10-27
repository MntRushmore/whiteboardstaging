/**
 * The exact check (docs/KEYS.md, "The check"): every filled cell, the typed steps and the answer row,
 * judged the moment the kid asks (Enter in the answer row, Ctrl+Enter), never while they think.
 * Pure: the same input gives the same marks.
 */
import { allCells, answerFromWork, answerLine, canonicalAnswer, lineIds, lineOfCell, type MathItem, type Values } from "./item";

export type Mark = "tick" | "ring";

/** The answer row's line id; typed steps are `step:<index>`. */
export const ANSWER_LINE = "answer";
export const stepLine = (index: number) => `step:${index}`;

export interface ProblemInput {
  values: Values;
  /** the answer row as typed */
  answer: string;
  /** the typed steps under the work */
  steps?: readonly string[];
}

export interface CheckResult {
  /** there was something to judge: an answer typed, or the work's answer line filled */
  ready: boolean;
  /** solved: the answer is right and no filled cell is off */
  ok: boolean;
  /** the answer that was judged (typed, else read from the work) */
  answer: string;
  answerOk: boolean;
  /** filled kid cells that are off, in page order */
  wrongCells: string[];
  /** kid cells still empty (never judged) */
  emptyCells: string[];
  /** a tick or a ring per line id (column lines, `step:n`, `answer`) */
  marks: Record<string, Mark>;
  /** the first line that broke, in page order; null when none did */
  firstBadLine: string | null;
}

function cellOff(role: string, expect: string | undefined, spare: boolean | undefined, raw: string): boolean {
  const v = raw.trim();
  if (!v) return false;
  if (role === "carry") return v !== (expect ?? "0");
  if (spare) return v !== "0";
  return v !== expect;
}

/** Judges one item. Empty cells are left alone; a carry cell is optional. */
export function check(item: MathItem, input: ProblemInput): CheckResult {
  const { values } = input;
  const steps = input.steps ?? [];
  const wrongCells: string[] = [];
  const emptyCells: string[] = [];
  for (const c of allCells(item)) {
    if (c.role === "given") continue;
    const v = values[c.id] ?? "";
    if (!v.trim()) {
      if (c.role !== "carry" && !c.spare) emptyCells.push(c.id);
      continue;
    }
    if (cellOff(c.role, c.expect, c.spare, v)) wrongCells.push(c.id);
  }

  const fromWork = answerFromWork(item, values);
  const typed = input.answer.trim();
  const answer = typed ? canonicalAnswer(item, typed) : fromWork ? canonicalAnswer(item, fromWork) : "";
  const ready = answer !== "";
  const answerOk = ready && answer === item.answer;

  const marks: Record<string, Mark> = {};
  const badLines = new Set(wrongCells.map((id) => lineOfCell(item, id)).filter((l): l is string => l !== null));
  for (const l of badLines) marks[l] = "ring";
  // The work's answer line gets a tick once it is filled and right.
  const workLine = answerLine(item);
  if (workLine && !badLines.has(workLine) && fromWork !== null && canonicalAnswer(item, fromWork) === item.answer) marks[workLine] = "tick";

  steps.forEach((s, i) => {
    const m = judgeStep(s);
    if (m) marks[stepLine(i)] = m;
  });

  if (ready) {
    // An answer that only carries a slip from the work gets no mark of its own (as on the iPad).
    const carried = !answerOk && workLine !== null && badLines.has(workLine) && fromWork !== null && canonicalAnswer(item, fromWork) === answer;
    if (answerOk && wrongCells.length === 0) marks[ANSWER_LINE] = "tick";
    else if (!answerOk && !carried) marks[ANSWER_LINE] = "ring";
  }

  const order = [...lineIds(item), ...steps.map((_, i) => stepLine(i)), ANSWER_LINE];
  const firstBadLine = order.find((l) => marks[l] === "ring") ?? null;

  return {
    ready,
    ok: answerOk && wrongCells.length === 0,
    answer,
    answerOk,
    wrongCells,
    emptyCells,
    marks,
    firstBadLine,
  };
}

// ---------------------------------------------------------------- typed steps

/**
 * A typed step judged as a sum: `6 + 6 = 12` is a tick, `2 + 7 = 8` a ring. A line with no `=`, one
 * that ends in `=` (unfinished), or one that is not plain arithmetic gets no mark.
 */
export function judgeStep(text: string): Mark | null {
  const t = text
    .replace(/\s+/g, "")
    .replace(/[×xX*·]/g, "*")
    .replace(/[÷:]/g, "/")
    .replace(/[−–—]/g, "-");
  if (!t.includes("=")) return null;
  const sides = t.split("=");
  if (sides.some((s) => s === "")) return null;
  const vals = sides.map(evaluate);
  if (vals.some((v) => v === null)) return null;
  const first = vals[0]!;
  return vals.every((v) => Math.abs(v! - first) < 1e-9) ? "tick" : "ring";
}

/** + − × ÷, brackets and decimals; null for anything else. */
export function evaluate(expr: string): number | null {
  let i = 0;
  const peek = () => expr[i];
  function number(): number | null {
    const m = /^\d+(\.\d+)?/.exec(expr.slice(i));
    if (!m) return null;
    i += m[0].length;
    return Number(m[0]);
  }
  function factor(): number | null {
    if (peek() === "-") {
      i++;
      const v = factor();
      return v === null ? null : -v;
    }
    if (peek() === "(") {
      i++;
      const v = sum();
      if (v === null || peek() !== ")") return null;
      i++;
      return v;
    }
    return number();
  }
  function product(): number | null {
    let v = factor();
    while (v !== null && (peek() === "*" || peek() === "/")) {
      const op = expr[i++];
      const r = factor();
      if (r === null || (op === "/" && r === 0)) return null;
      v = op === "*" ? v * r : v / r;
    }
    return v;
  }
  function sum(): number | null {
    let v = product();
    while (v !== null && (peek() === "+" || peek() === "-")) {
      const op = expr[i++];
      const r = product();
      if (r === null) return null;
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }
  const v = sum();
  return v !== null && i === expr.length && Number.isFinite(v) ? v : null;
}
