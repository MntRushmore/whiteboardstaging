import { describe, expect, it } from "vitest";
import type { Rect } from "../../contracts";
import { mulberry32 } from "@/lib/hand";
import { FIGURE, checkFigure, layoutFigure, planFigure, type FigureLayout, type FigurePart, type FigureSpec } from "..";
import { FIGURE_GALLERY, GALLERY_BOX } from "./gallery";

type Pt = { x: number; y: number };
const BOX = { w: 400, h: 300 };

const layout = (spec: FigureSpec, box = BOX, seed = 7): FigureLayout => {
  const L = layoutFigure(spec, { seed, box });
  expect(L).not.toBeNull();
  return L!;
};
const parts = (L: FigureLayout, kind: FigurePart["kind"], owner?: string) => L.parts.filter((p) => p.kind === kind && (owner === undefined || p.owner === owner));
const pointsOf = (ps: readonly FigurePart[]): Pt[] => ps.flatMap((p) => p.strokes.flatMap((s) => s.points));
const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);
const centre = (r: Rect): Pt => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
/** distance from p to the infinite line through a, b, signed by side */
const side = (p: Pt, a: Pt, b: Pt) => ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / dist(a, b);
const inside = (p: Pt, r: Rect) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
/** direction of p from v, in degrees, y down */
const dirDeg = (v: Pt, p: Pt) => (Math.atan2(p.y - v.y, p.x - v.x) * 180) / Math.PI;
/** is the direction d (deg) inside the smaller angle between directions a and b, with slack? */
function inAngle(d: number, a: number, b: number, slack = 0): boolean {
  const n = (x: number) => ((x % 360) + 360) % 360;
  let lo = a;
  let sweep = n(b - a);
  if (sweep > 180) {
    lo = b;
    sweep = 360 - sweep;
  }
  return n(d - lo + slack) <= sweep + 2 * slack;
}
function pointInPolygon(p: Pt, poly: readonly Pt[]): boolean {
  let inPoly = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inPoly = !inPoly;
  }
  return inPoly;
}

const rightTriangle: FigureSpec = FIGURE_GALLERY[0].spec;

/** More figures for the label tests, beyond the gallery's. */
const EXTRA: ReadonlyArray<{ title: string; spec: FigureSpec }> = [
  {
    title: "triangle with an altitude",
    spec: {
      points: { A: { x: 0, y: 0 }, B: { x: 6, y: 0 }, C: { x: 2, y: 4 }, H: { x: 2, y: 0 } },
      polygons: [{ vertices: ["A", "B", "C"] }],
      segments: [
        { from: "C", to: "H", dashed: true, label: "4" },
        { from: "A", to: "B", label: "6" },
      ],
      angles: [{ at: "H", from: "B", to: "C", right: true }],
    },
  },
  {
    title: "kite",
    spec: {
      points: { A: { x: 0, y: 3 }, B: { x: 2, y: 0.5 }, C: { x: 0, y: -4 }, D: { x: -2, y: 0.5 } },
      polygons: [{ vertices: ["A", "B", "C", "D"] }],
      segments: [
        { from: "A", to: "B", ticks: 1 },
        { from: "A", to: "D", ticks: 1 },
        { from: "B", to: "C", ticks: 2 },
        { from: "D", to: "C", ticks: 2 },
        { from: "A", to: "C", dashed: true },
      ],
    },
  },
  {
    title: "a thin triangle (a small angle)",
    spec: {
      points: { A: { x: 0, y: 0 }, B: { x: 8, y: 0 }, C: { x: 8, y: 1.6 } },
      polygons: [{ vertices: ["A", "B", "C"] }],
      segments: [{ from: "A", to: "C", label: "x" }],
      angles: [
        { at: "A", from: "B", to: "C", label: "11^{\\circ}" },
        { at: "B", from: "C", to: "A", right: true },
      ],
    },
  },
  {
    title: "pentagon, every side labelled",
    spec: {
      points: Object.fromEntries(["A", "B", "C", "D", "E"].map((n, i) => [n, { x: 3 * Math.cos((Math.PI / 2) + (i * 2 * Math.PI) / 5), y: 3 * Math.sin((Math.PI / 2) + (i * 2 * Math.PI) / 5) }])),
      polygons: [{ vertices: ["A", "B", "C", "D", "E"] }],
      segments: [
        { from: "A", to: "B", label: "2x" },
        { from: "B", to: "C", label: "x + 3" },
        { from: "C", to: "D", label: "y" },
        { from: "D", to: "E", label: "7" },
        { from: "E", to: "A", label: "2y - 1" },
      ],
    },
  },
];

