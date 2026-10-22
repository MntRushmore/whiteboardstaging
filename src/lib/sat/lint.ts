import { isSprCorrect, sprFormatOk, sprValue } from "@/lib/sat/answer";
import { SatQuestionSchema, type SatFigure, type SatQuestion } from "@/lib/sat/contracts";

/**
 * The bank's mechanical checks (docs/SAT-MODE.md): what every question must pass before it can be
 * `live`. The pipeline (scripts/sat) runs them on every generated question and the upsert runs
 * them again; anything that fails is written as `draft`. The checks that need a model (an
 * independent solve) or arithmetic (the numeric check) live in scripts/sat.
 *
 *  - the row fits the contract (SatQuestionSchema);
 *  - LaTeX is the SwiftMath-safe subset: only SAFE_COMMANDS, balanced braces and `$`, nothing that
 *    looks like a currency dollar inside text;
 *  - an spr: every accepted form is a valid grid-in (5 characters, 6 with a minus; no mixed numbers),
 *    the forms agree with each other in value, and a rounded decimal fills the grid (".6667", not ".67");
 *  - an mcq: four different choices, and no two choices with the same numeric value;
 *  - a figure: its items lie inside its axes; a labelled point "(a, b)" sits at (a, b) and on any
 *    plotted function that should pass through it; a shape's numeric side labels share one scale
 *    unless the figure says it is not drawn to scale;
 *  - the solution has 2–6 steps.
 */

export const SAFE_COMMANDS = new Set(["frac", "sqrt", "cdot", "le", "ge", "ne", "pi", "theta", "sin", "cos", "tan", "circ", "overline", "angle", "triangle"]);

/** The math segments of Markdown text ($…$ and $$…$$), or an issue when the dollars do not pair. */
export function mathSegments(text: string): { segments: string[]; issue: string | null } {
  const segments: string[] = [];
  const re = /\$\$([\s\S]+?)\$\$|\$([^$]+?)\$/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) segments.push(m[1] ?? m[2]);
  const rest = text.replace(re, "");
  return { segments, issue: rest.includes("$") ? "an unpaired $ (write money as 'dollars', never $5)" : null };
}

/** Problems with the LaTeX in one piece of text (empty when it is SwiftMath-safe). */
export function latexIssues(text: string): string[] {
  const out: string[] = [];
  const { segments, issue } = mathSegments(text);
  if (issue) out.push(issue);
  for (const seg of segments) {
    for (const cmd of seg.matchAll(/\\([A-Za-z]+)/g)) if (!SAFE_COMMANDS.has(cmd[1])) out.push(`\\${cmd[1]} is not in the SwiftMath-safe subset`);
    if (/\\[^A-Za-z\s]/.test(seg.replace(/\\[A-Za-z]+/g, ""))) out.push(`a symbol escape (like \\% or \\,) in "${seg.slice(0, 40)}"`);
    let depth = 0;
    for (const ch of seg) {
      if (ch === "{") depth++;
      if (ch === "}") depth--;
      if (depth < 0) break;
    }
    if (depth !== 0) out.push(`unbalanced braces in "${seg.slice(0, 40)}"`);
  }
  // LaTeX outside $…$ never renders
  const outside = text.replace(/\$\$[\s\S]+?\$\$|\$[^$]+?\$/g, "");
  if (/\\(frac|sqrt|cdot|le|ge|pi|theta|circ)\b/.test(outside)) out.push("a LaTeX command outside $…$");
  return out;
}

/** A plain number from a choice or label ("$\frac{3}{4}$", "-2.5", "12"), or null. */
export function numericValue(text: string): number | null {
  let t = text.trim().replace(/^\$+|\$+$/g, "").trim();
  t = t.replace(/\\frac\{(-?[\d.]+)\}\{(-?[\d.]+)\}/g, "$1/$2").replace(/\s+/g, "");
  const neg = /^-\\frac/.test(t);
  if (neg) t = t.slice(1);
  if (/^-?\d+(\.\d+)?$/.test(t) || /^-?\d*\.\d+$/.test(t)) return Number(t);
  const frac = /^(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)$/.exec(t);
  if (frac && Number(frac[2]) !== 0) return Number(frac[1]) / Number(frac[2]);
  return null;
}

