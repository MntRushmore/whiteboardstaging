// The check only (no drawing code, no engine): the chat route runs it on the server, the chat desk
// runs it again on the board before writing (the same function, so both judge a proof the same way).
import { layoutSteps } from "@/lib/hand";
import { checkFigure } from "../figureDraw/check";
import type { FigureSpec } from "../figureDraw/contracts";
import { fmt } from "../figureDraw/labels";
import { factLatex, factText, parseStatement, pointsOf, type AngRef, type Fact, type LineRef, type SegRef } from "../proof/facts";
import { buildFigure, type FigureModel, type FigureRead } from "../proof/figure";
import { planProof, theoremsBeingProved, type PlannedRow } from "../proof/planner";
import { Resolver } from "../proof/resolve";
import { REASON_TEXT } from "../proof/vocab";
import { CHAT_LIMITS, type WriteProofAction } from "./contracts";
import { figureProblems } from "./figure";

/**
 * The board chat's two-column proofs (`write_proof`). A model proposes the proof — its figure (a
 * `FigureSpec`, the figure drawer's contract), the Given statements and the Prove statement — and
 * NOTHING of it is written until the engine has proved it. `checkProofProposal` is that check, pure
 * and fast (a few ms: the planner is bounded), run by the chat route (which repairs a proof it
 * fails once, else drops it and refunds) and again by the board before its hand writes a stroke:
 *
 *  1. the figure is one the drawer draws true to what it says (`checkFigure`), its points named by
 *     single capitals (the names a proof uses);
 *  2. every Given and the Prove read as the proof reader reads a student's (`parseStatement`), as
 *     facts the planner reasons with, about points of the figure;
 *  3. the figure bears them out — congruent sides drawn equal, a midpoint in the middle, a
 *     perpendicular at 90° — so the picture never contradicts the proof;
 *  4. the engine's planner PROVES the Prove statement from the givens with the figure's own
 *     geometry (`planProof`: the shortest proof, every row ticked by `checkProof`), without citing
 *     the theorem being proved (the base angles are proved congruent by congruent halves, never by
 *     the Isosceles △ theorem);
 *  5. the hand can write every line.
 *
 * What comes back is the proof as the board writes it: the Given and Prove statements in the
 * reader's own forms (never the model's words: `M \text{ is the midpoint of } \overline{AB}` is the
 * reader's phrase, printed from the fact), the figure as the proof desk reads one (`FigureRead`),
 * and the planner's rows — a worked proof writes exactly those.
 */

export const PROOF_CHECK = {
  /** two lengths the proof says are congruent agree to this share */
  lengthTol: 0.03,
  /** two angles (or an angle and its measure) agree to this many degrees */
  angleDeg: 2,
  /** a named point on a drawn side: within this share of the figure's size of it */
  onTol: 0.012,
  /** the most rows the board lays out on one screen beside the figure */
  maxRows: 11,
  /** facts on the Given line (each is one Given of the checked action) */
  maxGivenFacts: CHAT_LIMITS.proofGivens,
  /** the hand size the writability check lays each line out at */
  handSize: 30,
} as const;

/** Facts the planner reasons from (a Given) and the facts it derives (a Prove). */
const GIVEN_KINDS: ReadonlySet<Fact["t"]> = new Set<Fact["t"]>(["segCong", "angCong", "triCong", "parallel", "perp", "midpoint", "angBisect", "segBisect", "angMeasure"]);
const PROVE_KINDS: ReadonlySet<Fact["t"]> = new Set<Fact["t"]>(["segCong", "angCong", "triCong", "parallel"]);

/** A proof checked by the engine, as the board writes it. */
export interface CheckedProof {
  /** the Given line's statements, one per fact, in the reader's forms (maths where it can be) */
  given: string[];
  /** the Prove statement, in maths */
  prove: string;
  givenFacts: Fact[];
  proveFacts: Fact[];
  /** the figure as the proof desk reads one: points (x right, y down) and the lines through them */
  figure: FigureRead;
  /** the proof, row by row — the planner's rows */
  rows: PlannedRow[];
  worked: boolean;
}

