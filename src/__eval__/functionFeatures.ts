/**
 * The judge for two Algebra 2 answers that are not one value or one relation, written
 * independently of the engine (`rationalFunctions.ts`, `transformations.ts`): everything here is
 * computed numerically from the problem's own lines with the oracle's reader.
 *
 *  - `expect.rational`: a rational function's domain, holes and asymptotes. The ANSWER stage wants
 *    each key the problem gives written in the steps, exactly (nothing missing, nothing extra); the
 *    STEPS stage checks every line against the function: an excluded value is where it has no
 *    value, a point is a hole (no value there, both sides meeting at it), `x = c` is where it blows
 *    up, `y = c` / `y = mx + b` is where it goes at ±∞, a rewrite has its values.
 *  - `expect.transform`: g written from a parent. The ANSWER stage wants g written out (by value),
 *    the mapping rule and the point pair as given; the STEPS stage checks g against the parent's
 *    definition, that the rule carries the parent's points onto g, and that a point pair is a point
 *    of the parent and its image.
 */
import type { EvalProblem } from "./corpus";
import { definitionsOf, expandCalls, type Definition } from "./functions";
import type { AnswerStatus, Transition, TransitionStatus } from "./judge";
import { compareExprs, exprOf, parseLine, truthAt, tuplesIn, type Expr } from "./oracle";

type Fn = (x: number) => number | null;

const close = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

/** A closed LaTeX value, or null. */
function num(latex: string): number | null {
  const e = exprOf(latex);
  if (!e || e.vars.length > 0) return null;
  const v = e.at({});
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** An expression in x (only) as a function, or null. */
function fnOf(latex: string, x = "x"): { e: Expr; f: Fn } | null {
  const e = exprOf(latex);
  if (!e || e.vars.some((v) => v !== x)) return null;
  return {
    e,
    f: (t) => {
      const v = e.at({ [x]: t });
      return typeof v === "number" && Number.isFinite(v) ? v : null;
    },
  };
}

/** Top-level comma pieces, the `\ ` of a list dropped. */
function pieces(latex: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < latex.length; i++) {
    const ch = latex[i];
    if (ch === "{" || ch === "(" || ch === "[") depth++;
    else if (ch === "}" || ch === ")" || ch === "]") depth--;
    else if (ch === "," && depth === 0 && latex[i - 1] !== "\\") {
      out.push(latex.slice(start, i));
      start = i + 1;
    }
  }
  out.push(latex.slice(start));
  return out.map((p) => p.trim().replace(/^\\\s+/, "").trim()).filter(Boolean);
}

/** `f(x) = …`, `y = …`: the name and the right side; null otherwise. */
function headOf(latex: string): { name: string; rhs: string } | null {
  const m = /^\s*([a-zA-Z])\s*(?:(?:\\left)?\(\s*x\s*(?:\\right)?\))?\s*=\s*([\s\S]+)$/.exec(latex);
  if (!m || m[2].includes("?")) return null;
  if (m[1] !== "y" && !/\(/.test(latex.slice(0, latex.indexOf("=")))) return null;
  return { name: m[1], rhs: m[2].trim() };
}

/** Same values wherever both are defined (at least 5 points), sampled wide. */
function sameFn(a: Fn, b: Fn): boolean | null {
  let n = 0;
  for (let i = 0; i < 40; i++) {
    const x = -9.7 + i * 0.4937;
    const u = a(x);
    const v = b(x);
    if (u === null || v === null || Math.abs(u) > 1e6) continue;
    if (!close(u, v, 1e-7)) return false;
    n++;
  }
  return n >= 5 ? true : null;
}

type Verdict = { status: AnswerStatus; reason: string };
type Step = Omit<Transition, "from" | "to">;

const ok = (reason = ""): Step => ({ status: "ok", reason });
const broken = (reason: string): Step => ({ status: "broken", reason });
const unverified = (reason: string): Step => ({ status: "unverified", reason });

function worst(steps: Step[]): Step {
  const rank: Record<TransitionStatus, number> = { ok: 0, widened: 1, unverified: 2, broken: 3 };
  return steps.reduce((a, b) => (rank[b.status] > rank[a.status] ? b : a), ok());
}

// ---------------------------------------------------------------- rational functions

/** The problem's rational function: the last line above (or at) the target written `f(x) = …` / `y = …`. */
function functionOf(lines: readonly string[]): { name: string; F: Fn } | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const h = headOf(lines[i]);
    const fn = h ? fnOf(h.rhs) : null;
    if (h && fn && fn.e.vars.length === 1) return { name: h.name, F: fn.f };
  }
  return null;
}

