/**
 * Canonical keys for the things a proof names, so two ways of writing one fact compare equal:
 * `\overline{CD} \cong \overline{AB}` is `\overline{AB} \cong \overline{DC}`; `\triangle BCA \cong
 * \triangle EFD` is `\triangle ABC \cong \triangle DEF`; and, with a figure, `\angle BAD` is
 * `\angle BAC` when D is on AC, and `\angle 1` is the angle its mark names.
 *
 * A key is null when the name cannot be pinned down (`\angle 1` with no figure read, `\angle B` where
 * B is a vertex of several angles): the checker never rings a row on the strength of such a name.
 */
import { ang, pointsOf, type AngRef, type Fact, type LineRef, type Point, type SegRef, type TriRef } from "./facts";
import { lineThrough, raysAt, rayRep, type FigureModel } from "./figure";

export const segKey = (s: SegRef | readonly [Point, Point]): string => {
  const [a, b] = "k" in s ? [s.a, s.b] : s;
  return a < b ? `${a}${b}` : `${b}${a}`;
};

export class Resolver {
  readonly figure: FigureModel | null;
  /** triangles of interest: the figure's, and every triangle the problem names */
  readonly triangles: TriRef[];

  constructor(figure: FigureModel | null, facts: readonly Fact[]) {
    this.figure = figure;
    const seen = new Set<string>();
    const tris: TriRef[] = [];
    const add = (t: TriRef) => {
      const k = [...t].sort().join("");
      if (new Set(t).size !== 3 || seen.has(k)) return;
      seen.add(k);
      tris.push(t);
    };
    for (const f of facts) {
      if (f.t === "triCong" || f.t === "triSim") {
        add(f.x);
        add(f.y);
      } else if (f.t === "isosceles" || f.t === "rightTri") add(f.tri);
    }
    for (const t of figure?.triangles ?? []) add(t);
    this.triangles = tris;
  }

  private readonly angMemo = new Map<string, string | null>();

  /** `v:PQ`: the vertex and its two rays (canonical points), or null. Memoised: the planner asks often. */
  angKey(a: AngRef): string | null {
    const id = a.k === "ang" ? `${a.a}${a.v}${a.c}` : a.k === "angv" ? a.v : `#${a.n}`;
    const hit = this.angMemo.get(id);
    if (hit !== undefined) return hit;
    const key = this.computeAngKey(a);
    this.angMemo.set(id, key);
    return key;
  }

  private computeAngKey(a: AngRef): string | null {
    const three = this.expand(a);
    if (!three || three.k !== "ang") return null;
    const r1 = rayRep(this.figure, three.v, three.a);
    const r2 = rayRep(this.figure, three.v, three.c);
    if (r1 === r2) return null;
    return `${three.v}:${r1 < r2 ? r1 + r2 : r2 + r1}`;
  }

  /** A named angle as three points (`\angle 1` through the figure's marks, `\angle B` when unique), or null. */
  expand(a: AngRef): AngRef | null {
    if (a.k === "ang") return a;
    if (a.k === "angn") return this.figure?.numbered.get(a.n) ?? null;
    // `\angle B`: the one angle at B — two rays in the figure, or one angle among the triangles
    const fig = this.figure;
    if (fig && fig.points.has(a.v)) {
      const rays = [...new Set(raysAt(fig, a.v).map((p) => rayRep(fig, a.v, p)))];
      if (rays.length === 2) return ang(rays[0], a.v, rays[1]);
      if (rays.length > 2) return null;
    }
    const keys = new Map<string, AngRef>();
    for (const t of this.triangles) {
      const i = t.indexOf(a.v);
      if (i < 0) continue;
      const three = triAngle(t, i);
      const k = this.plainAngKey(three);
      if (k) keys.set(k, three);
    }
    return keys.size === 1 ? [...keys.values()][0] : null;
  }

  private plainAngKey(a: AngRef): string | null {
    if (a.k !== "ang") return null;
    const r1 = rayRep(this.figure, a.v, a.a);
    const r2 = rayRep(this.figure, a.v, a.c);
    return r1 === r2 ? null : `${a.v}:${r1 < r2 ? r1 + r2 : r2 + r1}`;
  }

  /** The angle of triangle `t` at its vertex `i`, keyed. */
  triAngleKey(t: TriRef, i: number): string | null {
    return this.angKey(triAngle(t, i));
  }

  /** A line's key: the drawn line it lies on, else its two points. */
  lineKey(l: LineRef): string {
    if (l.k === "lname") return `n:${l.n}`;
    const fig = this.figure;
    if (fig) {
      const i = lineThrough(fig, l.a, l.b);
      if (i >= 0) return `L${i}`;
    }
    return `s:${segKey([l.a, l.b])}`;
  }

  /** The canonical key of a fact, or null when a name in it cannot be pinned down. */
  factKey(f: Fact): string | null {
    const pair = (p: string | null, q: string | null) => (p === null || q === null ? null : p < q ? `${p}|${q}` : `${q}|${p}`);
    switch (f.t) {
      case "segCong":
        return `S|${pair(segKey(f.x), segKey(f.y))}`;
      case "angCong": {
        const k = pair(this.angKey(f.x), this.angKey(f.y));
        return k && `A|${k}`;
      }
      case "triCong":
      case "triSim": {
        const fwd = f.x.map((p, i) => `${p}${f.y[i]}`).sort().join(",");
        const back = f.y.map((p, i) => `${p}${f.x[i]}`).sort().join(",");
        return `${f.t === "triCong" ? "T" : "~"}|${fwd < back ? fwd : back}`;
      }
      case "parallel":
        return `P|${pair(this.lineKey(f.x), this.lineKey(f.y))}`;
      case "perp":
        return `L|${pair(this.lineKey(f.x), this.lineKey(f.y))}`;
      case "midpoint":
        return `M|${f.m}|${segKey(f.s)}`;
      case "angBisect": {
        const k = this.angKey(f.ang);
        return k && `B|${k}|${rayRep(this.figure, f.ray[0], f.ray[1])}`;
      }
      case "segBisect":
        return `b|${this.lineKey(f.by)}|${segKey(f.s)}`;
      case "angMeasure": {
        const k = this.angKey(f.x);
        return k && `D|${k}|${f.deg}`;
      }
      case "segLength":
        return `N|${segKey(f.x)}|${f.len}`;
      case "supp": {
        const k = pair(this.angKey(f.x), this.angKey(f.y));
        return k && `U|${k}`;
      }
      case "vertical": {
        const k = pair(this.angKey(f.x), this.angKey(f.y));
        return k && `V|${k}`;
      }
      case "linearPair": {
        const k = pair(this.angKey(f.x), this.angKey(f.y));
        return k && `Y|${k}`;
      }
      case "isosceles":
        return `I|${[...f.tri].sort().join("")}`;
      case "rightTri":
        return `R|${[...f.tri].sort().join("")}`;
    }
  }

  /** Every point the problem uses (for the figure-less fallbacks). */
  static pointsOfAll(facts: readonly Fact[]): Set<Point> {
    return new Set(facts.flatMap(pointsOf));
  }
}

/** The angle of triangle `t` at vertex `i`, as three points (vertex in the middle). */
export function triAngle(t: TriRef, i: number): AngRef {
  return ang(t[(i + 1) % 3], t[i], t[(i + 2) % 3]);
}

/** The side of triangle `t` between vertices `i` and `j`. */
export function triSide(t: TriRef, i: number, j: number): SegRef {
  return { k: "seg", a: t[i], b: t[j] };
}