const ALL = [...FIGURE_GALLERY, ...EXTRA];

describe("planFigure — fitting", () => {
  it("fits true to scale, y up, centred in the box with its labels", () => {
    const L = layout(rightTriangle);
    const { A, B, C } = L.points;
    // y up in figure units is y down in px: A (y = 3) is above B (y = 0)
    expect(A.y).toBeLessThan(B.y);
    expect(A.x).toBeCloseTo(B.x, 6);
    expect(C.y).toBeCloseTo(B.y, 6);
    // one scale both ways
    expect(dist(B, C) / dist(A, B)).toBeCloseTo(4 / 3, 6);
    expect(dist(B, C)).toBeCloseTo(4 * L.scale, 6);
    // every stroke, labels included, in the box, and the ink centred in it
    const b = L.bounds;
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.x + b.w).toBeLessThanOrEqual(BOX.w + 1e-6);
    expect(b.y + b.h).toBeLessThanOrEqual(BOX.h + 1e-6);
    expect(b.x + b.w / 2).toBeCloseTo(BOX.w / 2, 6);
    expect(b.y + b.h / 2).toBeCloseTo(BOX.h / 2, 6);
    for (const p of pointsOf(L.parts)) expect(inside(p, { x: -1e-6, y: -1e-6, w: BOX.w + 2e-6, h: BOX.h + 2e-6 })).toBe(true);
  });

  it("keeps the aspect in a tall box and a wide one, filling the tighter side", () => {
    for (const box of [
      { w: 220, h: 520 },
      { w: 640, h: 260 },
    ]) {
      const L = layout(rightTriangle, box);
      const { A, B, C } = L.points;
      expect(dist(B, C) / dist(A, B)).toBeCloseTo(4 / 3, 6);
      expect(L.bounds.w).toBeLessThanOrEqual(box.w + 1e-6);
      expect(L.bounds.h).toBeLessThanOrEqual(box.h + 1e-6);
      // the constraining side is mostly used
      expect(Math.max(L.bounds.w / box.w, L.bounds.h / box.h)).toBeGreaterThan(0.85);
    }
  });

  it("does not care what unit the figure is in", () => {
    const big: FigureSpec = {
      ...rightTriangle,
      points: Object.fromEntries(Object.entries(rightTriangle.points).map(([k, p]) => [k, { ...p, x: p.x * 250 - 40, y: p.y * 250 + 900 }])),
    };
    const a = layout(rightTriangle);
    const b = layout(big);
    for (const k of Object.keys(a.points)) {
      expect(b.points[k].x).toBeCloseTo(a.points[k].x, 6);
      expect(b.points[k].y).toBeCloseTo(a.points[k].y, 6);
    }
  });

  it("fits every figure in boxes large and small, and reports each named point", () => {
    for (const box of [GALLERY_BOX, FIGURE.box, { w: 300, h: 240 }]) {
      for (const g of ALL) {
        const r = planFigure(g.spec, { seed: 3, box });
        expect(r, g.title).not.toBeNull();
        const b = r!.plan.bounds;
        expect(b.x, g.title).toBeGreaterThanOrEqual(-1e-6);
        expect(b.y, g.title).toBeGreaterThanOrEqual(-1e-6);
        expect(b.x + b.w, g.title).toBeLessThanOrEqual(box.w + 1e-6);
        expect(b.y + b.h, g.title).toBeLessThanOrEqual(box.h + 1e-6);
        expect(Object.keys(r!.points).sort(), g.title).toEqual(Object.keys(g.spec.points).sort());
      }
    }
  });
});

