/**
 * Facts → equations: the figure path's reasoning, deterministic and pure (no engine, no model).
 *
 * The vision model says what it SEES (`FigureRead`, ./schema.ts): the figure's angles and sides,
 * each with its label as written, and the relationships the drawing shows — a triangle, angles on
 * a straight line, vertical angles, parallel lines cut by a transversal, tick marks, a right-angle
 * box, a regular polygon, a circle's inscribed and central angles, similar triangles. `planFigure`
 * turns that into the lines a student writes beside the figure, one STAGE per unknown:
 *
 *   straight line 65°, x        → `x + 65 = 180`
 *   vertical 2x + 10, 70°       → `2x + 10 = 70`
 *   isosceles apex x, base 50°  → `x + 2(50) = 180`
 *   right triangle 3, 4, x      → `x^{2} = 3^{2} + 4^{2}`
 *   similar x ↔ 6, 8 ↔ 12       → `\frac{x}{6} = \frac{8}{12}`
 *   regular pentagon, x         → `(5 - 2) \cdot 180 = 540`, `5x = 540`
 *
 * and, when the unknown is only reached through an unlabelled angle, the line that finds that angle
 * first (`180 - 70 = 110`, then `x + 110 + 50 = 180`). The board's engine then solves each stage and
 * the tutor writes it. Nothing is trusted: every quantity a fact names must exist and be of the
 * right kind, every value label read on the figure must be in the read (and every label in the read
 * on the figure), every label must be used by some fact, and once the unknowns are solved every fact
 * must still hold with every angle and side a sensible positive size (a triangle whose known angles
 * already make 180° is refused).
 */
import { formatNumber, isValueLabel, labelKey, parseLabel, type LabelValue } from "./labels";
import { ANGLE_FACTS, LENGTH_FACTS, type FactType, type FigureFact, type FigureRead } from "./schema";

export type QuantityKind = "angle" | "length";

export interface FigureStage {
  /** the letter solved for, as the lines write it (`x`, `\theta`) */
  letter: string;
  /** the lines, top to bottom: any angle found on the way, then the equation */
  lines: string[];
  /** the letter's value, from this planner's own exact solve (the board checks the engine agrees) */
  value: number;
  kind: QuantityKind;
}

export type FigurePlan = { ok: true; stages: FigureStage[] } | { ok: false; reason: string };

export interface PlanOptions {
  /** the labels as the recognizer read them (one per label); [] when there was no read */
  labels?: readonly string[];
  /** the student's lines beside the figure: `x = ?` narrows what is solved for */
  column?: readonly string[];
}

const TOL = 1e-6;
const MAX_LETTERS = 3;
/** rounds of "an unlabelled angle found from the others" before the unknown's equation */
const MAX_DERIVED = 2;
/** letters for a `?` label, in order of preference (never `e` or `i`: constants to the engine) */
const SPARE_LETTERS = ["x", "y", "z", "a", "b", "c", "w"];

// ---------------------------------------------------------------- the read, checked

interface Quantity {
  id: string;
  kind: QuantityKind;
  /** null: unlabelled (or a name, not a value) */
  value: LabelValue | null;
  /** the label as the model wrote it */
  label: string | null;
  /** where the model says it is (`first crossing, between, left`) */
  at: string;
}

interface Term {
  q: number;
  k: number;
}

/** Σ k·lhs = Σ k·rhs + total. */
interface Relation {
  fact: number;
  type: FactType;
  lhs: Term[];
  rhs: Term[];
  total: number;
  /** a line that works the total out first: `(5 - 2) \cdot 180 = 540` */
  preface?: string;
}

interface Pythagoras {
  fact: number;
  legs: [number, number];
  hyp: number;
}

interface Similar {
  fact: number;
  pairs: Array<[number, number]>;
}

class UnionFind {
  private readonly parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]];
      i = this.parent[i];
    }
    return i;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }
}

class Reject extends Error {}
const reject = (reason: string): never => {
  throw new Reject(reason);
};