type Feature =
  | { kind: "neq"; c: number }
  | { kind: "allReals" }
  | { kind: "none" }
  | { kind: "point"; x: number; y: number }
  | { kind: "xIs"; c: number }
  | { kind: "yIs"; c: number }
  | { kind: "yLine"; f: Fn; e: Expr }
  | { kind: "rewrite"; f: Fn }
  | { kind: "numeric"; truth: boolean | null }
  | { kind: "other" };

function featureOf(p: string, fnName: string): Feature {
  const neq = /^x\s*\\neq?\s*(.+)$/.exec(p);
  if (neq) {
    const c = num(neq[1]);
    return c === null ? { kind: "other" } : { kind: "neq", c };
  }
  const parsed = parseLine(p);
  if (parsed.kind === "all-reals") return { kind: "allReals" };
  if (parsed.kind === "empty-set") return { kind: "none" };
  if (/^\(.*\)$/.test(p.replace(/\\left|\\right/g, "")) && !/\\to/.test(p)) {
    const t = tuplesIn(p);
    if (t.length === 1) return { kind: "point", x: t[0][0], y: t[0][1] };
  }
  const xIs = /^x\s*=\s*(.+)$/.exec(p);
  if (xIs) {
    const c = num(xIs[1]);
    if (c !== null) return { kind: "xIs", c };
  }
  const h = headOf(p);
  if (h) {
    const c = num(h.rhs);
    if (h.name === "y" && c !== null) return { kind: "yIs", c };
    const fn = fnOf(h.rhs);
    if (fn && h.name === "y") return { kind: "yLine", f: fn.f, e: fn.e };
    if (fn && h.name === fnName) return { kind: "rewrite", f: fn.f };
  }
  if (parsed.kind === "relation" && parsed.vars.length === 0) return { kind: "numeric", truth: truthAt(parsed, {}) };
  return { kind: "other" };
}

const blowsUp = (F: Fn, c: number) => [1, -1].some((s) => Math.abs(F(c + s * 1e-7 * Math.max(1, Math.abs(c))) ?? 0) > 1e4);
const limitAt = (F: Fn, a: number): number | null => {
  const h = 1e-6 * Math.max(1, Math.abs(a));
  const l = F(a - h);
  const r = F(a + h);
  return l !== null && r !== null && close(l, r, 1e-4) ? (l + r) / 2 : null;
};
/** Where F goes at both ends, compared with g (a constant or a line). */
const approaches = (F: Fn, g: Fn) =>
  [-1e7, -1e6, 1e6, 1e7].every((x) => {
    const a = F(x);
    const b = g(x);
    return a !== null && b !== null && Math.abs(a - b) < 1e-3;
  });