export type ProofProposalVerdict = { ok: true; proof: CheckedProof } | { ok: false; problems: string[] };

export interface ProofCheckOptions {
  /** the drawer's check (tests replace it) */
  checkFigure?: (spec: FigureSpec) => string[];
  /** the hand's interlock: every glyph of the line drawable */
  canWrite?: (latex: string) => boolean;
}

/** The hand can write this line (the server-safe layout, as `checkFigure` uses). */
export function canWriteLine(latex: string): boolean {
  try {
    return layoutSteps([latex], { size: PROOF_CHECK.handSize, seed: 1 }).unsupported.length === 0;
  } catch {
    return false;
  }
}

/** The Given line and the Prove line as the tutor writes them (the reader's `Given:` / `Prove:`). */
export function givenLineLatex(statements: readonly string[]): string {
  return `\\text{Given: } ${statements.join(", \\ ")}`;
}
export function proveLineLatex(statement: string): string {
  return `\\text{Prove: } ${statement}`;
}

/** A fact as the tutor writes it on the Given line: maths when it can be, else the reader's phrase. */
export function givenStatementLatex(f: Fact): string | null {
  return factLatex(f) ?? (factText(f) || null);
}

// ---------------------------------------------------------------- the figure as the proof reads it

type P = { x: number; y: number };

const isName = (s: string): boolean => /^[A-Z]$/.test(s);

/** Distance from p to the line through a and b, and where p falls along it (0 at a, 1 at b). */
function along(p: P, a: P, b: P): { d: number; t: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  const d = Math.abs(dx * (a.y - p.y) - (a.x - p.x) * dy) / Math.sqrt(len2);
  return { d, t };
}

/**
 * The figure as the proof desk reads one (`FigureRead`: what a model's read of a student's drawing
 * returns): every point named by a single capital (y flipped: the read is y down), and every
 * straight line drawn — sides, polygon sides, lines and rays — through the named points on it, in
 * order. Pieces on one straight line are one line (sides BD and DC are the line BDC), as the ink
 * reader joins them. A numbered angle label (`1`, `2`) names its angle, as on a student's figure.
 */