/** The letters `x = ?`, `m\angle A = ?`, `\theta = ?` ask for. */
export function askedLetters(column: readonly string[]): string[] {
  const out: string[] = [];
  for (const line of column) {
    const m = /^\s*(?:m\s*)?(?:\\(?:angle|measuredangle)\s*)?(\\[a-zA-Z]+|[A-Za-z])\s*(?:\^\s*\{?\s*\\circ\s*\}?)?\s*=\s*\?\s*$/.exec(line ?? "");
    if (m && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/**
 * Where an angle is at a transversal, as the model describes it: which crossing (the first or the
 * second parallel line), whether it is between the parallel lines or outside them, and which side of
 * the transversal (left / right, or above / below when the transversal runs across). Null when the
 * description does not say all three.
 */
export function transversalPosition(at: string): { crossing: 1 | 2; between: boolean; side: string } | null {
  const t = (at ?? "").toLowerCase();
  // only a description of a crossing ("bottom left corner, inside" is a triangle's corner)
  if (!/\b(crossing|intersection)s?\b/.test(t)) return null;
  const first = /\b(first|1st|upper|top)\b/.test(t);
  const second = /\b(second|2nd|lower|bottom)\b/.test(t);
  const inside = /\b(between|interior|inside|inner)\b/.test(t);
  const outside = /\b(outside|exterior|outer)\b/.test(t);
  const sides = [...new Set(t.match(/\b(left|right|above|below)\b/g) ?? [])];
  if (first === second || inside === outside || sides.length !== 1) return null;
  return { crossing: first ? 1 : 2, between: inside, side: sides[0] };
}

/**
 * Two angles where one transversal crosses two parallel lines: equal (corresponding, alternate,
 * vertical) or adding to 180 (co-interior, a linear pair), worked out from where each one is. At the
 * first crossing "between the lines" faces the second line, at the second it faces the first: in one
 * frame, angles on the same side of both lines are equal, on opposite sides of both equal (vertical,
 * alternate), and on the same side of one but not the other supplementary. Null when either position
 * is not described.
 */
export function transversalRelation(a: string, b: string): "equal" | "supplementary" | "same" | null {
  const p = transversalPosition(a);
  const q = transversalPosition(b);
  if (!p || !q) return null;
  const sideKind = (s: string) => (s === "left" || s === "right" ? "lr" : "ab");
  if (sideKind(p.side) !== sideKind(q.side)) return null;
  // towards the second line (true) or away from it, in one frame for both crossings
  const toward = (x: { crossing: 1 | 2; between: boolean }) => (x.crossing === 1 ? x.between : !x.between);
  const lineSame = toward(p) === toward(q);
  const sideSame = p.side === q.side;
  if (lineSame && sideSame) return p.crossing === q.crossing ? "same" : "equal";
  return lineSame !== sideSame ? "supplementary" : "equal";
}

interface Model {
  qs: Quantity[];
  cls: number[];
  /** a class's fixed size: 90 (a right-angle mark), 60 (an equilateral triangle's angle) */
  fixed: Map<number, number>;
  rels: Relation[];
  pyth: Pythagoras[];
  similar: Similar[];
  /** a class's angles are each less than this (180 in a triangle or on a line, 90 in a right angle's parts) */
  under: Map<number, number>;
}

function build(read: FigureRead, opts: PlanOptions): { model: Model; letters: string[]; asked: string[] } {
  const asked = askedLetters(opts.column ?? []);
  const askedSet = new Set(asked);
  if (read.quantities.length === 0) reject("no quantities");
  if (read.facts.length === 0) reject("no facts");

  // quantities, their labels as values
  const index = new Map<string, number>();
  const qs: Quantity[] = [];
  const marks: number[] = [];
  for (const q of read.quantities) {
    let kind: QuantityKind = q.what;
    let value: LabelValue | null = null;
    if (q.label !== null) {
      const p = parseLabel(q.label, askedSet);
      if (p.kind === "unreadable") reject(`the label "${q.label}" is not a value`);
      if (p.kind === "unknown") marks.push(qs.length);
      if (p.kind === "value") value = p.value;
      if ((p.kind === "value" && p.value.degrees) || (p.kind === "unknown" && p.degrees)) kind = "angle";
    }
    index.set(q.id, qs.length);
    qs.push({ id: q.id, kind, value, label: q.label, at: q.at ?? "" });
  }

  // the labels read on the figure and the labels in the read must be the same labels
  const onFigure = (opts.labels ?? []).map((l) => l.trim()).filter(Boolean);
  if (onFigure.length > 0) {
    // a right-angle box the reader wrote down as "90°": the mark, not a label
    const figureKeys0 = new Set(onFigure.map(labelKey));
    const boxed = new Set(read.facts.filter((f) => f.type === "right_angle" || f.type === "tangent_radius" || f.type === "semicircle").flatMap((f) => f.items as string[]));
    for (const q of qs) {
      if (q.label !== null && boxed.has(q.id) && q.value && !q.value.letter && q.value.b === 90 && !figureKeys0.has(labelKey(q.label))) {
        q.label = null;
        q.value = null;
      }
    }
    const inRead = new Set(qs.filter((q) => q.label !== null).map((q) => labelKey(q.label!)));
    const figureKeys = new Set(onFigure.map(labelKey));
    for (const l of onFigure) if (isValueLabel(l) && !inRead.has(labelKey(l))) reject(`the label "${l}" is not in the read`);
    for (const q of qs) if (q.label !== null && isValueLabel(q.label) && !figureKeys.has(labelKey(q.label))) reject(`the read's label "${q.label}" is not on the figure`);
  }

  // the letters; a `?` gets one of its own (the one a line asks for, when one does)
  const letters: string[] = [];
  for (const q of qs) if (q.value?.letter && !letters.includes(q.value.letter)) letters.push(q.value.letter);
  if (marks.length > 0) {
    const letter = asked.find((l) => !letters.includes(l)) ?? SPARE_LETTERS.find((l) => !letters.includes(l) && !askedSet.has(l)) ?? "x";
    for (const i of marks) qs[i].value = { a: 1, b: 0, letter, latex: letter, degrees: qs[i].kind === "angle" };
    if (!letters.includes(letter)) letters.push(letter);
  }
  if (letters.length === 0) reject("nothing is asked (no unknown among the labels)");

  // facts: every item a quantity of the right kind
  const at = (id: string): number => index.get(id) ?? reject(`a fact names "${id}", which is not a quantity`);
  const uf = new UnionFind(qs.length);
  const fixedOf = new Map<number, number>();
  const rels: Relation[] = [];
  const pyth: Pythagoras[] = [];
  const similar: Similar[] = [];
  const named = new Set<number>();
  const underQ = new Map<number, number>();
  const setUnder = (q: number, v: number) => underQ.set(q, Math.min(underQ.get(q) ?? 360, v));
  const fix = (q: number, v: number) => {
    const prev = fixedOf.get(q);
    if (prev !== undefined && Math.abs(prev - v) > TOL) reject(`an angle marked both ${prev}° and ${v}°`);
    fixedOf.set(q, v);
  };
  const sum = (fact: number, type: FactType, items: number[], total: number, under: number): Relation => {
    const r: Relation = { fact, type, lhs: items.map((q) => ({ q, k: 1 })), rhs: [], total };
    for (const q of items) setUnder(q, under);
    rels.push(r);
    return r;
  };

  /** facts about two angles that, placed at the crossings of a transversal, are what their places say */
  const POSITIONAL: ReadonlySet<FactType> = new Set(["corresponding", "alternate_interior", "alternate_exterior", "co_interior", "equal", "vertical", "straight_line"]);

  read.facts.forEach((raw: FigureFact, n) => {
    let f = raw;
    if (POSITIONAL.has(f.type) && f.items.length === 2 && typeof f.items[0] === "string") {
      const [p, q] = (f.items as string[]).map((id) => qs[index.get(id) ?? -1]);
      if (p?.kind === "angle" && q?.kind === "angle" && transversalRelation(p.at, q.at)) f = { ...f, type: "transversal" };
    }
    const items = (f.type === "similar" ? (f.items as string[][]).flat() : (f.items as string[])).map(at);
    if (new Set(items).size !== items.length) reject(`a ${f.type} fact names the same quantity twice`);
    items.forEach((q) => named.add(q));
    const kinds = new Set(items.map((q) => qs[q].kind));
    if ((ANGLE_FACTS as readonly string[]).includes(f.type) && !(kinds.size === 1 && kinds.has("angle"))) reject(`a ${f.type} fact names a side`);
    if ((LENGTH_FACTS as readonly string[]).includes(f.type) && !(kinds.size === 1 && kinds.has("length"))) reject(`a ${f.type} fact names an angle`);
    if (kinds.size > 1) reject(`a ${f.type} fact mixes angles and sides`);
    switch (f.type) {
      case "triangle":
      case "straight_line":
      case "cyclic_opposite":
        sum(n, f.type, items, 180, 180);
        break;
      case "around_point":
        sum(n, f.type, items, 360, 360);
        break;
      case "right_angle_parts":
        sum(n, f.type, items, 90, 90);
        break;
      case "transversal":
      case "corresponding":
      case "alternate_interior":
      case "alternate_exterior":
      case "co_interior": {
        // where the two angles are decides, not the name: a reader that places them right names
        // the relation wrong more often than it misplaces them
        const [p, q] = items;
        const derived = transversalRelation(qs[p].at, qs[q].at);
        const relation = derived ?? (f.type === "co_interior" ? "supplementary" : f.type === "transversal" ? null : "equal");
        if (relation === null) reject("two angles at a transversal with no positions");
        if (relation === "same") reject("two quantities at the same place");
        if (relation === "supplementary") sum(n, "co_interior", items, 180, 180);
        else {
          uf.union(p, q);
          for (const x of items) setUnder(x, 180);
        }
        break;
      }
      case "vertical":
      case "same_arc":
      case "equal":
        for (const q of items.slice(1)) uf.union(items[0], q);
        if (f.type !== "equal") for (const q of items) setUnder(q, 180);
        break;
      case "exterior_angle": {
        const [e, r1, r2] = items;
        rels.push({ fact: n, type: f.type, lhs: [{ q: r1, k: 1 }, { q: r2, k: 1 }], rhs: [{ q: e, k: 1 }], total: 0 });
        for (const q of items) setUnder(q, 180);
        break;
      }
      case "isosceles": {
        const [, b1, b2] = items;
        uf.union(b1, b2);
        sum(n, f.type, items, 180, 180);
        setUnder(b1, 90);
        break;
      }
      case "equilateral":
        for (const q of items.slice(1)) uf.union(items[0], q);
        if (qs[items[0]].kind === "angle") for (const q of items) fix(q, 60);
        break;
      case "right_angle":
      case "tangent_radius":
      case "semicircle":
        fix(items[0], 90);
        break;
      case "polygon": {
        const sides = f.sides ?? items.length;
        if (sides !== items.length) reject(`a ${sides}-sided polygon with ${items.length} angles named`);
        const total = (sides - 2) * 180;
        const r = sum(n, f.type, items, total, 360);
        if (sides >= 5) r.preface = `(${sides} - 2) \\cdot 180 = ${total}`;
        break;
      }
      case "regular_polygon": {
        const sides = f.sides ?? 0;
        if (f.angle === "exterior") rels.push({ fact: n, type: f.type, lhs: [{ q: items[0], k: sides }], rhs: [], total: 360 });
        else {
          const total = (sides - 2) * 180;
          rels.push({ fact: n, type: f.type, lhs: [{ q: items[0], k: sides }], rhs: [], total, preface: `(${sides} - 2) \\cdot 180 = ${total}` });
        }
        setUnder(items[0], 180);
        break;
      }
      case "exterior_angles":
        sum(n, f.type, items, 360, 180);
        break;
      case "inscribed_central": {
        const [ins, cen] = items;
        rels.push({ fact: n, type: f.type, lhs: [{ q: ins, k: 2 }], rhs: [{ q: cen, k: 1 }], total: 0 });
        setUnder(ins, 180);
        break;
      }
      case "midsegment": {
        const [mid, base] = items;
        rels.push({ fact: n, type: f.type, lhs: [{ q: mid, k: 2 }], rhs: [{ q: base, k: 1 }], total: 0 });
        break;
      }
      case "right_triangle": {
        const [l1, l2, h] = items;
        pyth.push({ fact: n, legs: [l1, l2], hyp: h });
        break;
      }
      case "similar":
        similar.push({ fact: n, pairs: (f.items as string[][]).map((p) => [at(p[0]), at(p[1])] as [number, number]) });
        break;
    }
  });

  // every value on the figure is used by some fact: a label the read left out of every fact is one
  // the reasoning did not use
  for (let q = 0; q < qs.length; q++) if (qs[q].value && !named.has(q)) reject(`the label "${qs[q].label}" is in no fact`);

  const cls = qs.map((_, q) => uf.find(q));
  const fixed = new Map<number, number>();
  for (const [q, v] of fixedOf) {
    const prev = fixed.get(cls[q]);
    if (prev !== undefined && Math.abs(prev - v) > TOL) reject("equal angles marked with different sizes");
    fixed.set(cls[q], v);
  }
  const under = new Map<number, number>();
  for (const [q, v] of underQ) under.set(cls[q], Math.min(under.get(cls[q]) ?? 360, v));

  const targets = asked.length > 0 ? asked.filter((l) => letters.includes(l)) : letters;
  if (asked.length > 0 && targets.length === 0) reject(`the line asks for ${asked.join(", ")}, which is not on the figure`);
  return { model: { qs, cls, fixed, rels, pyth, similar, under }, letters: targets.slice(0, MAX_LETTERS), asked };
}

// ---------------------------------------------------------------- values of classes

type Num = { t: "num"; v: number; latex: string };
type LinVal = { t: "lin"; a: number; b: number; latex: string; bare: boolean };
/** `other`: holds a letter that is not solved yet (and not the one being solved for) */
type Val = Num | LinVal | { t: "free" } | { t: "other" };

interface Ctx {
  m: Model;
  letter: string;
  solved: ReadonlyMap<string, number>;
  /** unlabelled classes found from the others on the way */
  derived: Map<number, number>;
}

const evalLabel = (v: LabelValue, solved: ReadonlyMap<string, number>): number | null => {
  if (!v.letter) return v.b;
  const x = solved.get(v.letter);
  return x === undefined ? null : v.a * x + v.b;
};

const membersOf = (m: Model, c: number) => m.qs.map((q, i) => ({ q, i })).filter(({ i }) => m.cls[i] === c);

/** What a class is worth for the letter being solved for: a number, an expression in it, or not known. */
function classVal(ctx: Ctx, c: number): Val {
  const members = membersOf(ctx.m, c);
  const num = members.find(({ q }) => q.value && !q.value.letter);
  if (num) return { t: "num", v: num.q.value!.b, latex: num.q.value!.latex };
  const fixed = ctx.m.fixed.get(c);
  if (fixed !== undefined) return { t: "num", v: fixed, latex: formatNumber(fixed) };
  const d = ctx.derived.get(c);
  if (d !== undefined) return { t: "num", v: d, latex: formatNumber(d) };
  const solved = members.find(({ q }) => q.value?.letter && ctx.solved.has(q.value.letter));
  if (solved) {
    const v = evalLabel(solved.q.value!, ctx.solved)!;
    return { t: "num", v, latex: formatNumber(v) };
  }
  const mine = members.find(({ q }) => q.value?.letter === ctx.letter);
  if (mine) {
    const v = mine.q.value!;
    return { t: "lin", a: v.a, b: v.b, latex: v.latex, bare: v.a === 1 && v.b === 0 };
  }
  if (members.some(({ q }) => q.value?.letter)) return { t: "other" };
  return { t: "free" };
}

/** Terms of one side, merged by class (the two base angles of an isosceles triangle are 2 × one). */
function merge(m: Model, terms: readonly Term[]): Array<{ c: number; k: number }> {
  const out: Array<{ c: number; k: number }> = [];
  for (const t of terms) {
    const c = m.cls[t.q];
    const hit = out.find((o) => o.c === c);
    if (hit) hit.k += t.k;
    else out.push({ c, k: t.k });
  }
  return out;
}

function termLatex(v: Num | LinVal, k: number): string {
  if (k === 1) return v.latex;
  if (v.t === "lin" && v.bare) return `${formatNumber(k)}${v.latex}`;
  return `${formatNumber(k)}(${v.latex})`;
}

/** `a + b + c`, a term that starts with a minus sign bracketed. */
function joinSum(parts: readonly string[]): string {
  return parts.map((p, i) => (i > 0 && p.startsWith("-") ? `(${p})` : p)).join(" + ");
}

// ---------------------------------------------------------------- one letter's equation

interface Equation {
  lines: string[];
  /** the classes it is written in (the angles found on the way that it needs) */
  uses: number[];
  /** the letter's value, or null when the equation does not fix it (an identity) */
  solve: () => number | null;
}

type Side = Array<{ v: Num | LinVal; k: number }>;

function sideOf(ctx: Ctx, terms: readonly Term[]): Side | null {
  const out: Side = [];
  for (const { c, k } of merge(ctx.m, terms)) {
    const v = classVal(ctx, c);
    if (v.t === "free" || v.t === "other") return null;
    out.push({ v, k });
  }
  return out;
}

const hasLetter = (s: Side) => s.some((t) => t.v.t === "lin");
const linOf = (s: Side) =>
  s.reduce((acc, t) => (t.v.t === "lin" ? { a: acc.a + t.k * t.v.a, b: acc.b + t.k * t.v.b } : { a: acc.a, b: acc.b + t.k * t.v.v }), { a: 0, b: 0 });
/** the letter's terms first, then the numbers, each in the order the fact named them */
const printSide = (s: Side) => joinSum([...s.filter((t) => t.v.t === "lin"), ...s.filter((t) => t.v.t === "num")].map((t) => termLatex(t.v, t.k)));

function linearSolve(l: { a: number; b: number }, r: { a: number; b: number }): number | null {
  const a = l.a - r.a;
  if (Math.abs(a) < TOL) return null;
  return (r.b - l.b) / a;
}

/** A relation as an equation in the letter, when every class in it is known but for the letter. */
function relationEquation(ctx: Ctx, r: Relation): Equation | null {
  const lhs = sideOf(ctx, r.lhs);
  const rhs = sideOf(ctx, r.rhs);
  if (!lhs || !rhs || (!hasLetter(lhs) && !hasLetter(rhs))) return null;
  const rhsLin = linOf(rhs);
  const rhsText = rhs.length === 0 ? formatNumber(r.total) : r.total === 0 ? printSide(rhs) : `${printSide(rhs)} + ${formatNumber(r.total)}`;
  // the letter's side on the left: `x = 40 + 65`, not `40 + 65 = x`
  const letterRight = hasLetter(rhs) && !hasLetter(lhs);
  const line = letterRight ? `${rhsText} = ${printSide(lhs)}` : `${printSide(lhs)} = ${rhsText}`;
  const uses = [...merge(ctx.m, r.lhs), ...merge(ctx.m, r.rhs)].map((t) => t.c);
  return { lines: [...(r.preface ? [r.preface] : []), line], uses, solve: () => linearSolve(linOf(lhs), { a: rhsLin.a, b: rhsLin.b + r.total }) };
}

/** A quantity in the letter marked equal to one known (vertical, alternate, tick marks): `2x + 10 = 70`. */
function classEquations(ctx: Ctx): Equation[] {
  const out: Equation[] = [];
  for (const c of [...new Set(ctx.m.cls)]) {
    const members = membersOf(ctx.m, c);
    const mine = members.find(({ q }) => q.value?.letter === ctx.letter);
    if (!mine) continue;
    const left = mine.q.value!;
    const others = members.filter(({ q }) => q.value && q !== mine.q);
    const num = others.find(({ q }) => !q.value!.letter);
    const fixed = ctx.m.fixed.get(c);
    const same = others.find(({ q }) => q.value!.letter === ctx.letter && (q.value!.a !== left.a || q.value!.b !== left.b));
    const solvedOther = others.find(({ q }) => q.value!.letter && q.value!.letter !== ctx.letter && ctx.solved.has(q.value!.letter));
    let right: { latex: string; a: number; b: number } | null = null;
    if (num) right = { latex: num.q.value!.latex, a: 0, b: num.q.value!.b };
    else if (fixed !== undefined) right = { latex: formatNumber(fixed), a: 0, b: fixed };
    else if (same) right = { latex: same.q.value!.latex, a: same.q.value!.a, b: same.q.value!.b };
    else if (solvedOther) {
      const v = evalLabel(solvedOther.q.value!, ctx.solved)!;
      right = { latex: formatNumber(v), a: 0, b: v };
    }
    if (!right) continue;
    const r = right;
    out.push({ lines: [`${left.latex} = ${r.latex}`], uses: [c], solve: () => linearSolve(left, r) });
  }
  return out;
}

/** Pythagoras with the letter as one side (the bare letter), the other two numbers. */
function pythagorasEquation(ctx: Ctx, p: Pythagoras): Equation | null {
  const vals = [p.legs[0], p.legs[1], p.hyp].map((q) => classVal(ctx, ctx.m.cls[q]));
  const unknown = vals.findIndex((v) => v.t === "lin");
  if (unknown === -1 || vals.some((v, i) => i !== unknown && v.t !== "num")) return null;
  const u = vals[unknown] as LinVal;
  if (!u.bare) return null;
  const nums = vals as Num[];
  const sq = (latex: string) => (/^[\w.\\]+$/.test(latex) ? `${latex}^{2}` : `(${latex})^{2}`);
  const uses = [p.legs[0], p.legs[1], p.hyp].map((q) => ctx.m.cls[q]);
  if (unknown === 2) {
    const [a, b] = [nums[0], nums[1]];
    return { lines: [`${sq(u.latex)} = ${sq(a.latex)} + ${sq(b.latex)}`], uses, solve: () => Math.sqrt(a.v * a.v + b.v * b.v) };
  }
  const other = nums[unknown === 0 ? 1 : 0];
  const h = nums[2];
  return {
    lines: [`${sq(u.latex)} + ${sq(other.latex)} = ${sq(h.latex)}`],
    uses,
    solve: () => (h.v > other.v ? Math.sqrt(h.v * h.v - other.v * other.v) : null),
  };
}

/** Similar figures: the letter's side over its match = a known pair's ratio: `\frac{x}{6} = \frac{8}{12}`. */
function similarEquation(ctx: Ctx, s: Similar): Equation | null {
  const vals = s.pairs.map(([p, q]) => [classVal(ctx, ctx.m.cls[p]), classVal(ctx, ctx.m.cls[q])] as const);
  const withLetter = vals.findIndex(([p, q]) => p.t === "lin" || q.t === "lin");
  if (withLetter === -1) return null;
  const known = vals.findIndex(([p, q], i) => i !== withLetter && p.t === "num" && q.t === "num");
  if (known === -1) return null;
  const [p, q] = vals[withLetter];
  const [kp, kq] = vals[known] as readonly [Num, Num];
  if ((p.t !== "num" && p.t !== "lin") || (q.t !== "num" && q.t !== "lin") || (p.t === "lin" && q.t === "lin") || kq.v === 0) return null;
  const ratio = kp.v / kq.v;
  return {
    lines: [`\\frac{${p.latex}}{${q.latex}} = \\frac{${kp.latex}}{${kq.latex}}`],
    uses: s.pairs.flat().map((x) => ctx.m.cls[x]),
    solve: () => {
      // p = ratio · q, one of them in the letter
      if (p.t === "lin") return Math.abs(p.a) < TOL ? null : (ratio * (q as Num).v - p.b) / p.a;
      const lin = q as LinVal;
      return Math.abs(ratio * lin.a) < TOL ? null : ((p as Num).v - ratio * lin.b) / (ratio * lin.a);
    },
  };
}

interface Derived {
  c: number;
  v: number;
  lines: string[];
  /** the classes found earlier that its line needs */
  deps: number[];
}

/**
 * Unlabelled angles every other part of a relation knows: their sizes, the line that finds each
 * (`180 - 70 = 110`; `40 + 65 = 105`; `\frac{180 - 40}{2} = 70`) and the angles found earlier that
 * line needs. One per class: the first relation that gives it.
 */
function deriveAll(ctx: Ctx): Derived[] {
  const out: Derived[] = [];
  for (const r of ctx.m.rels) {
    const L = merge(ctx.m, r.lhs).map((t) => ({ ...t, side: "l" as const }));
    const R = merge(ctx.m, r.rhs).map((t) => ({ ...t, side: "r" as const }));
    const vals = [...L, ...R].map((t) => ({ ...t, val: classVal(ctx, t.c) }));
    const free = vals.filter((t) => t.val.t === "free");
    if (free.length !== 1 || vals.some((t) => t.val.t === "lin" || t.val.t === "other")) continue;
    const f = free[0];
    if (out.some((d) => d.c === f.c)) continue;
    const known = vals.filter((t) => t !== f).map((t) => ({ ...t, val: t.val as Num }));
    const same = known.filter((t) => t.side === f.side);
    const opposite = known.filter((t) => t.side !== f.side);
    // k·f = (the other side, with the total when f is on the left) − (the rest of its own side)
    const plus = [...opposite.map((t) => termLatex(t.val, t.k)), ...(f.side === "l" && r.total !== 0 ? [formatNumber(r.total)] : [])];
    const minus = [...same.map((t) => termLatex(t.val, t.k)), ...(f.side === "r" && r.total !== 0 ? [formatNumber(r.total)] : [])];
    const sumOpp = opposite.reduce((s, t) => s + t.k * t.val.v, 0);
    const sumSame = same.reduce((s, t) => s + t.k * t.val.v, 0);
    const v = f.side === "l" ? (sumOpp + r.total - sumSame) / f.k : (sumOpp - sumSame - r.total) / f.k;
    if (!Number.isFinite(v) || plus.length === 0) continue;
    const expr = [joinSum(plus), ...minus].join(" - ");
    const lhs = f.k === 1 ? expr : `\\frac{${expr}}{${formatNumber(f.k)}}`;
    const deps = known.map((t) => t.c).filter((c) => ctx.derived.has(c));
    out.push({ c: f.c, v, lines: [...(r.preface ? [r.preface] : []), `${lhs} = ${formatNumber(v)}`], deps });
  }
  return out;
}

/** The first equation in the letter: marked-equal quantities, a relation, Pythagoras, similar figures. */
function directEquation(ctx: Ctx): Equation | null {
  const candidates: Equation[] = [...classEquations(ctx)];
  // fewest terms first: the fact that ties the unknown most directly to what is given
  const rels = [...ctx.m.rels].sort((a, b) => a.lhs.length + a.rhs.length - (b.lhs.length + b.rhs.length));
  for (const r of rels) {
    const e = relationEquation(ctx, r);
    if (e) candidates.push(e);
  }
  for (const p of ctx.m.pyth) {
    const e = pythagorasEquation(ctx, p);
    if (e) candidates.push(e);
  }
  for (const s of ctx.m.similar) {
    const e = similarEquation(ctx, s);
    if (e) candidates.push(e);
  }
  // an identity (`x = x`) says nothing: the next one
  return candidates.find((e) => e.solve() !== null) ?? null;
}

function equationFor(m: Model, letter: string, solved: ReadonlyMap<string, number>): { lines: string[]; value: number } | null {
  const ctx: Ctx = { m, letter, solved, derived: new Map() };
  const found = new Map<number, { lines: string[]; deps: number[]; order: number }>();
  for (let round = 0; round <= MAX_DERIVED; round++) {
    const eq = directEquation(ctx);
    if (eq) {
      const value = eq.solve();
      if (value === null || !Number.isFinite(value)) return null;
      // the lines of the angles found on the way that this equation needs (and that they need)
      const need = new Set<number>();
      const visit = (c: number) => {
        const d = found.get(c);
        if (!d || need.has(c)) return;
        need.add(c);
        d.deps.forEach(visit);
      };
      eq.uses.forEach(visit);
      const before = [...need].sort((a, b) => found.get(a)!.order - found.get(b)!.order).flatMap((c) => found.get(c)!.lines);
      return { lines: [...before, ...eq.lines], value };
    }
    if (round === MAX_DERIVED) break;
    const derived = deriveAll(ctx);
    if (derived.length === 0) break;
    for (const d of derived) {
      ctx.derived.set(d.c, d.v);
      found.set(d.c, { lines: d.lines, deps: d.deps, order: found.size });
    }
  }
  return null;
}

// ---------------------------------------------------------------- checks

/** Every class's size once the letters are known (labels, marks, then what the facts force). */
function classSizes(m: Model, solved: ReadonlyMap<string, number>): Map<number, number> {
  const size = new Map<number, number>();
  const put = (c: number, v: number, why: string) => {
    const prev = size.get(c);
    if (prev !== undefined && Math.abs(prev - v) > TOL * Math.max(1, Math.abs(v))) reject(`inconsistent: ${why} (${formatNumber(prev)} and ${formatNumber(v)})`);
    size.set(c, v);
  };
  m.qs.forEach((q, i) => {
    if (!q.value) return;
    const v = evalLabel(q.value, solved);
    if (v !== null) put(m.cls[i], v, "quantities marked equal differ");
  });
  for (const [c, v] of m.fixed) put(c, v, "a right angle or an equilateral triangle's angle");
  // what the relations force, until nothing changes
  for (let changed = true, guard = 0; changed && guard < 20; guard++) {
    changed = false;
    for (const r of m.rels) {
      const terms = [...merge(m, r.lhs).map((t) => ({ ...t, s: 1 })), ...merge(m, r.rhs).map((t) => ({ ...t, s: -1 }))];
      const unknown = terms.filter((t) => !size.has(t.c));
      if (unknown.length !== 1) continue;
      const u = unknown[0];
      const rest = terms.filter((t) => t !== u).reduce((acc, t) => acc + t.s * t.k * size.get(t.c)!, 0);
      size.set(u.c, (r.total - rest) / (u.s * u.k));
      changed = true;
    }
  }
  return size;
}

function check(m: Model, solved: ReadonlyMap<string, number>): void {
  const size = classSizes(m, solved);
  for (const r of m.rels) {
    const l = merge(m, r.lhs);
    const rr = merge(m, r.rhs);
    if (![...l, ...rr].every((t) => size.has(t.c))) continue;
    const lv = l.reduce((s, t) => s + t.k * size.get(t.c)!, 0);
    const rv = rr.reduce((s, t) => s + t.k * size.get(t.c)!, 0) + r.total;
    if (Math.abs(lv - rv) > 1e-6 * Math.max(1, Math.abs(rv))) reject(`inconsistent: the ${r.type} fact does not hold (${formatNumber(lv)} ≠ ${formatNumber(rv)})`);
  }
  for (const p of m.pyth) {
    const [a, b, h] = [p.legs[0], p.legs[1], p.hyp].map((q) => size.get(m.cls[q]));
    if (a === undefined || b === undefined || h === undefined) continue;
    if (Math.abs(a * a + b * b - h * h) > 1e-6 * Math.max(1, h * h)) reject("inconsistent: the right triangle's sides do not fit");
  }
  for (const s of m.similar) {
    const ratios = s.pairs.map(([p, q]) => {
      const a = size.get(m.cls[p]);
      const b = size.get(m.cls[q]);
      return a === undefined || b === undefined || b === 0 ? null : a / b;
    });
    const known = ratios.filter((r): r is number => r !== null);
    if (known.some((r) => Math.abs(r - known[0]) > 1e-6 * Math.max(1, Math.abs(known[0])))) reject("inconsistent: the similar figures' sides are not in proportion");
  }
  // sensible sizes: every angle and side positive, an angle less than a full turn — less than 180°
  // in a triangle, on a line or between parallels, 90° in a right angle's parts or at an isosceles base
  m.qs.forEach((q, i) => {
    const v = size.get(m.cls[i]);
    if (v === undefined) return;
    const name = q.label ? `"${q.label}"` : `an unlabelled ${q.kind}`;
    if (!(v > TOL)) reject(`${name} would be ${formatNumber(v)}${q.kind === "angle" ? "°" : ""}, not a positive ${q.kind}`);
    if (q.kind === "angle") {
      const max = m.under.get(m.cls[i]) ?? 360;
      if (v >= max - TOL) reject(`${name} would be ${formatNumber(v)}°, too big for where it is`);
    }
  });
}

// ---------------------------------------------------------------- the plan

/**
 * The lines that solve the figure, one stage per unknown, or why the read cannot be used. See the
 * file comment.
 */
export function planFigure(read: FigureRead, opts: PlanOptions = {}): FigurePlan {
  try {
    const { model, letters, asked } = build(read, opts);
    const solved = new Map<string, number>();
    const stages: FigureStage[] = [];
    let pending = [...letters];
    // a letter may need another one solved first: at most as many passes as letters
    for (let pass = 0; pass < letters.length && pending.length > 0; pass++) {
      const next: string[] = [];
      for (const letter of pending) {
        const eq = equationFor(model, letter, solved);
        if (!eq) {
          next.push(letter);
          continue;
        }
        solved.set(letter, eq.value);
        const q = model.qs.find((x) => x.value?.letter === letter);
        stages.push({ letter, lines: eq.lines, value: eq.value, kind: q?.kind ?? "angle" });
      }
      if (next.length === pending.length) break;
      pending = next;
    }
    if (stages.length === 0) return { ok: false, reason: `no fact ties ${letters.join(", ")} to what is given` };
    // a line that asks for a letter gets that letter or nothing
    if (asked.length > 0 && pending.length > 0) return { ok: false, reason: `nothing finds ${pending.join(", ")}` };
    check(model, solved);
    return { ok: true, stages };
  } catch (err) {
    if (err instanceof Reject) return { ok: false, reason: err.message };
    throw err;
  }
}
