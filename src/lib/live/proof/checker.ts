/**
 * The proof checker: every row of a two-column proof judged from the givens and the rows above it,
 * deterministically. A row is
 *
 *  - `ok` (a tick) when its reason proves its statement from what is known;
 *  - `wrong` (a ring) only when that is PROVABLY so: a Given that is not given, a postulate the
 *    parts do not supply (SSA, the wrong postulate, a part missing), the wrong correspondence,
 *    CPCTC before any triangles are congruent or on parts that do not correspond, a Reflexive that
 *    is not the same part, a statement that does not follow;
 *  - `unknown` (nothing) otherwise — a row still being written, a statement or reason not read, a
 *    name that cannot be pinned down (`\angle 1` with no figure read), a figure fact the figure
 *    has not confirmed. A ring that rests on something missing is only drawn when nothing above it
 *    is unread or unknown.
 *
 * Pure. `docs/eval/proofs.md` is its scoreboard.
 */
import type { Fact, Statement, TriRef } from "./facts";
import type { FigureModel } from "./figure";
import { Know, CLOSURE, IDENTITY, PERMS, POSTULATE_ORDER, angParts, type Postulate } from "./know";
import { Resolver, segKey, triAngle } from "./resolve";
import type { ReasonId } from "./vocab";

export type Verdict = "ok" | "wrong" | "unknown";
export type Why =
  | "ok"
  | "pending"
  | "unparsed"
  | "unresolved"
  | "not-given"
  | "no-given-line"
  | "wrong-reason"
  | "wrong-postulate"
  | "ssa"
  | "aaa"
  | "wrong-correspondence"
  | "cpctc-too-early"
  | "cpctc-not-corresponding"
  | "missing-prerequisite"
  | "not-reflexive"
  | "does-not-follow"
  | "needs-figure"
  | "not-checked";

export interface RowVerdict {
  verdict: Verdict;
  why: Why;
  /** which half of the row is wrong (where the ring goes) */
  part: "statement" | "reason";
}

export interface ProofRow {
  statement: Statement | null;
  reason: ReasonId | null;
}

export interface ProofProblem {
  /** the Given line, or null when the board has none */
  givens: Statement | null;
  prove: Statement | null;
  rows: ProofRow[];
}

const OK: RowVerdict = { verdict: "ok", why: "ok", part: "reason" };
const unknown = (why: Why): RowVerdict => ({ verdict: "unknown", why, part: "reason" });
const wrong = (why: Why, part: RowVerdict["part"]): RowVerdict => ({ verdict: "wrong", why, part });

/** Every fact of the problem (the resolver's triangles of interest come from these). */
export function problemFacts(p: ProofProblem): Fact[] {
  return [...(p.givens?.facts ?? []), ...(p.prove?.facts ?? []), ...p.rows.flatMap((r) => r.statement?.facts ?? [])];
}

/** What is known before row `i`, and whether it is all read and pinned down. */
export function knowledgeBefore(p: ProofProblem, i: number, r: Resolver): { know: Know; complete: boolean } {
  const know = new Know(r);
  for (const f of p.givens?.facts ?? []) know.add(f);
  let complete = !p.givens || p.givens.complete;
  for (let k = 0; k < i; k++) {
    const st = p.rows[k].statement;
    if (!st || !st.complete) complete = false;
    for (const f of st?.facts ?? []) know.add(f);
  }
  return { know, complete };
}

/** Checks every row. */
export function checkProof(p: ProofProblem, figure: FigureModel | null = null): RowVerdict[] {
  const r = new Resolver(figure, problemFacts(p));
  return p.rows.map((_, i) => checkRow(p, i, r));
}

