/**
 * Reading a final answer out of LaTeX steps, for the model bench. Everything is numeric and goes
 * through the scoreboard's own oracle (`../oracle.ts`), never string equality:
 *
 *  - `values`      the solution set per unknown (`x = 2, \ x = 3`, `x = \frac{\pi}{6}, \frac{5\pi}{6}`,
 *                  `x \in \{0, 2\}`, `(x, y) = (5, 3)`, `(3, 9), (-1, 1)`, `c = \pm 10`);
 *  - `number`      a closed value (the last side of the final step: `\lim … = e`, `= \frac{1}{4}`);
 *  - `expression`  an expression in free variables, compared by sampling (`f^{-1}(x) = …`);
 *  - `antiderivative`  differentiated back numerically, so any constant is fine;
 *  - `relation`    an inequality's solution set (`x < -2, \ x > 1`, `(-\infty, -2) \cup (1, \infty)`).
 *
 * Generous about the SHAPE of a right answer (the ways teachers and models write the same set),
 * strict about its value.
 */
import { splitRelations } from "@/lib/live/engine/latex";
import { unwrapBoxed } from "@/lib/live/solveSteps";
import { compareExprs, exprOf, isAntiderivative, parseLine, sameTruth, type Expr } from "../oracle";

export type AnswerSpec =
  | { kind: "values"; values: Record<string, number[]> }
  | { kind: "number"; value: number }
  | { kind: "expression"; latex: string }
  | { kind: "antiderivative"; integrand: string; variable: string }
  | { kind: "relation"; latex: string; variable: string };

/** Half a unit in the last decimal place written, else a relative 1e-6. */
function tolFor(latex: string, want: number): number {
  let decimals: number | null = null;
  for (const m of latex.matchAll(/\d\.(\d+)/g)) decimals = Math.min(decimals ?? Infinity, m[1].length);
  const rel = 1e-6 * Math.max(1, Math.abs(want));
  return decimals === null ? rel : Math.max(rel, 0.5 * 10 ** -decimals + 1e-12);
}

export function close(got: number, want: number, latex = ""): boolean {
  return Number.isFinite(got) && Math.abs(got - want) <= tolFor(latex, want);
}

/** Shorthands the oracle's translator does not take: `\frac12`, `\dfrac`, `\tfrac`. */
export function tidyTex(latex: string): string {
  return (latex ?? "")
    .replace(/\\[dt]frac(?![a-zA-Z])/g, "\\frac")
    .replace(/\\frac\s*(\d)\s*(\d)/g, "\\frac{$1}{$2}")
    .replace(/\\frac\s*(\d)\s*\{/g, "\\frac{$1}{")
    .replace(/\\frac\s*(\{[^{}]*\})\s*(\d)/g, "\\frac$1{$2}");
}

/** `\text{ or }`, `\text{and}`, `\lor`, `\quad`, `;` between answers → a comma. */
function listSeparators(latex: string): string {
  return latex
    .replace(/\\text\s*\{\s*(?:or|and|,)\s*\}/g, ",")
    .replace(/\\(?:lor|vee)(?![a-zA-Z])/g, ",")
    .replace(/\\(?:q?quad)(?![a-zA-Z])/g, ",")
    .replace(/;/g, ",")
    .replace(/\\(?:[,!: ]|;)/g, " ");
}

/** Top-level comma split (braces, brackets and parentheses nest). */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "{" || ch === "(" || ch === "[") depth++;
    else if (ch === "}" || ch === ")" || ch === "]") depth--;
    else if (ch === "," && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out.map((p) => p.trim()).filter(Boolean);
}

