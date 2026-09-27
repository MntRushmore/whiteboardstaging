/**
 * The proof planner: forward chaining from the givens (and the rows already written) over the same
 * rules the checker knows, round by round, until the Prove statement is derived — then the
 * SHORTEST proof of it is read back (fewest rows: every derivation of every fact is kept, and each
 * fact takes the one needing the fewest rows), premises before conclusions. Bounded: a few rounds,
 * a few thousand facts. Returns the rows still to write, or null when it cannot finish.
 *
 * A given the tutor can write in maths (`\overline{AB} \cong \overline{CD}`) gets a Given row the
 * first time it is used; one that needs words (M is the midpoint of AB) is used straight from the
 * Given line — the tutor never writes words outside the reason column.
 */
import { checkProof, problemFacts, type ProofProblem } from "./checker";
import { factLatex, seg, statementLatex, type AngRef, type Fact, type LineRef, type TriRef } from "./facts";
import { lineThrough, type FigureModel } from "./figure";
import { Know, POSTULATE_ORDER, PERMS } from "./know";
import { Resolver, segKey, triAngle, triSide } from "./resolve";
import type { ReasonId } from "./vocab";
import { reasonLatex } from "./vocab";

export interface PlannedRow {
  facts: Fact[];
  /** the statement as the tutor writes it (maths only) */
  statement: string;
  reason: ReasonId;
  /** the reason as the tutor writes it */
  reasonLatex: string;
}

export interface PlanOptions {
  maxRounds?: number;
  maxFacts?: number;
}

interface Derivation {
  fact: Fact;
  key: string;
  reason: ReasonId;
  premises: string[];
}

const DEFAULTS = { maxRounds: 7, maxFacts: 4000 };

/**
 * The rows that finish the proof after `problem.rows` (only rows the caller trusts: nothing ringed),
 * or null when the rules cannot reach the Prove statement within the bounds. [] when it is proved.
 */