/** Checks row `i` against the givens and the rows above it. */
export function checkRow(p: ProofProblem, i: number, r: Resolver): RowVerdict {
  const row = p.rows[i];
  if (!row.statement || !row.reason) return unknown("pending");
  if (!row.statement.complete || row.statement.facts.length === 0) return unknown("unparsed");
  const facts = row.statement.facts;
  const keys = facts.map((f) => r.factKey(f));
  const { know, complete } = knowledgeBefore(p, i, r);
  // a ring that rests on something being ABSENT needs everything above read and pinned down
  const clean = complete && !know.unresolved && keys.every((k) => k !== null);
  const absent = (why: Why, part: RowVerdict["part"]): RowVerdict => (clean ? wrong(why, part) : unknown("unresolved"));
  if (keys.some((k) => k === null)) return unknown("unresolved");
  const reason = row.reason;

  switch (reason) {
    case "given": {
      if (!p.givens) return unknown("no-given-line");
      const given = new Set(p.givens.facts.map((f) => r.factKey(f)));
      if (keys.every((k) => given.has(k))) return OK;
      return p.givens.complete && keys.every((k) => k !== null) ? wrong("not-given", "reason") : unknown("unresolved");
    }
    case "reflexive":
      return every(facts, (f) => {
        if (f.t === "segCong") return segKey(f.x) === segKey(f.y) ? OK : wrong("not-reflexive", "statement");
        if (f.t === "angCong") return r.angKey(f.x) === r.angKey(f.y) ? OK : wrong("not-reflexive", "statement");
        if (f.t === "triCong") return f.x.join("") === f.y.join("") ? OK : wrong("not-reflexive", "statement");
        return wrong("wrong-reason", "reason");
      });
    case "symmetric":
    case "congruence":
    case "rightAngle":
      // a statement written again another way: `AB = CD` from `\overline{AB} \cong \overline{CD}`
      return keys.every((k) => know.has(k)) ? OK : absent("does-not-follow", "statement");
    case "transitive":
    case "substitution":
      return every(facts, (f) => transitive(f, know, r, absent));
    case "sss":
    case "sas":
    case "asa":
    case "aas":
    case "hl":
      if (facts.length !== 1 || facts[0].t !== "triCong") return wrong("wrong-reason", "reason");
      return postulate(reason, facts[0].x, facts[0].y, know, clean);
    case "ssa":
    case "aaa":
      return facts.every((f) => f.t === "triCong") ? wrong(reason, "reason") : wrong("wrong-reason", "reason");
    case "cpctc":
      return cpctc(facts, know, r, clean);
    case "midpoint":
      return every(facts, (f) => midpoint(f, know, absent));
    case "angleBisector":
      return every(facts, (f) => angleBisector(f, know, r, absent));
    case "segmentBisector":
      return every(facts, (f) => segmentBisector(f, know, absent));
    case "perpendicular":
      return every(facts, (f) => perpendicular(f, know, r, absent));
    case "rightAngles":
      return every(facts, (f) => rightAngles(f, know, r, absent));
    case "vertical":
    case "linearPair":
      return every(facts, (f) => figurePair(reason, f, know, r));
    case "altInterior":
    case "altExterior":
    case "corresponding":
      return every(facts, (f) => parallelAngles(reason, f, know, r, absent));
    case "altInteriorConverse":
    case "correspondingConverse":
      return every(facts, (f) => parallelConverse(reason === "altInteriorConverse" ? "altInterior" : "corresponding", f, know, r, absent));
    case "isosceles":
      return every(facts, (f) => isosceles(f, know, r, absent));
    case "isoscelesConverse":
      return every(facts, (f) => isoscelesConverse(f, know, r, absent));
    case "thirdAngles":
      return every(facts, (f) => thirdAngles(f, know, r));
    case "segmentAddition":
    case "angleAddition":
      return unknown("not-checked");
  }
}

/** All facts must pass: the first wrong one decides, else the first unknown, else ok. */
function every(facts: readonly Fact[], check: (f: Fact) => RowVerdict): RowVerdict {
  const verdicts = facts.map(check);
  return verdicts.find((v) => v.verdict === "wrong") ?? verdicts.find((v) => v.verdict === "unknown") ?? OK;
}

type Absent = (why: Why, part: RowVerdict["part"]) => RowVerdict;

function transitive(f: Fact, know: Know, r: Resolver, absent: Absent): RowVerdict {
  if (f.t === "segCong") return know.segCong(segKey(f.x), segKey(f.y), "close") ? OK : absent("does-not-follow", "statement");
  if (f.t === "angCong") {
    const a = r.angKey(f.x)!;
    const b = r.angKey(f.y)!;
    return know.angCong(a, b, "close") ? OK : absent("does-not-follow", "statement");
  }
  if (f.t === "angMeasure") return know.measureOf(r.angKey(f.x)!, "close") === f.deg ? OK : absent("does-not-follow", "statement");
  if (f.t === "triCong" || f.t === "parallel") return know.has(r.factKey(f)) ? OK : unknown("not-checked");
  return unknown("not-checked");
}