export function figureReadOf(spec: FigureSpec): FigureRead {
  const named = Object.entries(spec.points).filter(([n]) => isName(n));
  const pos = new Map<string, P>(named.map(([n, p]) => [n, { x: p.x, y: p.y }]));
  const all = Object.values(spec.points);
  const span = Math.max(1e-9, Math.max(...all.map((p) => p.x)) - Math.min(...all.map((p) => p.x)), Math.max(...all.map((p) => p.y)) - Math.min(...all.map((p) => p.y)));
  const tol = PROOF_CHECK.onTol * span;
  const eps = 1e-6;

  // every straight element and the named points on it
  const elements: Array<{ a: P; b: P; kind: "seg" | "line" | "ray" }> = [];
  const point = (n: string): P | undefined => spec.points[n] && { x: spec.points[n].x, y: spec.points[n].y };
  const add = (from: string, to: string, kind: "seg" | "line" | "ray") => {
    const a = point(from);
    const b = point(to);
    if (a && b && Math.hypot(b.x - a.x, b.y - a.y) > tol) elements.push({ a, b, kind });
  };
  for (const s of spec.segments ?? []) add(s.from, s.to, "seg");
  for (const poly of spec.polygons ?? []) poly.vertices.forEach((v, i) => add(v, poly.vertices[(i + 1) % poly.vertices.length], "seg"));
  for (const l of spec.lines ?? []) add(l.through[0], l.through[1], l.extend === "ray" ? "ray" : "line");
  let sets: Set<string>[] = elements.map(({ a, b, kind }) => {
    const on = new Set<string>();
    for (const [n, p] of pos) {
      const { d, t } = along(p, a, b);
      if (d > tol) continue;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const slack = tol / len;
      if (kind === "seg" && (t < -slack - eps || t > 1 + slack + eps)) continue;
      if (kind === "ray" && t < -slack - eps) continue;
      on.add(n);
    }
    return on;
  });
  sets = sets.filter((s) => s.size >= 2);

  // pieces of one straight line are one line
  const collinear = (names: readonly string[]): boolean => {
    let best: [P, P] | null = null;
    let far = -1;
    for (let i = 0; i < names.length; i++)
      for (let j = i + 1; j < names.length; j++) {
        const p = pos.get(names[i])!;
        const q = pos.get(names[j])!;
        const d = Math.hypot(p.x - q.x, p.y - q.y);
        if (d > far) {
          far = d;
          best = [p, q];
        }
      }
    if (!best) return true;
    return names.every((n) => along(pos.get(n)!, best![0], best![1]).d <= tol);
  };
  for (let merged = true; merged; ) {
    merged = false;
    outer: for (let i = 0; i < sets.length; i++)
      for (let j = i + 1; j < sets.length; j++) {
        if (![...sets[i]].some((n) => sets[j].has(n))) continue;
        const union = new Set([...sets[i], ...sets[j]]);
        if (!collinear([...union])) continue;
        sets[i] = union;
        sets.splice(j, 1);
        merged = true;
        break outer;
      }
  }
  const lines = [
    ...new Set(
      sets.map((s) => {
        const names = [...s];
        let a = names[0];
        let b = names[1];
        let far = -1;
        for (const p of names)
          for (const q of names) {
            const d = Math.hypot(pos.get(p)!.x - pos.get(q)!.x, pos.get(p)!.y - pos.get(q)!.y);
            if (d > far) {
              far = d;
              a = p;
              b = q;
            }
          }
        const [pa, pb] = [pos.get(a)!, pos.get(b)!];
        return names.sort((m, n) => along(pos.get(m)!, pa, pb).t - along(pos.get(n)!, pa, pb).t).join("");
      }),
    ),
  ];
  const angles: Record<string, string> = {};
  for (const a of spec.angles ?? []) {
    const label = a.label?.trim();
    if (label && /^\d{1,2}$/.test(label) && isName(a.at) && isName(a.from) && isName(a.to)) angles[label] = `${a.from}${a.at}${a.to}`;
  }
  const points: Record<string, readonly [number, number]> = {};
  // `+ 0`: no -0 in the read (y flipped at the origin)
  for (const [n, p] of pos) points[n] = [round(p.x) + 0, round(-p.y) + 0];
  return { points, lines, ...(Object.keys(angles).length ? { angles } : {}) };
}

const round = (v: number): number => Math.round(v * 1000) / 1000;

// ---------------------------------------------------------------- the figure bears the statements out