describe("planFigure — lines and rays", () => {
  const spec = (extend: "both" | "ray"): FigureSpec => ({
    points: { A: { x: 0, y: 0 }, B: { x: 3, y: 0 }, P: { x: 0, y: 1.2, label: false, dot: false } },
    lines: [{ through: ["A", "B"], extend }],
  });

  it("runs a line on a third of its span past its points, each way, with an arrowhead at each end", () => {
    const L = layout(spec("both"));
    const { A } = L.points;
    const pts = pointsOf(parts(L, "line"));
    const xs = pts.map((p) => p.x);
    expect(Math.min(...xs)).toBeCloseTo(A.x - L.scale, 0);
    expect(Math.max(...xs)).toBeCloseTo(A.x + 4 * L.scale, 0);
    // barbs off the line near both ends
    const barbNear = (x: number) => pts.some((p) => Math.abs(p.x - x) < 12 && Math.abs(p.y - A.y) > 2.5);
    expect(barbNear(A.x - L.scale)).toBe(true);
    expect(barbNear(A.x + 4 * L.scale)).toBe(true);
  });

  it("runs a ray on only past `to`, its arrowhead there", () => {
    const L = layout(spec("ray"));
    const { A } = L.points;
    const pts = pointsOf(parts(L, "line"));
    const xs = pts.map((p) => p.x);
    expect(Math.min(...xs)).toBeCloseTo(A.x, 0);
    expect(Math.max(...xs)).toBeCloseTo(A.x + 4 * L.scale, 0);
    expect(pts.some((p) => Math.abs(p.x - A.x) < 12 && Math.abs(p.y - A.y) > 2.5)).toBe(false);
    expect(pts.some((p) => Math.abs(p.x - (A.x + 4 * L.scale)) < 12 && Math.abs(p.y - A.y) > 2.5)).toBe(true);
  });

  it("does not draw a side twice where a line or a longer side already runs", () => {
    const L = layout(FIGURE_GALLERY.find((g) => g.title.startsWith("rectangle"))!.spec);
    const owners = parts(L, "side").map((p) => p.owner);
    expect(owners).toEqual(expect.arrayContaining(["AB", "BC", "CD", "DA", "AC", "BD"]));
    for (const half of ["AE", "EC", "BE", "ED"]) expect(owners).not.toContain(half);
    // …but their ticks are drawn
    expect(parts(L, "tick").map((p) => p.owner).sort()).toEqual(["AE", "BE", "EC", "ED"]);
  });
});