/** SSS / SAS / ASA / AAS / HL for `x ≅ y` in the written correspondence. */
function postulate(claim: Postulate, x: TriRef, y: TriRef, know: Know, clean: boolean): RowVerdict {
  if (new Set(x).size !== 3 || new Set(y).size !== 3) return unknown("unparsed");
  if (know.postulate(claim, x, y, IDENTITY, "close")) return OK;
  if (!clean) return unknown("unresolved");
  const holds = (post: Postulate, perm: readonly number[]) => know.postulate(post, x, y, perm, "close") !== null;
  // the parts are there, in another vertex order: the statement's correspondence is wrong
  if (PERMS.slice(1).some((perm) => POSTULATE_ORDER.some((post) => holds(post, perm)))) return wrong("wrong-correspondence", "statement");
  if (POSTULATE_ORDER.some((post) => post !== claim && holds(post, IDENTITY))) return wrong("wrong-postulate", "reason");
  if (know.postulate("ssa", x, y, IDENTITY, "close")) return wrong("ssa", "reason");
  return wrong("missing-prerequisite", "reason");
}

/** The parts a congruence `x ≅ y` makes correspond: side and angle key pairs. */
function correspondingParts(x: TriRef, y: TriRef, r: Resolver): { sides: Array<[string, string]>; angles: Array<[string, string]> } {
  const sides: Array<[string, string]> = [];
  const angles: Array<[string, string]> = [];
  for (let i = 0; i < 3; i++) {
    for (let j = i + 1; j < 3; j++) sides.push([segKey([x[i], x[j]]), segKey([y[i], y[j]])]);
    const a = r.angKey(triAngle(x, i));
    const b = r.angKey(triAngle(y, i));
    if (a && b) angles.push([a, b]);
  }
  return { sides, angles };
}

const samePair = (p: readonly [string, string], a: string, b: string) => (p[0] === a && p[1] === b) || (p[0] === b && p[1] === a);

function cpctc(facts: readonly Fact[], know: Know, r: Resolver, clean: boolean): RowVerdict {
  const tris = know.triangleCongruences();
  if (tris.length === 0) return clean ? wrong("cpctc-too-early", "reason") : unknown("unresolved");
  return every(facts, (f) => {
    if (f.t !== "segCong" && f.t !== "angCong") return wrong("wrong-reason", "reason");
    const [a, b] = f.t === "segCong" ? [segKey(f.x), segKey(f.y)] : [r.angKey(f.x)!, r.angKey(f.y)!];
    for (const t of tris) {
      const parts = correspondingParts(t.x, t.y, r);
      const list = f.t === "segCong" ? parts.sides : parts.angles;
      if (list.some((p) => samePair(p, a, b))) return OK;
    }
    return clean ? wrong("cpctc-not-corresponding", "statement") : unknown("unresolved");
  });
}

function midpoint(f: Fact, know: Know, absent: Absent): RowVerdict {
  if (f.t === "segCong") {
    const a = segKey(f.x);
    const b = segKey(f.y);
    for (const m of know.midpoints) {
      const halves = [segKey([m.s.a, m.m]), segKey([m.m, m.s.b])];
      if (samePair([halves[0], halves[1]], a, b)) return OK;
    }
    return know.midpoints.length > 0 ? absent("does-not-follow", "statement") : absent("missing-prerequisite", "reason");
  }
  if (f.t === "midpoint") {
    // the converse: equal halves make M the midpoint
    return know.segCong(segKey([f.s.a, f.m]), segKey([f.m, f.s.b]), "close") ? OK : absent("missing-prerequisite", "reason");
  }
  if (f.t === "segLength") return unknown("not-checked");
  return wrong("wrong-reason", "reason");
}

function angleBisector(f: Fact, know: Know, r: Resolver, absent: Absent): RowVerdict {
  if (f.t === "angCong") {
    const a = r.angKey(f.x)!;
    const b = r.angKey(f.y)!;
    for (const { f: bis } of know.angBisects) {
      const whole = r.expand(bis.ang);
      if (!whole || whole.k !== "ang") return unknown("unresolved");
      const [v, d] = bis.ray;
      const h1 = r.angKey({ k: "ang", a: whole.a, v, c: d });
      const h2 = r.angKey({ k: "ang", a: d, v, c: whole.c });
      if (h1 && h2 && samePair([h1, h2], a, b)) return OK;
    }
    return know.angBisects.length > 0 ? absent("does-not-follow", "statement") : absent("missing-prerequisite", "reason");
  }
  if (f.t === "angBisect") {
    const whole = r.expand(f.ang);
    if (!whole || whole.k !== "ang") return unknown("unresolved");
    const h1 = r.angKey({ k: "ang", a: whole.a, v: f.ray[0], c: f.ray[1] });
    const h2 = r.angKey({ k: "ang", a: f.ray[1], v: f.ray[0], c: whole.c });
    return h1 && h2 && know.angCong(h1, h2, "close") ? OK : absent("missing-prerequisite", "reason");
  }
  return wrong("wrong-reason", "reason");
}