function rationalStep(F: Fn, fnName: string, step: string): Step {
  const verdicts: Step[] = [];
  for (const p of pieces(step)) {
    const f = featureOf(p, fnName);
    switch (f.kind) {
      case "neq":
        verdicts.push(F(f.c) === null ? ok("an excluded value") : broken(`x = ${f.c} is in the domain`));
        break;
      case "allReals": {
        const bad = Array.from({ length: 401 }, (_, i) => -20 + i * 0.1).find((x) => F(x) === null);
        verdicts.push(bad === undefined ? ok("every real") : broken(`no value at x = ${bad.toFixed(1)}`));
        break;
      }
      case "none":
        verdicts.push(unverified("∅: judged as the answer"));
        break;
      case "point": {
        const lim = limitAt(F, f.x);
        verdicts.push(F(f.x) === null && lim !== null && close(lim, f.y, 1e-5) ? ok("a hole") : broken(`(${f.x}, ${f.y}) is not a hole`));
        break;
      }
      case "xIs":
        verdicts.push(F(f.c) === null && blowsUp(F, f.c) ? ok("a vertical asymptote") : broken(`x = ${f.c} is not a vertical asymptote`));
        break;
      case "yIs":
        verdicts.push(approaches(F, () => f.c) ? ok("a horizontal asymptote") : broken(`the function does not level off at y = ${f.c}`));
        break;
      case "yLine": {
        if (fnName === "y" && sameFn(F, f.f)) verdicts.push(ok("the function rewritten"));
        else verdicts.push(approaches(F, f.f) ? ok("a slant asymptote") : broken("neither the function nor its asymptote"));
        break;
      }
      case "rewrite": {
        const same = sameFn(F, f.f);
        verdicts.push(same === true ? ok("the function rewritten") : same === false ? broken("not the function") : unverified("no sample point"));
        break;
      }
      case "numeric":
        verdicts.push(f.truth === true ? ok("a true statement") : f.truth === false ? broken("a false statement") : unverified("undefined"));
        break;
      default:
        verdicts.push(unverified("not a feature line"));
    }
  }
  return worst(verdicts);
}

const sameSet = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((x) => b.some((y) => close(x, y, 1e-9))) && b.every((y) => a.some((x) => close(x, y, 1e-9)));

function rationalAnswer(problem: EvalProblem, lines: readonly string[], steps: readonly string[]): Verdict {
  const want = problem.expect.rational!;
  const fn = functionOf(lines);
  if (!fn) return { status: "unjudged", reason: "no rational function in the problem" };
  let domain: number[] | null = null;
  const holes: Array<[number, number]> = [];
  let vertical: number[] | null = null;
  const horizontal: number[] = [];
  const oblique: Expr[] = [];
  for (const s of steps) {
    const fs = pieces(s).map((p) => featureOf(p, fn.name));
    if (fs.length > 0 && fs.every((f) => f.kind === "neq")) domain = fs.map((f) => (f as { c: number }).c);
    if (fs.length === 1 && fs[0].kind === "allReals") domain = [];
    if (fs.length > 0 && fs.every((f) => f.kind === "xIs")) vertical = [...(vertical ?? []), ...fs.map((f) => (f as { c: number }).c)];
    for (const f of fs) {
      if (f.kind === "point") holes.push([f.x, f.y]);
      if (f.kind === "yIs") horizontal.push(f.c);
      if (f.kind === "yLine" && !(fn.name === "y" && sameFn(fn.F, f.f))) oblique.push(f.e);
    }
  }
  const show = (xs: readonly number[]) => `{${xs.map((x) => Number(x.toPrecision(6))).join(", ")}}`;
  if (want.domain) {
    if (!domain) return { status: "unsolved", reason: "no line gives the domain" };
    if (!sameSet(domain, want.domain)) return { status: "wrong", reason: `the domain leaves out ${show(domain)}, want ${show(want.domain)}` };
  }
  if (want.holes) {
    if (want.holes.length > 0 && holes.length === 0) return { status: "unsolved", reason: "no hole written" };
    const same = holes.length === want.holes.length && want.holes.every(([x, y]) => holes.some(([a, b]) => close(a, x, 1e-9) && close(b, y, 1e-9)));
    if (!same) return { status: "wrong", reason: `holes ${JSON.stringify(holes)}, want ${JSON.stringify(want.holes)}` };
  }
  if (want.vertical) {
    if (want.vertical.length > 0 && !vertical) return { status: "unsolved", reason: "no vertical asymptote written" };
    if (!sameSet(vertical ?? [], want.vertical)) return { status: "wrong", reason: `x = ${show(vertical ?? [])}, want ${show(want.vertical)}` };
  }
  if (want.horizontal !== undefined) {
    if (want.horizontal === null && horizontal.length > 0) return { status: "wrong", reason: `y = ${show(horizontal)}; there is no horizontal asymptote` };
    if (want.horizontal !== null) {
      if (horizontal.length === 0) return { status: "unsolved", reason: "no horizontal asymptote written" };
      if (!sameSet([...new Set(horizontal)], [want.horizontal])) return { status: "wrong", reason: `y = ${show(horizontal)}, want y = ${want.horizontal}` };
    }
  }
  if (want.oblique !== undefined) {
    const e = exprOf(want.oblique);
    if (!e) return { status: "unjudged", reason: "the expected slant asymptote is unreadable" };
    if (oblique.length === 0) return { status: "unsolved", reason: "no slant asymptote written" };
    if (!oblique.every((o) => compareExprs(o, e).exact)) return { status: "wrong", reason: "not the slant asymptote" };
  } else if (want.horizontal !== undefined && oblique.length > 0) return { status: "wrong", reason: "a slant asymptote where there is none" };
  return { status: "ok", reason: "" };
}