/** The value an expression in x takes (the figure's `function` items: + - * / ** ( ) and numbers). */
export function evalExpr(expr: string, x: number): number | null {
  if (!/^[\dx+\-*/().\s]+$/.test(expr)) return null;
  try {
    // only digits, x, + - * / ** ( ) . reach here (the test above), so this runs no other code
    const v = new Function("x", `"use strict"; return (${expr});`)(x) as unknown;
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

const NOT_TO_SCALE = /not drawn to scale/i;

/** Problems with a figure on its own and against itself (empty when it is fine). */
export function figureIssues(fig: SatFigure): string[] {
  const out: string[] = [];
  if (fig.kind === "table") return out;
  const note = fig.kind === "shape" ? (fig.note ?? "") : "";
  if (fig.kind === "plot") {
    const inX = (x: number) => x >= fig.x.min - 1e-9 && x <= fig.x.max + 1e-9;
    const inY = (y: number) => y >= fig.y.min - 1e-9 && y <= fig.y.max + 1e-9;
    if ((fig.x.max - fig.x.min) / fig.x.step > 40 || (fig.y.max - fig.y.min) / fig.y.step > 40) out.push("too many grid steps (at most 40 per axis)");
    const fns = fig.items.filter((i) => i.type === "function");
    for (const f of fns) {
      if (f.type !== "function") continue;
      if (evalExpr(f.expr, (fig.x.min + fig.x.max) / 2) === null && evalExpr(f.expr, fig.x.min + fig.x.step / 3) === null) out.push(`function "${f.expr}" does not evaluate (use + - * / ** and x)`);
    }
    for (const it of fig.items) {
      if (it.type === "point") {
        if (!inX(it.at[0]) || !inY(it.at[1])) out.push(`point (${it.at.join(", ")}) is outside the axes`);
        const m = it.label ? /^\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)$/.exec(it.label) : null;
        if (m && (Math.abs(Number(m[1]) - it.at[0]) > 1e-6 || Math.abs(Number(m[2]) - it.at[1]) > 1e-6)) out.push(`point labelled ${it.label} is drawn at (${it.at.join(", ")})`);
      }
      if (it.type === "segment" && (!inX(it.from[0]) || !inY(it.from[1]) || !inX(it.to[0]) || !inY(it.to[1]))) out.push("a segment leaves the axes");
      if (it.type === "bar" && (!inX(it.x) || it.height > fig.y.max + 1e-9 || it.height < Math.min(0, fig.y.min) - 1e-9)) out.push(`bar at x=${it.x} does not fit the axes`);
    }
    // a labelled "(a, b)" point with a single plotted function: it should be on it
    if (fns.length === 1 && fns[0].type === "function") {
      const f = fns[0];
      for (const it of fig.items) {
        if (it.type !== "point" || !it.label || !/^\(/.test(it.label)) continue;
        const y = evalExpr(f.expr, it.at[0]);
        if (y !== null && Math.abs(y - it.at[1]) > 1e-6 && fig.items.filter((i) => i.type === "point").length <= 4) out.push(`labelled point ${it.label} is not on y = ${f.expr}`);
      }
    }
    return out;
  }
  // shape: numeric labels next to polygon edges share one scale
  if (!NOT_TO_SCALE.test(note)) {
    const edges: Array<{ mid: [number, number]; len: number }> = [];
    for (const it of fig.items) {
      if (it.type === "polygon") {
        it.points.forEach((p, i) => {
          const q = it.points[(i + 1) % it.points.length];
          edges.push({ mid: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], len: Math.hypot(q[0] - p[0], q[1] - p[1]) });
        });
      }
      if (it.type === "segment") edges.push({ mid: [(it.from[0] + it.to[0]) / 2, (it.from[1] + it.to[1]) / 2], len: Math.hypot(it.to[0] - it.from[0], it.to[1] - it.from[1]) });
    }
    const ratios: number[] = [];
    for (const it of fig.items) {
      if (it.type !== "label") continue;
      const v = numericValue(it.text);
      if (v === null || v <= 0 || !edges.length) continue;
      const nearest = edges.reduce((best, e) => (Math.hypot(e.mid[0] - it.at[0], e.mid[1] - it.at[1]) < Math.hypot(best.mid[0] - it.at[0], best.mid[1] - it.at[1]) ? e : best));
      ratios.push(nearest.len / v);
    }
    if (ratios.length >= 2) {
      const lo = Math.min(...ratios);
      const hi = Math.max(...ratios);
      if (hi / lo > 1.08) out.push("side labels do not match the drawing's proportions (add the not-to-scale note, or fix the points)");
    }
  }
  return out;
}

/** Every mechanical problem with a question (empty: it may go live, once solved independently). */
export function questionIssues(q: unknown): string[] {
  const parsed = SatQuestionSchema.safeParse(q);
  if (!parsed.success) return parsed.error.issues.map((i) => `contract: ${i.path.join(".")} ${i.message}`);
  const s: SatQuestion = parsed.data;
  const out: string[] = [];
  const texts = [s.stem, ...(s.choices ?? []).map((c) => c.text), ...s.solution.steps.flatMap((st) => [st.text, st.math ? `$${st.math}$` : ""]), s.solution.desmos_tip ?? ""];
  for (const t of texts) out.push(...latexIssues(t));
  if (s.solution.steps.some((st) => st.math && st.math.includes("$"))) out.push("a step's `math` is bare LaTeX, without $");
  if (s.format === "spr" && "accepted" in s.answer) {
    const forms = s.answer.accepted;
    for (const f of forms) if (!sprFormatOk(f)) out.push(`accepted "${f}" is not a valid grid-in (5 characters, 6 with a minus)`);
    const values = forms.map(sprValue).filter((v): v is number => v !== null);
    if (values.length) {
      const base = values[0];
      for (const v of values) if (Math.abs(v - base) > Math.max(1e-3, Math.abs(base) * 1e-3)) out.push(`accepted forms disagree (${forms.join(", ")})`);
    }
    // a rounded decimal must fill the grid: with 2/3 listed, ".67" is too short (".6667" fits)
    const exact = forms.filter((f) => f.includes("/")).map(sprValue).find((v): v is number => v !== null);
    if (exact !== undefined) {
      for (const f of forms) {
        const v = sprValue(f);
        const max = f.startsWith("-") ? 6 : 5;
        if (f.includes(".") && v !== null && Math.abs(v - exact) > 1e-12 && f.length < max) out.push(`accepted "${f}" is not as precise as the grid allows`);
      }
    }
    if (forms.length !== new Set(forms).size) out.push("an accepted form is listed twice");
    if (!forms.every((f) => isSprCorrect(f, forms))) out.push("an accepted form is not accepted by the checker");
  }
  if (s.format === "mcq" && s.choices) {
    const norm = s.choices.map((c) => c.text.replace(/\s+/g, "").toLowerCase());
    if (new Set(norm).size !== 4) out.push("two choices are the same");
    const nums = s.choices.map((c) => numericValue(c.text));
    if (nums.every((n) => n !== null) && new Set(nums.map((n) => n!.toFixed(9))).size !== 4) out.push("two choices have the same value");
  }
  if (s.figure) out.push(...figureIssues(s.figure).map((i) => `figure: ${i}`));
  return [...new Set(out)];
}