function segmentBisector(f: Fact, know: Know, absent: Absent): RowVerdict {
  if (f.t !== "segCong") return f.t === "segBisect" ? unknown("not-checked") : wrong("wrong-reason", "reason");
  if (know.segBisects.length === 0) return absent("missing-prerequisite", "reason");
  const a = segKey(f.x);
  const b = segKey(f.y);
  for (const { f: bis } of know.segBisects) {
    const { a: p, b: q } = bis.s;
    // the halves share the foot M: pM and Mq
    const pts = [f.x.a, f.x.b, f.y.a, f.y.b];
    const m = pts.find((pt) => pt !== p && pt !== q && pts.filter((x) => x === pt).length === 2);
    if (bis.at && m && m !== bis.at) continue;
    if (m && samePair([segKey([p, m]), segKey([m, q])], a, b)) return OK;
  }
  return absent("does-not-follow", "statement");
}

function perpendicular(f: Fact, know: Know, r: Resolver, absent: Absent): RowVerdict {
  if (know.perps.length === 0) return absent("missing-prerequisite", "reason");
  const rightByPerp = (a: string) => know.perpRight(a) !== null;
  if (f.t === "angMeasure" && f.deg === 90) return rightByPerp(r.angKey(f.x)!) ? OK : unknown("needs-figure");
  // `⊥ lines form congruent adjacent angles`
  if (f.t === "angCong") return rightByPerp(r.angKey(f.x)!) && rightByPerp(r.angKey(f.y)!) ? OK : unknown("needs-figure");
  if (f.t === "rightTri") return unknown("not-checked");
  return wrong("wrong-reason", "reason");
}

function rightAngles(f: Fact, know: Know, r: Resolver, absent: Absent): RowVerdict {
  if (f.t !== "angCong") return wrong("wrong-reason", "reason");
  const a = r.angKey(f.x)!;
  const b = r.angKey(f.y)!;
  if (know.rightAt(a) && know.rightAt(b)) return OK;
  // no row above makes both of them right angles: a missing step (a ⊥ needs its Def. of ⊥ row)
  return absent("missing-prerequisite", "reason");
}

/** Vertical angles / a linear pair: the figure says so, or a row above did. */
function figurePair(reason: "vertical" | "linearPair", f: Fact, know: Know, r: Resolver): RowVerdict {
  const want = reason === "vertical" ? ["angCong", "vertical"] : ["supp", "linearPair"];
  if (!want.includes(f.t) || (f.t !== "angCong" && f.t !== "supp" && f.t !== "vertical" && f.t !== "linearPair")) return wrong("wrong-reason", "reason");
  const a = r.angKey(f.x)!;
  const b = r.angKey(f.y)!;
  // vertical angles and a linear pair share their vertex: two vertices is provably not one
  if (angParts(a).v !== angParts(b).v) return wrong("does-not-follow", "statement");
  if (know.statedPairs.some((p) => p.t === reason && samePair([p.a, p.b], a, b))) return OK;
  const fig = r.figure;
  if (!fig) return unknown("needs-figure");
  const list = reason === "vertical" ? fig.vertical : fig.linearPairs;
  return list.some(([x, y]) => {
    const kx = r.angKey(x);
    const ky = r.angKey(y);
    return kx !== null && ky !== null && samePair([kx, ky], a, b);
  })
    ? OK
    : unknown("needs-figure");
}

/** The figure's pairs of this kind that are these two angles. */
function figurePairs(kind: "altInterior" | "altExterior" | "corresponding", a: string, b: string, r: Resolver) {
  return (r.figure?.pairs ?? []).filter((p) => {
    if (p.kind !== kind) return false;
    const kx = r.angKey(p.x);
    const ky = r.angKey(p.y);
    return kx !== null && ky !== null && samePair([kx, ky], a, b);
  });
}

function parallelAngles(kind: "altInterior" | "altExterior" | "corresponding", f: Fact, know: Know, r: Resolver, absent: Absent): RowVerdict {
  if (f.t !== "angCong") return wrong("wrong-reason", "reason");
  // the theorem needs parallel lines: with none known at all, it cannot be used yet
  if (know.parallels.length === 0) return absent("missing-prerequisite", "reason");
  const a = r.angKey(f.x)!;
  const b = r.angKey(f.y)!;
  const found = figurePairs(kind, a, b, r);
  if (found.length === 0) return unknown("needs-figure");
  const parallel = found.some((p) => know.parallels.some((q) => samePair([q.a, q.b], `L${p.lines[0]}`, `L${p.lines[1]}`)));
  return parallel ? OK : absent("missing-prerequisite", "reason");
}