// ---------------------------------------------------------------- transformations

/** `(x, y) \to (X, Y)`: X and Y; `(p, q) \to (P, Q)`: the numbers. */
function ruleOf(step: string): { X: Expr; Y: Expr } | null {
  const m = /^\s*\(\s*x\s*,\s*y\s*\)\s*\\to\s*\(([\s\S]+)\)\s*$/.exec(step);
  if (!m) return null;
  const parts = pieces(m[1]);
  if (parts.length !== 2) return null;
  const X = exprOf(parts[0]);
  const Y = exprOf(parts[1]);
  return X && Y && X.vars.every((v) => v === "x" || v === "y") && Y.vars.every((v) => v === "x" || v === "y") ? { X, Y } : null;
}

function pointPairOf(step: string): [[number, number], [number, number]] | null {
  if (!/\\to/.test(step) || /\(\s*x\s*,\s*y\s*\)/.test(step)) return null;
  const t = tuplesIn(step);
  return t.length === 2 ? [t[0] as [number, number], t[1] as [number, number]] : null;
}

interface Transform {
  imageName: string;
  /** g, from the problem's own lines (the parent's definition put in) */
  G: Fn;
  /** the parent: defined above, or named in the steps (a school parent read off the line) */
  parentName: string | null;
  explicit: boolean;
}

function transformOf(lines: readonly string[]): Transform | null {
  const target = headOf(lines[lines.length - 1] ?? "");
  if (!target) return null;
  const defs = definitionsOf(lines.slice(0, -1));
  const called = [...defs.keys()].find((n) => new RegExp(`(^|[^a-zA-Z\\\\])${n}\\s*(?:\\\\left)?\\(`).test(target.rhs));
  const expanded = called ? expandCalls(target.rhs, defs) : target.rhs;
  const g = expanded ? fnOf(expanded) : null;
  if (!g) return null;
  return { imageName: target.name, G: g.f, parentName: called ?? null, explicit: Boolean(called) };
}