describe("planFigure — marks", () => {
  it("draws a right-angle square in the corner at the vertex", () => {
    const L = layout(rightTriangle);
    const { A, B, C } = L.points;
    const sq = pointsOf(parts(L, "right", "ABC"));
    expect(sq.length).toBeGreaterThan(4);
    const first = sq[0];
    const last = sq[sq.length - 1];
    expect(Math.abs(side(first, B, A))).toBeLessThan(1);
    expect(Math.abs(side(last, B, C))).toBeLessThan(1);
    const far = sq.reduce((m, p) => (dist(p, B) > dist(m, B) ? p : m), sq[0]);
    const q = dist(first, B);
    expect(q).toBeGreaterThanOrEqual(FIGURE.square.min - 1);
    expect(q).toBeLessThanOrEqual(FIGURE.square.max + 1);
    expect(dist(far, B)).toBeCloseTo(q * Math.SQRT2, 0);
    // the corner is on the bisector, inside the angle
    expect(Math.abs(dirDeg(B, far) - (dirDeg(B, A) + dirDeg(B, C)) / 2)).toBeLessThan(4);
  });

  it("draws equal-length ticks across the middle of the side", () => {
    const L = layout(FIGURE_GALLERY[1].spec);
    const { A, B } = L.points;
    const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
    const ticks = parts(L, "tick", "AB");
    expect(ticks).toHaveLength(1);
    for (const s of ticks[0].strokes) {
      const p = s.points[0];
      const q = s.points[s.points.length - 1];
      expect(Math.sign(side(p, A, B))).not.toBe(Math.sign(side(q, A, B)));
      const m = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
      expect(Math.abs(side(m, A, B))).toBeLessThan(1.5);
      expect(dist(m, mid)).toBeLessThan(10);
    }
  });

  it("draws two and three ticks as that many strokes, side by side", () => {
    const spec: FigureSpec = { points: { A: { x: 0, y: 0 }, B: { x: 5, y: 0 }, C: { x: 0, y: 3 } }, segments: [{ from: "A", to: "B", ticks: 3 }, { from: "A", to: "C", ticks: 2 }] };
    const L = layout(spec);
    expect(parts(L, "tick", "AB")[0].strokes).toHaveLength(3);
    expect(parts(L, "tick", "AC")[0].strokes).toHaveLength(2);
  });

  it("points parallel arrows from → to", () => {
    const check = (spec: FigureSpec, owner: string, from: string, to: string) => {
      const L = layout(spec);
      const a = L.points[from];
      const b = L.points[to];
      const u = { x: (b.x - a.x) / dist(a, b), y: (b.y - a.y) / dist(a, b) };
      const along = (p: Pt) => (p.x - a.x) * u.x + (p.y - a.y) * u.y;
      const arrows = parts(L, "arrow", owner);
      expect(arrows).toHaveLength(1);
      for (const s of arrows[0].strokes) {
        const tip = s.points.reduce((m, p) => (along(p) > along(m) ? p : m), s.points[0]);
        expect(Math.abs(side(tip, a, b))).toBeLessThan(1.5);
        expect(along(s.points[0])).toBeLessThan(along(tip) - 4);
        expect(along(s.points[s.points.length - 1])).toBeLessThan(along(tip) - 4);
      }
    };
    const para = FIGURE_GALLERY.find((g) => g.title.startsWith("parallelogram"))!.spec;
    check(para, "AB", "A", "B");
    check(para, "DC", "D", "C");
    check(para, "AD", "A", "D");
    // the other way round
    check({ ...para, segments: [{ from: "B", to: "A", arrows: 1 }] }, "BA", "B", "A");
  });

  it("draws an angle's arc between its two rays, at one radius", () => {
    const spec = FIGURE_GALLERY.find((g) => g.title === "exterior angle")!.spec;
    const L = layout(spec);
    for (const [owner, at, from, to] of [
      ["BAC", "A", "B", "C"],
      ["ACB", "C", "A", "B"],
      ["DBC", "B", "D", "C"],
    ] as const) {
      const v = L.points[at];
      const a = dirDeg(v, L.points[from]);
      const b = dirDeg(v, L.points[to]);
      const arc = pointsOf(parts(L, "arc", owner));
      expect(arc.length, owner).toBeGreaterThan(5);
      const r = dist(arc[0], v);
      expect(r).toBeGreaterThanOrEqual(FIGURE.arc.min - 1);
      for (const p of arc) {
        expect(Math.abs(dist(p, v) - r), owner).toBeLessThan(1.2);
        expect(inAngle(dirDeg(v, p), a, b, 2), owner).toBe(true);
      }
      // it spans the angle, ray to ray
      const ends = [dirDeg(v, arc[0]), dirDeg(v, arc[arc.length - 1])];
      const near = (d: number, e: number) => Math.min(Math.abs(d - e), 360 - Math.abs(d - e)) < 4;
      expect(ends.some((e) => near(e, a)) && ends.some((e) => near(e, b)), owner).toBe(true);
    }
  });

  it("draws equal angles with two or three concentric arcs", () => {
    const L = layout(FIGURE_GALLERY[1].spec);
    const v = L.points.B;
    const radii = parts(L, "arc", "CBA")[0].strokes.map((s) => dist(s.points[Math.floor(s.points.length / 2)], v));
    expect(radii).toHaveLength(2);
    expect(Math.abs(radii[1] - radii[0])).toBeGreaterThan(FIGURE.arc.step - 1);
    expect(Math.abs(radii[1] - radii[0])).toBeLessThan(FIGURE.arc.step + 1);
    const three = layout({ ...FIGURE_GALLERY[1].spec, angles: [{ at: "B", from: "C", to: "A", arcs: 3 }] });
    expect(parts(three, "arc", "CBA")[0].strokes).toHaveLength(3);
  });

  it("gives a small angle a longer arc, so it can be seen", () => {
    const L = layout(EXTRA[2].spec);
    const arc = pointsOf(parts(L, "arc", "BAC"));
    let length = 0;
    for (let i = 1; i < arc.length; i++) length += dist(arc[i - 1], arc[i]);
    expect(length).toBeGreaterThanOrEqual(FIGURE.arc.minLen - 3);
  });

  it("puts nested angles at one vertex on separate arcs", () => {
    const spec: FigureSpec = {
      points: { B: { x: 0, y: 0 }, A: { x: 4, y: 0 }, D: { x: 3, y: 2 }, C: { x: 1, y: 4 } },
      segments: [{ from: "B", to: "A" }, { from: "B", to: "D" }, { from: "B", to: "C" }],
      angles: [
        { at: "B", from: "A", to: "D" },
        { at: "B", from: "A", to: "C" },
      ],
    };
    const L = layout(spec);
    const v = L.points.B;
    const r1 = dist(parts(L, "arc", "ABD")[0].strokes[0].points[0], v);
    const r2 = dist(parts(L, "arc", "ABC")[0].strokes[0].points[0], v);
    expect(Math.abs(r1 - r2)).toBeGreaterThan(6);
  });

  it("dots a point on nothing and a named point along a straight run, not a corner", () => {
    const spec: FigureSpec = {
      points: {
        A: { x: 0, y: 0 },
        B: { x: 4, y: 0 },
        C: { x: 0, y: 3 },
        M: { x: 2, y: 0 },
        Q: { x: 3, y: 0, label: false },
        P: { x: 3, y: 2.5 },
        R: { x: 0, y: 1.5, dot: false },
      },
      polygons: [{ vertices: ["A", "B", "C"] }],
      angles: [{ at: "C", from: "A", to: "B" }],
    };
    const dots = parts(layout(spec), "dot").map((p) => p.owner).sort();
    // P is on nothing; M is along AB (no corner there); Q is along AB too but unnamed; R asked for none
    expect(dots).toEqual(["M", "P"]);
    const asked = parts(layout({ ...spec, points: { ...spec.points, A: { x: 0, y: 0, dot: true } } }), "dot").map((p) => p.owner);
    expect(asked).toContain("A");
  });
});