function angleDeg(a: P, v: P, c: P): number {
  const u = { x: a.x - v.x, y: a.y - v.y };
  const w = { x: c.x - v.x, y: c.y - v.y };
  const nu = Math.hypot(u.x, u.y);
  const nw = Math.hypot(w.x, w.y);
  if (nu === 0 || nw === 0) return NaN;
  const cos = Math.max(-1, Math.min(1, (u.x * w.x + u.y * w.y) / (nu * nw)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** Degrees between two directions, 0–90 (a line has no way round). */
function between(a: P, b: P, c: P, d: P): number {
  const t1 = Math.atan2(b.y - a.y, b.x - a.x);
  const t2 = Math.atan2(d.y - c.y, d.x - c.x);
  let diff = Math.abs(((t1 - t2) * 180) / Math.PI) % 180;
  if (diff > 90) diff = 180 - diff;
  return diff;
}

/** What the drawing says against a fact, as a sentence a model can act on; null when it bears it out. */
function disagreement(f: Fact, at: (n: string) => P, r: Resolver): string | null {
  const len = (s: SegRef) => Math.hypot(at(s.a).x - at(s.b).x, at(s.a).y - at(s.b).y);
  const segName = (s: SegRef) => `${s.a}${s.b}`;
  const angOf = (a: AngRef): { name: string; deg: number } | null => {
    const three = r.expand(a);
    if (!three || three.k !== "ang") return null;
    return { name: `∠${three.a}${three.v}${three.c}`, deg: angleDeg(at(three.a), at(three.v), at(three.c)) };
  };
  const lineOf = (l: LineRef): [P, P] | null => (l.k === "line" ? [at(l.a), at(l.b)] : null);
  const sameLen = (x: number, y: number) => Math.abs(x - y) <= PROOF_CHECK.lengthTol * Math.max(x, y);
  const tex = factLatex(f) ?? factText(f);
  switch (f.t) {
    case "segCong": {
      const [x, y] = [len(f.x), len(f.y)];
      return sameLen(x, y) ? null : `The figure does not show ${tex}: ${segName(f.x)} is drawn ${fmt(x)} long and ${segName(f.y)} ${fmt(y)}. Place the points so they are equal.`;
    }
    case "angCong": {
      const x = angOf(f.x);
      const y = angOf(f.y);
      if (!x || !y) return `The angles in ${tex} cannot be pinned down in the figure; name each with three points (∠ABC, vertex in the middle).`;
      return Math.abs(x.deg - y.deg) <= PROOF_CHECK.angleDeg ? null : `The figure does not show ${tex}: ${x.name} is drawn ${fmt(x.deg)}° and ${y.name} ${fmt(y.deg)}°.`;
    }
    case "triCong": {
      for (const [i, j] of [
        [0, 1],
        [1, 2],
        [0, 2],
      ]) {
        const a = Math.hypot(at(f.x[i]).x - at(f.x[j]).x, at(f.x[i]).y - at(f.x[j]).y);
        const b = Math.hypot(at(f.y[i]).x - at(f.y[j]).x, at(f.y[i]).y - at(f.y[j]).y);
        if (!sameLen(a, b)) return `The figure does not show ${tex}: ${f.x[i]}${f.x[j]} is drawn ${fmt(a)} long and its match ${f.y[i]}${f.y[j]} ${fmt(b)}.`;
      }
      return null;
    }
    case "parallel":
    case "perp": {
      const x = lineOf(f.x);
      const y = lineOf(f.y);
      if (!x || !y) return `Name every line in ${tex} by two of its points (\\overline{AB} \\parallel \\overline{CD}), not by a letter.`;
      const d = between(x[0], x[1], y[0], y[1]);
      if (f.t === "parallel") return d <= PROOF_CHECK.angleDeg ? null : `The figure does not show ${tex}: the lines meet at ${fmt(d)}°.`;
      return Math.abs(d - 90) <= PROOF_CHECK.angleDeg ? null : `The figure does not show ${tex}: the lines meet at ${fmt(d)}°, not 90°.`;
    }
    case "midpoint": {
      const a = at(f.s.a);
      const b = at(f.s.b);
      const m = at(f.m);
      const off = Math.hypot(m.x - (a.x + b.x) / 2, m.y - (a.y + b.y) / 2);
      return off <= PROOF_CHECK.lengthTol * len(f.s) ? null : `The figure does not show ${tex}: ${f.m} is not at the middle of ${segName(f.s)} (the middle is (${fmt((a.x + b.x) / 2)}, ${fmt((a.y + b.y) / 2)})).`;
    }
    case "angBisect": {
      const whole = r.expand(f.ang);
      if (!whole || whole.k !== "ang" || whole.v !== f.ray[0]) return `In ${tex} the ray must start at the angle's vertex; name the angle with three points.`;
      const one = angleDeg(at(whole.a), at(whole.v), at(f.ray[1]));
      const two = angleDeg(at(f.ray[1]), at(whole.v), at(whole.c));
      return Math.abs(one - two) <= PROOF_CHECK.angleDeg ? null : `The figure does not show ${tex}: its halves are drawn ${fmt(one)}° and ${fmt(two)}°.`;
    }
    case "segBisect": {
      const a = at(f.s.a);
      const b = at(f.s.b);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (f.at) {
        const m = at(f.at);
        if (Math.hypot(m.x - mid.x, m.y - mid.y) > PROOF_CHECK.lengthTol * len(f.s)) return `The figure does not show ${tex}: ${f.at} is not at the middle of ${segName(f.s)}.`;
      }
      const by = lineOf(f.by);
      if (!by) return `Name the bisecting line in ${tex} by two of its points.`;
      return along(mid, by[0], by[1]).d <= PROOF_CHECK.lengthTol * len(f.s) ? null : `The figure does not show ${tex}: the line does not pass through the middle of ${segName(f.s)}.`;
    }
    case "angMeasure": {
      const x = angOf(f.x);
      if (!x) return `The angle in ${tex} cannot be pinned down in the figure; name it with three points (vertex in the middle).`;
      return Math.abs(x.deg - f.deg) <= PROOF_CHECK.angleDeg ? null : `The figure does not show ${tex}: ${x.name} is drawn ${fmt(x.deg)}°.`;
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------- the check

/** Every fact of one statement, or why it cannot be one. */
function readStatement(latex: string, role: "Given" | "Prove"): { facts: Fact[] } | { problem: string } {
  const st = parseStatement(latex);
  if (!st.complete || st.facts.length === 0) {
    return {
      problem: `The ${role} statement "${latex}" could not be read. Write it as the board's proof reader reads one: \\overline{AB} \\cong \\overline{CD}, \\angle ABC \\cong \\angle DEF, \\triangle ABC \\cong \\triangle DEF, \\overline{AB} \\parallel \\overline{CD}, \\overline{AD} \\perp \\overline{BC}, m\\angle ABC = 90^{\\circ}, M \\text{ is the midpoint of } \\overline{AB}, \\overrightarrow{BD} \\text{ bisects } \\angle ABC.`,
    };
  }
  return { facts: st.facts };
}

const KIND_WORDS: Partial<Record<Fact["t"], string>> = {
  isosceles: "that a triangle is isosceles (state its congruent sides instead: \\overline{AB} \\cong \\overline{AC})",
  rightTri: "that a triangle is a right triangle (state the right angle instead: m\\angle ABC = 90^{\\circ})",
  triSim: "similar triangles",
  segLength: "a length",
  supp: "supplementary angles",
  vertical: "vertical angles as a statement",
  linearPair: "a linear pair as a statement",
};

/**
 * Checks a proposed proof (see the file comment). `problems` are sentences for the model's one
 * repair; `proof` is what the board writes. Never throws.
 */
export function checkProofProposal(p: Pick<WriteProofAction, "figure" | "given" | "prove"> & { worked?: boolean }, opts: ProofCheckOptions = {}): ProofProposalVerdict {
  try {
    return check(p, opts);
  } catch (err) {
    return { ok: false, problems: [err instanceof Error ? err.message.slice(0, 160) : "the proof could not be checked"] };
  }
}

function check(p: Pick<WriteProofAction, "figure" | "given" | "prove"> & { worked?: boolean }, opts: ProofCheckOptions): ProofProposalVerdict {
  const canWrite = opts.canWrite ?? canWriteLine;
  const spec = p.figure;
  const problems: string[] = [];

  // 1. the figure
  problems.push(...figureProblems(spec, opts.checkFigure ?? checkFigure));
  const badNames = Object.keys(spec.points ?? {}).filter((n) => !isName(n));
  if (badNames.length > 0) problems.push(`Name every point of a proof's figure by one capital letter (A, B, C…): ${badNames.slice(0, 4).join(", ")} ${badNames.length === 1 ? "is" : "are"} not.`);
  if (problems.length > 0) return { ok: false, problems: problems.slice(0, 8) };

  // 2. the statements
  const givenFacts: Fact[] = [];
  for (const g of p.given) {
    const read = readStatement(g, "Given");
    if ("problem" in read) problems.push(read.problem);
    else givenFacts.push(...read.facts);
  }
  const proveRead = readStatement(p.prove, "Prove");
  if ("problem" in proveRead) problems.push(proveRead.problem);
  const proveFacts = "facts" in proveRead ? proveRead.facts : [];
  if (problems.length > 0) return { ok: false, problems };
  for (const f of givenFacts) if (!GIVEN_KINDS.has(f.t)) problems.push(`The proof engine does not reason from ${KIND_WORDS[f.t] ?? f.t}; give the Given as congruent sides or angles, parallel or perpendicular lines, a midpoint, a bisector or an angle's measure.`);
  if (proveFacts.length !== 1) problems.push("Prove exactly one statement.");
  else if (!PROVE_KINDS.has(proveFacts[0].t)) problems.push("Prove congruent triangles, congruent sides, congruent angles or parallel lines: those are what the proof engine proves.");
  if (givenFacts.length > PROOF_CHECK.maxGivenFacts) problems.push(`At most ${PROOF_CHECK.maxGivenFacts} givens.`);
  const names = new Set(Object.keys(spec.points));
  const missing = [...new Set([...givenFacts, ...proveFacts].flatMap(pointsOf))].filter((n) => !names.has(n));
  if (missing.length > 0) problems.push(`The proof names ${missing.join(", ")}, which the figure does not have: every point in the proof must be a point of the figure.`);
  if (problems.length > 0) return { ok: false, problems: [...new Set(problems)].slice(0, 8) };

  // 3. the figure bears them out
  const read = figureReadOf(spec);
  const model: FigureModel = buildFigure(read);
  const r = new Resolver(model, [...givenFacts, ...proveFacts]);
  const at = (n: string): P => ({ x: spec.points[n].x, y: spec.points[n].y });
  for (const f of [...givenFacts, ...proveFacts]) {
    const why = disagreement(f, at, r);
    if (why) problems.push(why);
  }
  if (problems.length > 0) return { ok: false, problems: problems.slice(0, 8) };

  // 4. the engine proves it — something that takes steps, not a given restated
  const givenKeys = new Set(givenFacts.map((f) => r.factKey(f)));
  if (proveFacts.every((f) => givenKeys.has(r.factKey(f)))) return { ok: false, problems: ["The Prove statement is one of the givens: prove something that takes steps."] };
  const problem = { givens: { facts: givenFacts, complete: true }, prove: { facts: proveFacts, complete: true }, rows: [] };
  const without = theoremsBeingProved(problem, model);
  const rows = planProof(problem, model, { without });
  const proveTex = factLatex(proveFacts[0]) ?? "";
  if (rows === null) {
    const not = without.length ? ` It may not cite ${without.map((w) => REASON_TEXT[w]).join(" or ")}, the theorem being proved: add an auxiliary segment (e.g. the median to a midpoint) and its given.` : "";
    return {
      ok: false,
      problems: [
        `The proof engine could not prove ${proveTex} from these givens with this figure.${not} It proves with: Given, Reflexive, Transitive, SSS, SAS, ASA, AAS, HL, CPCTC, Vertical ∠s, Def. of midpoint, Def. of ∠ bisector, Def. of seg. bisector, Def. of ⊥ with Rt. ∠s ≅, Alt. int. / Alt. ext. / Corr. ∠s (and their converses) with the parallel lines drawn, Isos. △ thm and its converse. Draw every side of every triangle the proof uses (segments or polygon sides), put each point of a side exactly on it, and give enough givens.`,
      ],
    };
  }
  if (rows.length === 0) return { ok: false, problems: ["The Prove statement is one of the givens: prove something that takes steps."] };
  if (rows.length > PROOF_CHECK.maxRows) return { ok: false, problems: [`The proof takes ${rows.length} rows; the board has room for ${PROOF_CHECK.maxRows}. Choose a shorter one.`] };

  // the Given and Prove lines in the reader's forms — and they read back as the same facts
  const given: string[] = [];
  for (const f of givenFacts) {
    const tex = givenStatementLatex(f);
    if (!tex) return { ok: false, problems: ["A given cannot be written on the board."] };
    given.push(tex);
  }
  const back = parseStatement(given.join(", \\ "));
  const key = (fs: readonly Fact[]) => fs.map((f) => r.factKey(f)).sort().join(";");
  if (!back.complete || key(back.facts) !== key(givenFacts) || key(parseStatement(proveTex).facts) !== key(proveFacts)) return { ok: false, problems: ["The proof's statements do not read back as written."] };

  // 5. the hand writes every line
  const lines = [...given, proveTex, ...rows.flatMap((row) => [row.statement, row.reasonLatex])];
  const unwritable = lines.find((l) => !canWrite(l));
  if (unwritable) return { ok: false, problems: [`The board's hand cannot write "${unwritable}".`] };

  return { ok: true, proof: { given, prove: proveTex, givenFacts, proveFacts, figure: read, rows, worked: p.worked ?? true } };
}