const parentFn = (def: Definition): Fn | null => {
  const e = exprOf(def.body);
  if (!e || e.vars.some((v) => v !== def.param)) return null;
  return (t) => {
    const v = e.at({ [def.param]: t });
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
};

interface TransformRead {
  transitions: Step[];
  images: Array<{ f: Fn; explicit: boolean }>;
  rules: Array<{ X: Expr; Y: Expr }>;
  points: Array<[[number, number], [number, number]]>;
}

function readTransform(t: Transform, lines: readonly string[], steps: readonly string[]): TransformRead {
  const defs = new Map(definitionsOf(lines.slice(0, -1)));
  let parent: Fn | null = t.parentName && defs.has(t.parentName) ? parentFn(defs.get(t.parentName)!) : null;
  const out: TransformRead = { transitions: [], images: [], rules: [], points: [] };
  const named: number[] = [];
  const used = new Set<string>();
  for (const s of steps) {
    const rule = ruleOf(s);
    if (rule) {
      out.rules.push(rule);
      if (!parent) {
        out.transitions.push(unverified("a rule with no parent named"));
        continue;
      }
      let n = 0;
      let bad = false;
      for (let i = 0; i < 30 && !bad; i++) {
        const x = -7.3 + i * 0.517;
        const y = parent(x);
        if (y === null) continue;
        const X = rule.X.at({ x, y });
        const Y = rule.Y.at({ x, y });
        const gx = typeof X === "number" ? t.G(X) : null;
        if (typeof X !== "number" || typeof Y !== "number" || gx === null) continue;
        if (!close(gx, Y, 1e-7)) bad = true;
        n++;
      }
      out.transitions.push(bad ? broken("the rule does not carry the parent onto g") : n >= 3 ? ok("the rule") : unverified("no sample point"));
      continue;
    }
    const pair = pointPairOf(s);
    if (pair) {
      out.points.push(pair);
      const [[p, q], [P, Q]] = pair;
      const onParent = parent ? parent(p) : null;
      const onImage = t.G(P);
      const lastRule = out.rules[out.rules.length - 1];
      const byRule = lastRule ? [lastRule.X.at({ x: p, y: q }), lastRule.Y.at({ x: p, y: q })] : null;
      if (onParent === null || !close(onParent, q, 1e-9)) out.transitions.push(broken(`(${p}, ${q}) is not on the parent`));
      else if (onImage === null || !close(onImage, Q, 1e-9)) out.transitions.push(broken(`(${P}, ${Q}) is not on g`));
      else if (byRule && !(typeof byRule[0] === "number" && typeof byRule[1] === "number" && close(byRule[0], P, 1e-9) && close(byRule[1], Q, 1e-9))) out.transitions.push(broken("not where the rule takes it"));
      else out.transitions.push(ok("a point and its image"));
      continue;
    }
    const h = headOf(s);
    if (h && (h.name === t.imageName || (t.imageName === "y" && h.name === "y"))) {
      const calls = [...defs.keys()].filter((n) => new RegExp(`(^|[^a-zA-Z\\\\])${n}\\s*(?:\\\\left)?\\(`).test(h.rhs));
      calls.forEach((c) => used.add(c));
      const expanded = expandCalls(h.rhs, defs);
      const f = expanded ? fnOf(expanded) : null;
      if (!f) {
        out.transitions.push(unverified("unreadable"));
        continue;
      }
      out.images.push({ f: f.f, explicit: calls.length === 0 });
      const same = sameFn(t.G, f.f);
      out.transitions.push(same === true ? ok("g") : same === false ? broken("not g") : unverified("no sample point"));
      continue;
    }
    if (h && !defs.has(h.name) && h.name !== "y") {
      // a parent named in the steps (`f(x) = x^{2}` for `y = 2(x - 1)^{2} + 3`)
      const d = definitionsOf([s]).get(h.name);
      if (d) {
        defs.set(h.name, d);
        if (!t.explicit && !parent) parent = parentFn(d);
        named.push(out.transitions.length);
        out.transitions.push(unverified(`${h.name}: the parent named`));
        continue;
      }
    }
    out.transitions.push(unverified("not a transformation line"));
  }
  // a parent named in the steps is right when g, written with it, is g
  const confirmed = out.images.length > 0 && out.transitions.every((x) => x.status !== "broken");
  for (const i of named) if (confirmed && used.size > 0) out.transitions[i] = ok("the parent");
  return out;
}

function transformAnswer(problem: EvalProblem, t: Transform, read: TransformRead): Verdict {
  const want = problem.expect.transform!;
  const image = fnOf(want.image);
  if (!image) return { status: "unjudged", reason: "the expected g is unreadable" };
  if (read.images.length === 0) return { status: "unsolved", reason: "g is not written" };
  if (t.explicit && !read.images.some((i) => i.explicit)) return { status: "unsolved", reason: "g is not written out" };
  for (const i of read.images) if (sameFn(image.f, i.f) !== true) return { status: "wrong", reason: "a line for g is not g" };
  if (want.rule) {
    const [wx, wy] = want.rule.map((r) => exprOf(r));
    if (!wx || !wy) return { status: "unjudged", reason: "the expected rule is unreadable" };
    if (read.rules.length === 0) return { status: "unsolved", reason: "no mapping rule" };
    for (const r of read.rules) {
      for (const [x, y] of [
        [0.37, 1.9],
        [-1.3, 0.6],
        [2.2, -2.7],
      ]) {
        const a = [r.X.at({ x, y }), r.Y.at({ x, y })];
        const b = [wx.at({ x, y }), wy.at({ x, y })];
        if (!a.every((v, k) => typeof v === "number" && typeof b[k] === "number" && close(v, b[k] as number, 1e-9))) return { status: "wrong", reason: "not the mapping rule" };
      }
    }
  }
  if (want.point) {
    if (read.points.length === 0) return { status: "unsolved", reason: "no point carried across" };
    const [[p, q], [P, Q]] = want.point;
    const hit = read.points.some(([a, b]) => close(a[0], p, 1e-9) && close(a[1], q, 1e-9) && close(b[0], P, 1e-9) && close(b[1], Q, 1e-9));
    if (!hit) return { status: "wrong", reason: `not (${p}, ${q}) → (${P}, ${Q})` };
  }
  return { status: "ok", reason: "" };
}

// ---------------------------------------------------------------- entry

/** The answer and the step checks of a `rational` / `transform` problem; null for any other. */
export function judgeFeatures(problem: EvalProblem, lines: readonly string[], steps: readonly string[]): { answer: Verdict; transitions: Transition[] } | null {
  const e = problem.expect;
  if (!e.rational && !e.transform) return null;
  const found = steps.length > 0;
  const missing = { status: "missing" as const, reason: "no local solution: Solve would ask the model" };
  if (e.rational) {
    const fn = functionOf(lines);
    const transitions: Transition[] = fn ? steps.map((s) => ({ from: "(the function)", to: s, ...rationalStep(fn.F, fn.name, s) })) : steps.map((s) => ({ from: "(the function)", to: s, ...unverified("no function to check against") }));
    return { answer: found ? rationalAnswer(problem, lines, steps) : missing, transitions };
  }
  const t = transformOf(lines);
  if (!t) return { answer: found ? { status: "unjudged", reason: "no function in the problem" } : missing, transitions: [] };
  const read = readTransform(t, lines, steps);
  return { answer: found ? transformAnswer(problem, t, read) : missing, transitions: read.transitions.map((x, i) => ({ from: "(the parent)", to: steps[i], ...x })) };
}

/** How the report shows such an answer. */
export function featuresLatex(problem: Pick<EvalProblem, "expect">): string | null {
  const r = problem.expect.rational;
  const t = problem.expect.transform;
  const n = (x: number) => String(Number(x.toPrecision(6)));
  if (r) {
    const parts: string[] = [];
    if (r.domain) parts.push(r.domain.length ? r.domain.map((c) => `x \\neq ${n(c)}`).join(", ") : "x \\in \\mathbb{R}");
    if (r.holes) parts.push(r.holes.length ? r.holes.map(([x, y]) => `(${n(x)}, ${n(y)})`).join(", ") : "\\varnothing");
    if (r.vertical) parts.push(r.vertical.length ? r.vertical.map((c) => `x = ${n(c)}`).join(", ") : "\\varnothing");
    if (r.horizontal !== undefined && r.horizontal !== null) parts.push(`y = ${n(r.horizontal)}`);
    if (r.oblique) parts.push(`y = ${r.oblique}`);
    return parts.join("; ");
  }
  if (t) {
    const parts = [`g(x) = ${t.image}`];
    if (t.rule) parts.push(`(x, y) \\to (${t.rule[0]}, ${t.rule[1]})`);
    if (t.point) parts.push(`(${t.point[0].map(n).join(", ")}) \\to (${t.point[1].map(n).join(", ")})`);
    return parts.join("; ");
  }
  return null;
}