export function planProof(problem: ProofProblem, figure: FigureModel | null, opts: PlanOptions = {}): PlannedRow[] | null {
  const { maxRounds, maxFacts } = { ...DEFAULTS, ...opts };
  const goals = problem.prove?.facts ?? [];
  if (!problem.prove?.complete || goals.length === 0) return null;
  const r = new Resolver(figure, problemFacts(problem));
  const goalKeys = goals.map((g) => r.factKey(g));
  if (goalKeys.some((k) => k === null)) return null;
  const goalForm = new Map<string, Fact>(goals.map((g, i) => [goalKeys[i]!, g]));

  // what is known before any new row: the givens (each may need its Given row) and the rows written
  const known = new Map<string, Fact>();
  const base = new Set<string>();
  const givenOrder: string[] = [];
  const stated = new Set<string>();
  for (const f of problem.givens?.facts ?? []) {
    const k = r.factKey(f);
    if (k === null || known.has(k)) continue;
    known.set(k, f);
    base.add(k);
    givenOrder.push(k);
  }
  for (const row of problem.rows) {
    for (const f of row.statement?.facts ?? []) {
      const k = r.factKey(f);
      if (k === null) continue;
      stated.add(k);
      if (!known.has(k)) known.set(k, f);
      base.add(k);
    }
  }
  if (goalKeys.every((k) => stated.has(k!))) return [];

  const derivs = new Map<string, Derivation[]>();
  const order: string[] = [];
  let foundAt = -1;
  for (let round = 1; round <= maxRounds; round++) {
    const know = new Know(r);
    for (const f of known.values()) know.add(f);
    const fresh: Derivation[] = [];
    for (const d of generate(know, r, figure, goals)) {
      if (base.has(d.key)) continue;
      const list = derivs.get(d.key);
      if (list) {
        if (!list.some((x) => x.reason === d.reason && x.premises.join() === d.premises.join())) list.push(d);
        continue;
      }
      derivs.set(d.key, [d]);
      fresh.push(d);
    }
    for (const d of fresh) {
      known.set(d.key, d.fact);
      order.push(d.key);
    }
    if (foundAt < 0 && goalKeys.every((k) => known.has(k!))) foundAt = round;
    if (foundAt >= 0 && round > foundAt) break;
    if (fresh.length === 0 || known.size > maxFacts) break;
  }
  if (foundAt < 0) return null;

  // the fewest rows for each fact: iterate derivations to a fixed point
  const givenSet = new Set(givenOrder);
  const printable = (k: string) => factLatex(known.get(k)!) !== null;
  const need = new Map<string, Set<string>>();
  const choice = new Map<string, Derivation>();
  for (const k of base) need.set(k, givenSet.has(k) && !stated.has(k) && printable(k) ? new Set([k]) : new Set());
  const costOf = (d: Derivation): Set<string> | null => {
    const s = new Set<string>([d.key]);
    for (const p of d.premises) {
      const n = need.get(p);
      if (!n || n.has(d.key)) return null;
      for (const x of n) s.add(x);
    }
    return s;
  };
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    for (const k of order) {
      for (const d of derivs.get(k) ?? []) {
        const c = costOf(d);
        if (!c) continue;
        const cur = need.get(k);
        if (!cur || c.size < cur.size) {
          need.set(k, c);
          choice.set(k, d);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  const needed = new Set<string>();
  for (const g of goalKeys) {
    const n = need.get(g!);
    if (!n) return null;
    for (const x of n) needed.add(x);
  }

  // premises before conclusions: givens first (in the Given line's order), then by depth
  const depth = new Map<string, number>();
  const depthOf = (k: string): number => {
    const known = depth.get(k);
    if (known !== undefined) return known;
    const d = choice.get(k);
    const v = d ? 1 + Math.max(0, ...d.premises.map(depthOf)) : 0;
    depth.set(k, v);
    return v;
  };
  const rank = new Map(order.map((k, i) => [k, i]));
  const rows = [...needed].sort((a, b) => {
    const ga = givenSet.has(a) && !choice.has(a);
    const gb = givenSet.has(b) && !choice.has(b);
    if (ga !== gb) return ga ? -1 : 1;
    if (ga && gb) return givenOrder.indexOf(a) - givenOrder.indexOf(b);
    return depthOf(a) - depthOf(b) || (rank.get(a) ?? 0) - (rank.get(b) ?? 0);
  });

  const out: PlannedRow[] = [];
  for (const k of rows) {
    const d = choice.get(k);
    const reason: ReasonId = d ? d.reason : "given";
    const fact = goalForm.get(k) ?? (d ? d.fact : known.get(k)!);
    const statement = statementLatex([fact]);
    if (statement === null) return null;
    out.push({ facts: [fact], statement, reason, reasonLatex: reasonLatex(reason) });
  }
  // belt and braces: the planned proof must check, every new row a tick
  const full: ProofProblem = { ...problem, rows: [...problem.rows, ...out.map((p) => ({ statement: { facts: p.facts, complete: true }, reason: p.reason }))] };
  const verdicts = checkProof(full, figure).slice(problem.rows.length);
  if (verdicts.some((v) => v.verdict !== "ok")) return null;
  return out;
}

/** The parts (segment and angle keys) of the triangles of interest, the goal and every known fact. */
function partsOfInterest(r: Resolver, facts: Iterable<Fact>): { segs: Set<string>; angs: Map<string, AngRef> } {
  const segs = new Set<string>();
  const angs = new Map<string, AngRef>();
  const addAng = (a: AngRef) => {
    const k = r.angKey(a);
    if (k && !angs.has(k)) angs.set(k, a);
  };
  for (const t of r.triangles) {
    for (let i = 0; i < 3; i++) {
      segs.add(segKey(triSide(t, i, (i + 1) % 3)));
      addAng(triAngle(t, i));
    }
  }
  for (const f of facts) {
    if (f.t === "segCong") {
      segs.add(segKey(f.x));
      segs.add(segKey(f.y));
    } else if (f.t === "angCong" || f.t === "supp" || f.t === "vertical" || f.t === "linearPair") {
      addAng(f.x);
      addAng(f.y);
    } else if (f.t === "angMeasure") addAng(f.x);
  }
  return { segs, angs };
}

const lineRefOf = (fig: FigureModel, i: number): LineRef => ({ k: "line", a: fig.lines[i][0], b: fig.lines[i][fig.lines[i].length - 1] });

/** Everything one rule application derives from what is known (direct facts only). */
function generate(K: Know, r: Resolver, fig: FigureModel | null, goals: readonly Fact[]): Derivation[] {
  const out: Derivation[] = [];
  const push = (fact: Fact, reason: ReasonId, premises: string[]) => {
    const key = r.factKey(fact);
    if (key === null || premises.some((p) => !p)) return;
    out.push({ fact, key, reason, premises });
  };
  const { segs, angs } = partsOfInterest(r, [...K.facts.values(), ...goals]);
  const tris = r.triangles;

  // Reflexive: a side or an angle two triangles share
  for (let i = 0; i < tris.length; i++)
    for (let j = i + 1; j < tris.length; j++) {
      for (let a = 0; a < 3; a++)
        for (let b = a + 1; b < 3; b++) {
          const s = triSide(tris[i], a, b);
          const k = segKey(s);
          for (let c = 0; c < 3; c++)
            for (let d = c + 1; d < 3; d++) if (segKey(triSide(tris[j], c, d)) === k) push({ t: "segCong", x: s, y: s }, "reflexive", []);
        }
      for (let a = 0; a < 3; a++) {
        const ka = r.angKey(triAngle(tris[i], a));
        for (let b = 0; b < 3; b++) {
          if (ka && r.angKey(triAngle(tris[j], b)) === ka) {
            const x = triAngle(tris[i], a);
            push({ t: "angCong", x, y: x }, "reflexive", []);
          }
        }
      }
    }

  if (fig) {
    for (const [x, y] of fig.vertical) push({ t: "angCong", x, y }, "vertical", []);
    for (const p of fig.pairs) {
      if (p.kind === "sameSide") continue;
      const l1 = `L${p.lines[0]}`;
      const l2 = `L${p.lines[1]}`;
      const par = K.parallels.find((q) => (q.a === l1 && q.b === l2) || (q.a === l2 && q.b === l1));
      if (par) push({ t: "angCong", x: p.x, y: p.y }, p.kind, [par.key]);
      if (p.kind === "altInterior" || p.kind === "corresponding") {
        const kx = r.angKey(p.x);
        const ky = r.angKey(p.y);
        const cong = kx && ky ? K.angCong(kx, ky, "direct") : null;
        if (cong) push({ t: "parallel", x: lineRefOf(fig, p.lines[0]), y: lineRefOf(fig, p.lines[1]) }, p.kind === "altInterior" ? "altInteriorConverse" : "correspondingConverse", [cong]);
      }
    }
  }

  for (const m of K.midpoints) push({ t: "segCong", x: seg(m.s.a, m.m), y: seg(m.m, m.s.b) }, "midpoint", [m.key]);
  for (const { f, key } of K.angBisects) {
    const whole = r.expand(f.ang);
    if (!whole || whole.k !== "ang") continue;
    const [v, d] = f.ray;
    push({ t: "angCong", x: { k: "ang", a: whole.a, v, c: d }, y: { k: "ang", a: d, v, c: whole.c } }, "angleBisector", [key]);
  }
  for (const { f, key } of K.segBisects) {
    let at = f.at;
    if (!at && fig && f.by.k === "line") {
      const li = lineThrough(fig, f.by.a, f.by.b);
      const ls = lineThrough(fig, f.s.a, f.s.b);
      if (li >= 0 && ls >= 0) at = fig.lines[li].find((p) => fig.lines[ls].includes(p));
    }
    if (at) push({ t: "segCong", x: seg(f.s.a, at), y: seg(at, f.s.b) }, "segmentBisector", [key]);
  }

  // Def. of ⊥: the angles of interest a ⊥ makes right; then any two right angles are congruent
  for (const [k, a] of angs) {
    const perp = K.perpRight(k);
    if (perp) push({ t: "angMeasure", x: a, deg: 90 }, "perpendicular", [perp]);
  }
  const rights = [...angs.entries()].filter(([k]) => K.right.has(k));
  for (let i = 0; i < rights.length; i++)
    for (let j = i + 1; j < rights.length; j++) push({ t: "angCong", x: rights[i][1], y: rights[j][1] }, "rightAngles", [K.right.get(rights[i][0])!, K.right.get(rights[j][0])!]);

  // equal measures (not right angles: those are Rt. ∠s ≅)
  for (let i = 0; i < K.measures.length; i++)
    for (let j = i + 1; j < K.measures.length; j++) {
      const a = K.measures[i];
      const b = K.measures[j];
      if (a.deg !== b.deg || a.deg === 90 || a.ang === b.ang) continue;
      const x = angs.get(a.ang);
      const y = angs.get(b.ang);
      if (x && y) push({ t: "angCong", x, y }, "substitution", [a.key, b.key]);
    }

  // isosceles triangles, both ways
  for (const t of tris) {
    for (let k = 0; k < 3; k++) {
      const i = (k + 1) % 3;
      const j = (k + 2) % 3;
      const legs = K.segCong(segKey([t[k], t[i]]), segKey([t[k], t[j]]), "direct");
      if (legs) push({ t: "angCong", x: triAngle(t, i), y: triAngle(t, j) }, "isosceles", [legs]);
      const ai = r.angKey(triAngle(t, i));
      const aj = r.angKey(triAngle(t, j));
      const base = ai && aj ? K.angCong(ai, aj, "direct") : null;
      if (base) push({ t: "segCong", x: triSide(t, k, i), y: triSide(t, k, j) }, "isoscelesConverse", [base]);
    }
  }

  // Transitive: a ≅ b and b ≅ c, for parts of interest
  const segFacts = [...K.facts.entries()].filter(([, f]) => f.t === "segCong") as Array<[string, Extract<Fact, { t: "segCong" }>]>;
  for (let i = 0; i < segFacts.length; i++)
    for (let j = i + 1; j < segFacts.length; j++) {
      const [k1, f1] = segFacts[i];
      const [k2, f2] = segFacts[j];
      const e1 = [f1.x, f1.y];
      const e2 = [f2.x, f2.y];
      for (let ia = 0; ia < 2; ia++)
        for (let ib = 0; ib < 2; ib++) {
          if (segKey(e1[ia]) !== segKey(e2[ib])) continue;
          const x = e1[1 - ia];
          const y = e2[1 - ib];
          if (segKey(x) === segKey(y) || !segs.has(segKey(x)) || !segs.has(segKey(y))) continue;
          push({ t: "segCong", x, y }, "transitive", [k1, k2]);
        }
    }
  const angFacts = [...K.facts.entries()].filter(([, f]) => f.t === "angCong") as Array<[string, Extract<Fact, { t: "angCong" }>]>;
  for (let i = 0; i < angFacts.length; i++)
    for (let j = i + 1; j < angFacts.length; j++) {
      const [k1, f1] = angFacts[i];
      const [k2, f2] = angFacts[j];
      const e1 = [f1.x, f1.y];
      const e2 = [f2.x, f2.y];
      for (let ia = 0; ia < 2; ia++)
        for (let ib = 0; ib < 2; ib++) {
          const ka = r.angKey(e1[ia]);
          if (!ka || ka !== r.angKey(e2[ib])) continue;
          const x = e1[1 - ia];
          const y = e2[1 - ib];
          const kx = r.angKey(x);
          const ky = r.angKey(y);
          if (!kx || !ky || kx === ky || !angs.has(kx) || !angs.has(ky)) continue;
          push({ t: "angCong", x, y }, "transitive", [k1, k2]);
        }
    }

  // the postulates, for every two triangles in every correspondence
  for (let i = 0; i < tris.length; i++)
    for (let j = 0; j < tris.length; j++) {
      if (i === j) continue;
      const t1 = tris[i];
      const t2 = tris[j];
      if ([...t1].sort().join("") === [...t2].sort().join("")) continue;
      for (const perm of PERMS) {
        const y: TriRef = [t2[perm[0]], t2[perm[1]], t2[perm[2]]];
        for (const post of POSTULATE_ORDER) {
          const premises = K.postulate(post, t1, t2, perm, "direct");
          if (premises) {
            push({ t: "triCong", x: t1, y }, post, [...new Set(premises)]);
            break;
          }
        }
      }
    }

  // CPCTC: the corresponding parts of every congruence known
  for (const t of K.triangleCongruences()) {
    for (let a = 0; a < 3; a++)
      for (let b = a + 1; b < 3; b++) {
        const x = triSide(t.x, a, b);
        const y = triSide(t.y, a, b);
        if (segKey(x) !== segKey(y)) push({ t: "segCong", x, y }, "cpctc", [t.key]);
      }
    for (let a = 0; a < 3; a++) {
      const x = triAngle(t.x, a);
      const y = triAngle(t.y, a);
      const kx = r.angKey(x);
      if (kx && kx !== r.angKey(y)) push({ t: "angCong", x, y }, "cpctc", [t.key]);
    }
  }
  return out;
}