function closedValue(latex: string): number | null {
  const e = exprOf(latex);
  if (!e || e.vars.length > 0) return null;
  const v = e.at({});
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** The step's body: `\boxed{}` off, a leading `=` / `\therefore` / `\Rightarrow` off, list separators unified. */
function answerBody(latex: string): string {
  return listSeparators(tidyTex(unwrapBoxed(latex)).replace(/^\s*(?:=|\\therefore|\\Rightarrow|\\implies)\s*/, "")).trim();
}

const TUPLE = /\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g;

/**
 * `var = closed` assignments in one line: `x = 5`, `x = 2, \ x = 3`, `x = 2, 3`, `c = \pm 10`,
 * `x \in \{0, 2\}`, `(x, y) = (5, 3)`, `(x, y) = (-1, 1), (3, 9)`, and — when `pointNames` is
 * given — unnamed points `(3, 9), (-1, 1)`. Returns var → values (in order), or {}.
 */
export function assignmentsIn(latex: string, pointNames?: readonly string[]): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  const add = (v: string, n: number) => {
    const list = (out[v] ??= []);
    if (!list.some((x) => Math.abs(x - n) <= 1e-9 * Math.max(1, Math.abs(n)))) list.push(n);
  };
  const src = answerBody(latex);
  const tuples = (names: readonly string[], text: string) => {
    for (const t of text.matchAll(TUPLE)) {
      const parts = splitTop(t[1]);
      if (parts.length !== names.length) continue;
      const vals = parts.map(closedValue);
      if (vals.some((v) => v === null)) continue;
      names.forEach((n, i) => add(n, vals[i] as number));
    }
  };
  // `(x, y) = (5, 3)` and `(x, y) = (-1, 1), (3, 9)`
  const named = /^\\?(?:left)?\(\s*([a-zA-Z](?:\s*,\s*[a-zA-Z])+)\s*\\?(?:right)?\)\s*=\s*(.+)$/.exec(src);
  if (named) {
    tuples(named[1].split(",").map((s) => s.trim()), named[2]);
    return out;
  }
  // unnamed points `(3, 9), (-1, 1)`: only when the caller says what they are points of
  if (pointNames && pointNames.length > 1 && /^\\?(?:left)?\(/.test(src) && !/=/.test(src)) {
    tuples(pointNames, src.replace(/\\left|\\right/g, ""));
    return out;
  }
  // `x \in \{0, \frac{2\pi}{3}\}`
  const set = /^([a-zA-Z])\s*\\in\s*(?:\\left)?\\\{(.+?)(?:\\right)?\\\}\s*$/.exec(src);
  if (set) {
    for (const piece of splitTop(set[2])) {
      const n = closedValue(piece);
      if (n !== null) add(set[1], n);
    }
    return out;
  }
  let lastVar: string | null = null;
  for (const piece of splitTop(src)) {
    const p = parseLine(piece);
    if (p.kind !== "relation") {
      // `x = \frac{\pi}{6}, \frac{5\pi}{6}`: a bare value continues the list of the variable before it
      const n = lastVar ? closedValue(piece) : null;
      if (lastVar && n !== null) add(lastVar, n);
      continue;
    }
    lastVar = null;
    for (const alt of p.alternatives) {
      if (alt.sides.length < 2 || alt.ops.some((o) => o !== "==")) continue;
      // `x = 3 + 2 = 5`: the bare side names it, the last closed side is its value
      const bare = alt.sides.find((s) => s.vars.length === 1 && s.latex.replace(/\s|[{}]/g, "") === s.vars[0]);
      const last = alt.sides[alt.sides.length - 1];
      if (!bare || last.vars.length > 0) continue;
      const v = last.at({});
      if (typeof v === "number" && Number.isFinite(v)) {
        add(bare.vars[0], v);
        lastVar = bare.vars[0];
      }
    }
  }
  return out;
}

/**
 * The values of each variable across a solution's steps. The final step decides when it names
 * every variable asked for. Otherwise each variable takes the last step that assigns it — and a
 * run of consecutive one-value steps is one answer (`y = 3^2 = 9` then `y = (-1)^2 = 1`), while
 * `y = \pm 5` followed by `y = 5` is a root being dropped.
 */
export function valuesIn(steps: readonly string[], names: readonly string[]): Record<string, number[]> {
  const per = steps.map((s) => assignmentsIn(s, names));
  const last = per[per.length - 1] ?? {};
  if (names.every((n) => last[n]?.length)) return last;
  const out: Record<string, number[]> = {};
  for (const n of new Set(per.flatMap((a) => Object.keys(a)))) {
    let i = per.length - 1;
    while (i >= 0 && !per[i][n]) i--;
    if (i < 0) continue;
    const vals = [...per[i][n]];
    while (vals.length > 0 && per[i][n].length === 1 && i > 0 && per[i - 1][n]?.length === 1) {
      i--;
      vals.unshift(per[i][n][0]);
    }
    out[n] = vals;
  }
  return out;
}

/** The final value of a step: its last relation side (or the whole expression) when it is closed. */
export function finalNumber(latex: string): number | null {
  const side = lastSide(latex);
  return side === null ? null : closedValue(side);
}

/** The text after the last top-level relation (`\boxed{…}` and a leading `=` removed). */
export function lastSide(latex: string): string | null {
  const body = tidyTex(unwrapBoxed(latex)).replace(/^\s*(?:=|\\approx)\s*/, "").trim();
  if (!body) return null;
  try {
    const split = splitRelations(body);
    const side = split.sides[split.sides.length - 1];
    return side?.trim() ? side : null;
  } catch {
    return null;
  }
}

function lastSideExpr(latex: string): Expr | null {
  const side = lastSide(latex);
  return side === null ? null : exprOf(side);
}

/**
 * Interval notation as the relation it means: `x \in (-\infty, -2) \cup (1, \infty)` →
 * `x < -2, \ x > 1`; `[2, 3)` → `2 \le x < 3`. Null when it is not interval notation.
 */
export function intervalsToRelation(latex: string, variable: string): string | null {
  const src = answerBody(latex)
    .replace(new RegExp(`^${variable}\\s*\\\\in\\s*`), "")
    .replace(/\\left|\\right/g, "")
    .replace(/\\infty/g, "∞");
  const parts = src.split(/\\cup(?![a-zA-Z])/).map((s) => s.trim());
  const out: string[] = [];
  for (const part of parts) {
    const m = /^([([])\s*(.+?)\s*,\s*(.+?)\s*([)\]])$/.exec(part);
    if (!m) return null;
    const [, open, lo, hi, closeB] = m;
    const lower = /^-\s*∞$/.test(lo) ? null : lo;
    const upper = /^\+?\s*∞$/.test(hi) ? null : hi;
    const lop = open === "[" ? "\\le" : "<";
    const hop = closeB === "]" ? "\\le" : "<";
    if (lower === null && upper === null) out.push(`-\\infty < ${variable} < \\infty`);
    else if (lower === null) out.push(`${variable} ${hop} ${upper}`);
    else if (upper === null) out.push(`${variable} ${lop === "<" ? ">" : "\\ge"} ${lower}`);
    else out.push(`${lower} ${lop} ${variable} ${hop} ${upper}`);
  }
  return out.length > 0 ? out.join(", \\ ") : null;
}

export interface AnswerCheck {
  correct: boolean;
  /** what was read, for the report */
  got: string;
  reason?: string;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1e6) / 1e6);
}

