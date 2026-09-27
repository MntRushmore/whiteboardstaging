/**
 * What a proof knows at one row: the givens and the statements above it, indexed the way the rules
 * ask (congruent parts, right angles, parallel lines, midpoints…). Shared by the checker (which
 * allows the closure of stated congruences — `\overline{AB} \cong \overline{CD}` and `\overline{CD}
 * \cong \overline{EF}` supply `\overline{AB} \cong \overline{EF}`) and the planner (which only uses
 * facts stated outright, and adds a Transitive row when it needs one).
 */
import type { Fact, Point, SegRef, TriRef } from "./facts";
import { onLine } from "./figure";
import { segKey, triAngle, type Resolver } from "./resolve";

export type Mode = "direct" | "close";
/** a premise that holds only through the closure (no one fact states it) */
export const CLOSURE = "~";

class UnionFind {
  private parent = new Map<string, string>();
  find(a: string): string {
    let p = this.parent.get(a) ?? a;
    if (p === a) return a;
    p = this.find(p);
    this.parent.set(a, p);
    return p;
  }
  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(rb, ra);
  }
  same(a: string, b: string): boolean {
    return this.find(a) === this.find(b);
  }
}

const pairKey = (a: string, b: string): string => (a < b ? `${a}=${b}` : `${b}=${a}`);

/** The vertex and the two ray points of an angle key `v:PQ`. */
export function angParts(key: string): { v: Point; p: Point; q: Point } {
  return { v: key[0], p: key[2], q: key[3] };
}

export const PERMS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
];
export const IDENTITY = PERMS[0];

export type Postulate = "sss" | "sas" | "asa" | "aas" | "hl";
export const POSTULATE_ORDER: readonly Postulate[] = ["sss", "sas", "asa", "aas", "hl"];

export class Know {
  readonly r: Resolver;
  readonly facts = new Map<string, Fact>();
  /** a known fact names something that cannot be pinned down (`\angle 1` without a figure) */
  unresolved = false;
  private readonly segUF = new UnionFind();
  private readonly angUF = new UnionFind();
  private readonly segDirect = new Map<string, string>();
  private readonly angDirect = new Map<string, string>();
  /** angle key → the fact making it a right angle */
  readonly right = new Map<string, string>();
  readonly measures: Array<{ ang: string; deg: number; key: string }> = [];
  readonly lengths: Array<{ seg: string; len: number; key: string }> = [];
  readonly tris: Array<{ x: TriRef; y: TriRef; key: string }> = [];
  readonly parallels: Array<{ a: string; b: string; key: string }> = [];
  readonly perps: Array<{ f: Extract<Fact, { t: "perp" }>; key: string }> = [];
  readonly midpoints: Array<{ m: Point; s: SegRef; key: string }> = [];
  readonly angBisects: Array<{ f: Extract<Fact, { t: "angBisect" }>; key: string }> = [];
  readonly segBisects: Array<{ f: Extract<Fact, { t: "segBisect" }>; key: string }> = [];
  /** stated "∠1 and ∠2 are vertical angles" / "…a linear pair" */
  readonly statedPairs: Array<{ t: "vertical" | "linearPair"; a: string; b: string; key: string }> = [];
  /** extra points known to lie on a segment's line: (point, a, b) — a midpoint, a bisector's foot */
  private readonly extraOn: Array<[Point, Point, Point]> = [];

  constructor(r: Resolver) {
    this.r = r;
  }

  /** Adds a fact; returns its key, or null when it names something that cannot be pinned down. */
  add(f: Fact): string | null {
    const key = this.r.factKey(f);
    if (key === null) {
      this.unresolved = true;
      return null;
    }
    if (this.facts.has(key)) return key;
    this.facts.set(key, f);
    switch (f.t) {
      case "segCong": {
        const a = segKey(f.x);
        const b = segKey(f.y);
        this.segDirect.set(pairKey(a, b), key);
        this.segUF.union(a, b);
        break;
      }
      case "angCong": {
        const a = this.r.angKey(f.x)!;
        const b = this.r.angKey(f.y)!;
        this.angDirect.set(pairKey(a, b), key);
        this.angUF.union(a, b);
        break;
      }
      case "angMeasure": {
        const a = this.r.angKey(f.x)!;
        this.measures.push({ ang: a, deg: f.deg, key });
        if (f.deg === 90) this.right.set(a, key);
        break;
      }
      case "segLength":
        this.lengths.push({ seg: segKey(f.x), len: f.len, key });
        break;
      case "triCong":
        this.tris.push({ x: f.x, y: f.y, key });
        break;
      case "parallel":
        this.parallels.push({ a: this.r.lineKey(f.x), b: this.r.lineKey(f.y), key });
        break;
      case "perp":
        this.perps.push({ f, key });
        break;
      case "midpoint":
        this.midpoints.push({ m: f.m, s: f.s, key });
        this.extraOn.push([f.m, f.s.a, f.s.b]);
        break;
      case "angBisect":
        this.angBisects.push({ f, key });
        break;
      case "segBisect":
        this.segBisects.push({ f, key });
        if (f.at) {
          this.extraOn.push([f.at, f.s.a, f.s.b]);
          if (f.by.k === "line") this.extraOn.push([f.at, f.by.a, f.by.b]);
        }
        break;
      case "vertical":
      case "linearPair":
        this.statedPairs.push({ t: f.t, a: this.r.angKey(f.x)!, b: this.r.angKey(f.y)!, key });
        break;
      case "rightTri":
        break;
      default:
        break;
    }
    return key;
  }

  has(key: string | null): boolean {
    return key !== null && this.facts.has(key);
  }