function parallelConverse(kind: "altInterior" | "corresponding", f: Fact, know: Know, r: Resolver, absent: Absent): RowVerdict {
  if (f.t !== "parallel") return wrong("wrong-reason", "reason");
  const fig = r.figure;
  if (!fig) return unknown("needs-figure");
  const l1 = r.lineKey(f.x);
  const l2 = r.lineKey(f.y);
  const pairs = fig.pairs.filter((p) => p.kind === kind && samePair([`L${p.lines[0]}`, `L${p.lines[1]}`], l1, l2));
  if (pairs.length === 0) return unknown("needs-figure");
  const congruent = pairs.some((p) => {
    const kx = r.angKey(p.x);
    const ky = r.angKey(p.y);
    return kx !== null && ky !== null && know.angCong(kx, ky, "close") !== null;
  });
  return congruent ? OK : absent("missing-prerequisite", "reason");
}

/** The triangles of interest with these two angles at two of their vertices: [triangle, i, j]. */
function trianglesWithAngles(a: string, b: string, r: Resolver): Array<[TriRef, number, number]> {
  const out: Array<[TriRef, number, number]> = [];
  for (const t of r.triangles) {
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) {
        if (i === j) continue;
        if (r.angKey(triAngle(t, i)) === a && r.angKey(triAngle(t, j)) === b) out.push([t, i, j]);
      }
  }
  return out;
}

function isosceles(f: Fact, know: Know, r: Resolver, absent: Absent): RowVerdict {
  if (f.t !== "angCong") return wrong("wrong-reason", "reason");
  const found = trianglesWithAngles(r.angKey(f.x)!, r.angKey(f.y)!, r);
  if (found.length === 0) return unknown("not-checked");
  for (const [t, i, j] of found) {
    const k = 3 - i - j;
    // the sides opposite the two angles
    if (know.segCong(segKey([t[k], t[j]]), segKey([t[k], t[i]]), "close")) return OK;
  }
  return absent("missing-prerequisite", "reason");
}

function isoscelesConverse(f: Fact, know: Know, r: Resolver, absent: Absent): RowVerdict {
  if (f.t !== "segCong") return wrong("wrong-reason", "reason");
  const pts = [f.x.a, f.x.b, f.y.a, f.y.b];
  const apex = pts.find((p) => pts.filter((q) => q === p).length === 2);
  if (!apex) return unknown("not-checked");
  const [u] = [f.x.a, f.x.b].filter((p) => p !== apex);
  const [w] = [f.y.a, f.y.b].filter((p) => p !== apex);
  if (!u || !w) return unknown("not-checked");
  const t: TriRef = [apex, u, w];
  const au = r.angKey(triAngle(t, 1));
  const aw = r.angKey(triAngle(t, 2));
  if (!au || !aw) return unknown("unresolved");
  return know.angCong(au, aw, "close") ? OK : absent("missing-prerequisite", "reason");
}

function thirdAngles(f: Fact, know: Know, r: Resolver): RowVerdict {
  if (f.t !== "angCong") return wrong("wrong-reason", "reason");
  const a = r.angKey(f.x)!;
  const b = r.angKey(f.y)!;
  for (const t1 of r.triangles)
    for (const t2 of r.triangles) {
      if (t1 === t2) continue;
      for (let i = 0; i < 3; i++) {
        if (r.angKey(triAngle(t1, i)) !== a) continue;
        for (let j = 0; j < 3; j++) {
          if (r.angKey(triAngle(t2, j)) !== b) continue;
          const o1 = [0, 1, 2].filter((k) => k !== i);
          const o2 = [0, 1, 2].filter((k) => k !== j);
          for (const [p, q] of [
            [o2[0], o2[1]],
            [o2[1], o2[0]],
          ]) {
            const c1 = know.angCong(r.angKey(triAngle(t1, o1[0])) ?? "?", r.angKey(triAngle(t2, p)) ?? "!", "close");
            const c2 = know.angCong(r.angKey(triAngle(t1, o1[1])) ?? "?", r.angKey(triAngle(t2, q)) ?? "!", "close");
            if (c1 && c2) return OK;
          }
        }
      }
    }
  return unknown("not-checked");
}

export { CLOSURE };
