/**
 * Help me for a slip no bug rule names (docs/KEYS.md, Phase 2): the page asks the board's own check
 * endpoint (`POST /api/live/check`, the tutor that checks handwritten work) for a hint about the line
 * that broke. The page's own check has already decided THAT it broke and where; the endpoint only
 * finds the words. Until it answers (or when it fails), the nudge's fixed words stay.
 *
 * The request is the problem and the kid's typed work as lines, each with the page's own verdict, so
 * the model never judges a line the page judged right. A hint that would give the answer away (it
 * carries the answer of a problem with a 2-digit answer or more) is dropped.
 */
import type { CheckRequest } from "@/lib/live/contracts";
import { ANSWER_LINE, stepLine } from "./check";
import { numbersIn, SAY_MAX_CHARS, tidyLine } from "./copy";
import { allCells, lineIds, type MathItem } from "./item";
import { latexOf } from "./record";
import { rootValues, type ProblemState } from "./session";

/** How long the page waits for the check endpoint's hint (the fixed nudge shows meanwhile). */
export const HINT_WAIT_MS = 6000;

/** A column line as the kid sees it: its digits, a blank as `\square`. */
function columnLatex(item: MathItem, values: Record<string, string>, line: string): string | null {
  if (item.layout.kind !== "columns") return null;
  const l = item.layout.lines.find((x) => x.id === line);
  if (!l) return null;
  const digits = l.cells.map((c) => (c === null ? "" : c.role === "given" ? (c.value ?? "") : (values[c.id] ?? "").trim() || "\\square ")).join("");
  if (!digits.replace(/\\square /g, "")) return null;
  return `${l.op ? `${l.op} ` : ""}${digits}`;
}

/** The check endpoint's request for this problem's work, focused on the first line that broke. */
export function hintRequest(p: ProblemState): CheckRequest | null {
  const marks = p.result?.marks ?? p.marks;
  const focus = p.result?.firstBadLine ?? null;
  if (!focus) return null;
  const values = rootValues(p);
  const lines: CheckRequest["lines"] = [];
  const add = (id: string, latex: string | null, verdict: "ok" | "mismatch" | "unknown") => {
    if (!latex) return;
    const y = lines.length * 0.1;
    lines.push({ id, latex: latex.slice(0, 2000), bbox: [0, y, 1, y + 0.08], local: { kind: "expression", verdict } });
  };
  add("problem", latexOf(p.item), "unknown");
  for (const id of lineIds(p.item)) {
    if (id === "carry") continue;
    add(id, columnLatex(p.item, values, id), marks[id] === "ring" ? "mismatch" : marks[id] === "tick" ? "ok" : "unknown");
  }
  p.steps.forEach((t, i) => add(stepLine(i), t.trim() || null, marks[stepLine(i)] === "ring" ? "mismatch" : marks[stepLine(i)] === "tick" ? "ok" : "unknown"));
  add(ANSWER_LINE, p.answer.trim() ? `\\text{Answer: } ${p.answer.trim()}` : null, marks[ANSWER_LINE] === "ring" ? "mismatch" : "unknown");
  if (!lines.some((l) => l.id === focus)) return null;
  return {
    boardId: "keys",
    mode: "feedback",
    subject: "other",
    region: { x: 0, y: 0, w: 1000, h: 1000 },
    lines: lines.slice(0, 40),
    focusLineId: focus,
    userAsked: true,
  };
}

/** The hint's words when they are fit for the page: short, plain, and not the answer. */
export function usableHint(item: MathItem, message: string, question?: string): string | null {
  const text = tidyLine([message, question].filter(Boolean).join(" "));
  if (!text || text.length > SAY_MAX_CHARS * 1.5) return null;
  if (/\\|\$|wrong|incorrect/i.test(text)) return null;
  if (item.answer.length >= 2 && numbersIn(text).includes(item.answer)) return null;
  // never a kid cell's value the page knows is due
  const due = allCells(item)
    .filter((c) => c.role !== "given" && c.expect && c.expect.length >= 2)
    .map((c) => c.expect);
  if (numbersIn(text).some((n) => due.includes(n))) return null;
  return text;
}