  /** Two segments (keys) congruent: the fact stating it (`direct`), or `CLOSURE` through the closure. */
  segCong(a: string, b: string, mode: Mode): string | null {
    const direct = this.segDirect.get(pairKey(a, b)) ?? null;
    if (direct || mode === "direct" || a === b) return direct;
    if (this.segUF.same(a, b)) return CLOSURE;
    // equal lengths written as numbers
    const la = this.lengths.filter((l) => this.segUF.same(l.seg, a));
    const lb = this.lengths.filter((l) => this.segUF.same(l.seg, b));
    return la.some((x) => lb.some((y) => x.len === y.len)) ? CLOSURE : null;
  }

  angCong(a: string, b: string, mode: Mode): string | null {
    const direct = this.angDirect.get(pairKey(a, b)) ?? null;
    if (direct || mode === "direct" || a === b) return direct;
    if (this.angUF.same(a, b)) return CLOSURE;
    const ma = this.measures.filter((m) => this.angUF.same(m.ang, a));
    const mb = this.measures.filter((m) => this.angUF.same(m.ang, b));
    return ma.some((x) => mb.some((y) => x.deg === y.deg && x.deg !== 90)) ? CLOSURE : null;
  }

  /** A measure known for an angle (through its congruence class in `close` mode). */
  measureOf(a: string, mode: Mode): number | null {
    const m = this.measures.find((x) => x.ang === a || (mode === "close" && this.angUF.same(x.ang, a)));
    return m ? m.deg : null;
  }

  /** Is `p` on the line through `a` and `b` (the figure, a midpoint, a bisector's foot)? */
  onLine(p: Point, a: Point, b: Point): boolean {
    if (onLine(this.r.figure, p, a, b)) return true;
    return this.extraOn.some(([q, x, y]) => q === p && ((x === a && y === b) || (x === b && y === a)));
  }

  /**
   * The perpendicular fact that makes angle `key` a right angle: its vertex on both lines and one
   * ray along each. Null when no ⊥ fact places it.
   */
  perpRight(key: string): string | null {
    const { v, p, q } = angParts(key);
    for (const { f, key: fk } of this.perps) {
      if (f.x.k !== "line" || f.y.k !== "line") continue;
      const [l1, l2] = [f.x, f.y];
      const on = (pt: Point, l: { a: Point; b: Point }) => this.onLine(pt, l.a, l.b);
      if (!on(v, l1) || !on(v, l2)) continue;
      if ((on(p, l1) && on(q, l2)) || (on(p, l2) && on(q, l1))) return fk;
    }
    return null;
  }

  /**
   * The fact making angle `key` a right angle (`m\angle ADB = 90^{\circ}`, "∠ADB is a right angle").
   * A ⊥ alone does not: the row that says which angles it makes right (Def. of ⊥) must be there,
   * as a teacher asks — the prior statements supply the parts.
   */
  rightAt(key: string | null): string | null {
    if (key === null) return null;
    return this.right.get(key) ?? null;
  }

  /**
   * The parts of T1 and T2 under a correspondence (T1[i] ↔ T2[perm[i]]) that satisfy a congruence
   * postulate: their premises (`direct`: the facts; `close`: may be `CLOSURE`), or null.
   */
  postulate(post: Postulate | "ssa" | "aaa", t1: TriRef, t2: TriRef, perm: readonly number[], mode: Mode): string[] | null {
    const t2p: TriRef = [t2[perm[0]], t2[perm[1]], t2[perm[2]]];
    const side = (i: number, j: number) => this.segCong(segKey([t1[i], t1[j]]), segKey([t2p[i], t2p[j]]), mode);
    const angle = (i: number) => {
      const a = this.r.angKey(triAngle(t1, i));
      const b = this.r.angKey(triAngle(t2p, i));
      return a && b ? this.angCong(a, b, mode) : null;
    };
    const right = (i: number) => {
      const a = this.rightAt(this.r.angKey(triAngle(t1, i)));
      const b = this.rightAt(this.r.angKey(triAngle(t2p, i)));
      return a && b ? [a, b] : null;
    };
    const all = (...xs: Array<string | null>): string[] | null => (xs.every((x): x is string => x !== null) ? xs : null);
    const V = [0, 1, 2];
    const others = (i: number) => V.filter((k) => k !== i);
    switch (post) {
      case "sss":
        return all(side(0, 1), side(1, 2), side(0, 2));
      case "sas":
        for (const i of V) {
          const [j, k] = others(i);
          const got = all(angle(i), side(i, j), side(i, k));
          if (got) return got;
        }
        return null;
      case "asa":
        for (const i of V)
          for (const j of V) {
            if (j <= i) continue;
            const got = all(angle(i), angle(j), side(i, j));
            if (got) return got;
          }
        return null;
      case "aas":
        for (const i of V)
          for (const j of V) {
            if (j <= i) continue;
            const k = 3 - i - j;
            const got = all(angle(i), angle(j), side(i, k)) ?? all(angle(i), angle(j), side(j, k));
            if (got) return got;
          }
        return null;
      case "hl":
        for (const k of V) {
          const r = right(k);
          if (!r) continue;
          const [i, j] = others(k);
          const got = all(side(i, j), side(k, i)) ?? all(side(i, j), side(k, j));
          if (got) return [...r, ...got];
        }
        return null;
      case "ssa":
        for (const i of V) {
          const [j, k] = others(i);
          const got = all(angle(i), side(j, k), side(i, j)) ?? all(angle(i), side(j, k), side(i, k));
          if (got) return got;
        }
        return null;
      case "aaa":
        return all(angle(0), angle(1), angle(2));
    }
  }

  /** The triangle congruences known, as { x, y } with x[i] ↔ y[i]. */
  triangleCongruences(): ReadonlyArray<{ x: TriRef; y: TriRef; key: string }> {
    return this.tris;
  }
}