/**
 * Is the answer in `steps` the expected one? `steps` are in order; the last one is the final
 * answer (see `valuesIn` for how a system's values are gathered). `anyOf`: the expected value
 * only has to be among the roots found (a length from a quadratic whose other root is negative).
 */
export function checkAnswer(spec: AnswerSpec, steps: readonly string[], opts: { anyOf?: boolean } = {}): AnswerCheck {
  const final = steps[steps.length - 1] ?? "";
  if (!final.trim()) return { correct: false, got: "", reason: "no final step" };
  switch (spec.kind) {
    case "values": {
      const names = Object.keys(spec.values).sort();
      const found = valuesIn(steps, names);
      const got = Object.entries(found).map(([v, vs]) => `${v} = ${vs.map(fmt).join(", ")}`).join("; ");
      for (const [v, want] of Object.entries(spec.values)) {
        const have = found[v];
        if (!have) return { correct: false, got, reason: `no value for ${v}` };
        const has = (w: number) => have.some((h) => close(h, w, final));
        if (opts.anyOf) {
          if (!want.some(has)) return { correct: false, got, reason: `${v}: expected ${want.map(fmt).join(", ")}` };
        } else if (!want.every(has) || !have.every((h) => want.some((w) => close(h, w, final)))) {
          return { correct: false, got, reason: `${v}: expected ${want.map(fmt).join(", ")}` };
        }
      }
      return { correct: true, got };
    }
    case "number": {
      const n = finalNumber(final);
      if (n === null) return { correct: false, got: final, reason: "final step is not a closed value" };
      return close(n, spec.value, final) ? { correct: true, got: fmt(n) } : { correct: false, got: fmt(n), reason: `expected ${fmt(spec.value)}` };
    }
    case "expression": {
      const got = lastSideExpr(final);
      const want = exprOf(spec.latex);
      if (!got || !want) return { correct: false, got: final, reason: "unreadable" };
      const c = compareExprs(got, want);
      return !c.unknown && (c.exact || c.approx) ? { correct: true, got: lastSide(final) ?? final } : { correct: false, got: lastSide(final) ?? final, reason: `expected ${spec.latex}` };
    }
    case "antiderivative": {
      const F = lastSideExpr(final);
      const f = exprOf(spec.integrand);
      if (!F || !f) return { correct: false, got: final, reason: "unreadable" };
      const r = isAntiderivative(F, f, spec.variable);
      return r === "equal" ? { correct: true, got: lastSide(final) ?? final } : { correct: false, got: lastSide(final) ?? final, reason: r === "unknown" ? "could not differentiate it back" : "its derivative is not the integrand" };
    }
    case "relation": {
      const asRelation = intervalsToRelation(final, spec.variable) ?? answerBody(final);
      const got = parseLine(asRelation);
      const want = parseLine(spec.latex);
      if (got.kind !== "relation" || want.kind !== "relation") return { correct: false, got: final, reason: "not a relation" };
      const r = sameTruth(got, want, spec.variable);
      return r === "equal" ? { correct: true, got: asRelation } : { correct: false, got: asRelation, reason: `expected ${spec.latex}` };
    }
  }
}