describe("planFigure — labels", () => {
  it("no label touches a stroke or another label, across every figure", () => {
    for (const box of [GALLERY_BOX, { w: 320, h: 260 }]) {
      for (const g of ALL) {
        for (const seed of [1, 42]) {
          const L = layout(g.spec, box, seed);
          const labels = L.parts.filter((p) => p.rect);
          const ink = pointsOf(L.parts.filter((p) => !p.rect));
          expect(L.collisions, `${g.title} @${box.w}`).toBe(0);
          for (const l of labels) {
            expect(ink.filter((p) => inside(p, l.rect!)).length, `${g.title}: ${l.latex} on ink`).toBe(0);
            for (const o of labels) if (o !== l) expect(overlap(l.rect!, o.rect!), `${g.title}: ${l.latex} on ${o.latex}`).toBe(false);
          }
        }
      }
    }
  });

  it("finds a clear spot for every label on random convex figures", () => {
    const rng = mulberry32(2024);
    let figures = 0;
    let crowded = 0;
    for (let k = 0; k < 160; k++) {
      const n = 3 + Math.floor(rng() * 4);
      const names = ["A", "B", "C", "D", "E", "F"].slice(0, n);
      const start = rng() * 2 * Math.PI;
      // convex: vertices round a circle, the gaps between them uneven
      const gaps = names.map(() => 0.5 + rng());
      const total = gaps.reduce((t, g) => t + g, 0);
      let at = start;
      const points: FigureSpec["points"] = {};
      names.forEach((nm, i) => {
        points[nm] = { x: +(3 * Math.cos(at)).toFixed(3), y: +(3 * Math.sin(at) * (0.6 + rng() * 0.4)).toFixed(3) };
        at += (gaps[i] / total) * 2 * Math.PI;
      });
      const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rng() * xs.length)];
      const spec: FigureSpec = {
        points,
        polygons: [{ vertices: names }],
        segments: names.map((nm, i) => ({ from: nm, to: names[(i + 1) % n], label: rng() < 0.5 ? pick(["x", "2x + 1", "y", "a", "3x"]) : undefined })),
        angles: names.filter(() => rng() < 0.4).map((nm) => {
          const i = names.indexOf(nm);
          return { at: nm, from: names[(i + n - 1) % n], to: names[(i + 1) % n], label: rng() < 0.7 ? pick(["x", "y", "\\theta", "2x"]) : undefined };
        }),
      };
      if (checkFigure(spec).length > 0) continue;
      const box = rng() < 0.5 ? GALLERY_BOX : { w: 300, h: 240 };
      const L = layoutFigure(spec, { seed: k, box })!;
      expect(L.bounds.w).toBeLessThanOrEqual(box.w + 1e-6);
      expect(L.bounds.h).toBeLessThanOrEqual(box.h + 1e-6);
      figures++;
      if (L.collisions > 0) crowded++;
    }
    expect(figures).toBeGreaterThan(100);
    expect(crowded / figures).toBeLessThanOrEqual(0.02);
  });

  it("writes every label and name it was given", () => {
    for (const g of ALL) {
      const L = layout(g.spec, GALLERY_BOX);
      const want =
        Object.values(g.spec.points).filter((p) => p.label !== false).length +
        (g.spec.segments ?? []).filter((s) => s.label).length +
        (g.spec.angles ?? []).filter((a) => a.label).length +
        (g.spec.lines ?? []).filter((l) => l.label).length;
      expect(L.parts.filter((p) => p.rect).length, g.title).toBe(want);
    }
  });

  const convex = ALL.filter((g) => g.spec.polygons?.length);

  it("writes a polygon's vertex names outside it", () => {
    for (const g of convex) {
      const L = layout(g.spec, GALLERY_BOX);
      for (const poly of g.spec.polygons!) {
        const px = poly.vertices.map((n) => L.points[n]);
        for (const n of poly.vertices) {
          const name = parts(L, "name", n)[0];
          if (!name) continue;
          const r = name.rect!;
          const corners = [centre(r), { x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x, y: r.y + r.h }, { x: r.x + r.w, y: r.y + r.h }];
          for (const c of corners) expect(pointInPolygon(c, px), `${g.title}: ${n}`).toBe(false);
        }
      }
    }
  });

  it("writes a polygon's side labels outside it, beside the side's middle", () => {
    let seen = 0;
    for (const g of convex) {
      const L = layout(g.spec, GALLERY_BOX);
      for (const poly of g.spec.polygons!) {
        const px = poly.vertices.map((n) => L.points[n]);
        const mid = { x: px.reduce((t, p) => t + p.x, 0) / px.length, y: px.reduce((t, p) => t + p.y, 0) / px.length };
        for (let i = 0; i < poly.vertices.length; i++) {
          const f = poly.vertices[i];
          const t = poly.vertices[(i + 1) % poly.vertices.length];
          const label = parts(L, "sideLabel").find((p) => p.owner === `${f}${t}` || p.owner === `${t}${f}`);
          if (!label) continue;
          seen++;
          const a = L.points[f];
          const b = L.points[t];
          const c = centre(label.rect!);
          expect(Math.sign(side(c, a, b)), `${g.title}: ${label.owner}`).not.toBe(Math.sign(side(mid, a, b)));
          // beside the middle third of the side
          const along = ((c.x - a.x) * (b.x - a.x) + (c.y - a.y) * (b.y - a.y)) / dist(a, b) ** 2;
          expect(along, `${g.title}: ${label.owner}`).toBeGreaterThan(0.2);
          expect(along, `${g.title}: ${label.owner}`).toBeLessThan(0.8);
        }
      }
    }
    expect(seen).toBeGreaterThan(10);
  });

  it("writes angle labels inside the angle, past the arc", () => {
    let seen = 0;
    for (const g of ALL) {
      const L = layout(g.spec, GALLERY_BOX);
      for (const a of g.spec.angles ?? []) {
        if (!a.label) continue;
        seen++;
        const owner = `${a.from}${a.at}${a.to}`;
        const label = parts(L, "angleLabel", owner)[0];
        const v = L.points[a.at];
        const c = centre(label.rect!);
        expect(inAngle(dirDeg(v, c), dirDeg(v, L.points[a.from]), dirDeg(v, L.points[a.to])), `${g.title}: ${owner}`).toBe(true);
        const mark = pointsOf([...parts(L, "arc", owner), ...parts(L, "right", owner)]);
        const reach = Math.max(...mark.map((p) => dist(p, v)));
        const r = label.rect!;
        const nearest = { x: Math.max(r.x, Math.min(v.x, r.x + r.w)), y: Math.max(r.y, Math.min(v.y, r.y + r.h)) };
        expect(dist(nearest, v), `${g.title}: ${owner}`).toBeGreaterThan(reach);
      }
    }
    expect(seen).toBeGreaterThan(10);
  });

  it("writes point names with digits as subscripts", () => {
    const L = layout({ points: { P1: { x: 0, y: 0 }, P2: { x: 3, y: 1 } }, segments: [{ from: "P1", to: "P2" }] });
    expect(parts(L, "name").map((p) => p.latex).sort()).toEqual(["P_{1}", "P_{2}"]);
  });

  it("leaves out a label the hand cannot write, and draws the rest", () => {
    const spec: FigureSpec = { ...rightTriangle, segments: [{ from: "A", to: "B", label: "\\foo" }, { from: "B", to: "C", label: "4" }] };
    const L = layout(spec);
    expect(parts(L, "sideLabel").map((p) => p.latex)).toEqual(["4"]);
    expect(parts(L, "side")).toHaveLength(3);
  });
});

describe("planFigure — the plan", () => {
  it("is the same drawing for the same seed, and another hand for another seed", () => {
    const opts = { seed: 99, box: GALLERY_BOX };
    for (const g of ALL.slice(0, 6)) {
      expect(planFigure(g.spec, opts)).toEqual(planFigure(g.spec, opts));
      const other = planFigure(g.spec, { ...opts, seed: 100 })!;
      expect(JSON.stringify(other.plan.lines)).not.toBe(JSON.stringify(planFigure(g.spec, opts)!.plan.lines));
    }
  });

  it("draws in a teacher's order: sides, lines, circles, angle marks, ticks and arrows, dots, then the writing", () => {
    const rank: Record<FigurePart["kind"], number> = { side: 0, line: 1, circle: 2, arc: 3, right: 3, tick: 4, arrow: 4, dot: 5, name: 6, sideLabel: 7, angleLabel: 8, lineLabel: 9 };
    for (const g of ALL) {
      const kinds = layout(g.spec, GALLERY_BOX).parts.map((p) => rank[p.kind]);
      expect(kinds, g.title).toEqual([...kinds].sort((a, b) => a - b));
    }
    // and the plan's lines follow the parts: the sides first, the names after the marks
    const plan = planFigure(rightTriangle, { seed: 1, box: GALLERY_BOX })!.plan;
    expect(plan.lines[0].latex).toBe("");
    expect(plan.lines.map((l) => l.latex).filter(Boolean)).toEqual(["A", "B", "C", "3", "4", "x"]);
  });

  it("is on the board in a few seconds, like a graph", () => {
    for (const g of ALL) {
      const plan = planFigure(g.spec, { seed: 5, box: GALLERY_BOX })!.plan;
      const wall = plan.totalMs / (plan.pace ?? 1);
      expect(wall, g.title).toBeGreaterThan(1000);
      expect(wall, g.title).toBeLessThanOrEqual(6000);
    }
  });

  it("returns the px of each named point, where its strokes meet", () => {
    const r = planFigure(rightTriangle, { seed: 1, box: GALLERY_BOX })!;
    const L = layout(rightTriangle, GALLERY_BOX, 1);
    expect(r.points).toEqual(L.points);
    const ink = r.plan.lines.flatMap((l) => l.strokes.flatMap((s) => s.points.map((p) => ({ x: p.x + l.x, y: p.y + l.y }))));
    for (const p of Object.values(r.points)) expect(Math.min(...ink.map((q) => dist(p, q)))).toBeLessThan(1);
  });

  it("returns null only when there is nothing it can draw", () => {
    const box = GALLERY_BOX;
    expect(planFigure({ points: {} }, { seed: 1, box })).toBeNull();
    expect(planFigure(rightTriangle, { seed: 1, box: { w: 0, h: 0 } })).toBeNull();
    expect(planFigure(rightTriangle, { seed: 1, box: { w: Number.NaN, h: 300 } })).toBeNull();
    expect(planFigure({ points: { A: { x: 0, y: 0, label: false, dot: false } } }, { seed: 1, box })).toBeNull();
    expect(planFigure(null as unknown as FigureSpec, { seed: 1, box })).toBeNull();
    // what can be drawn is drawn: a side to an undefined point is left out, the rest stays
    const partial = layout({ ...rightTriangle, segments: [...rightTriangle.segments!, { from: "C", to: "Z" }] }, box);
    expect(parts(partial, "side")).toHaveLength(3);
    // a lone point is a dot and its name
    const lone = layout({ points: { A: { x: 2, y: 2 } } }, box);
    expect(parts(lone, "dot")).toHaveLength(1);
    expect(parts(lone, "name")).toHaveLength(1);
  });
});
