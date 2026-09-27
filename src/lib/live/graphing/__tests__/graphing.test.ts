import { beforeAll, describe, expect, it } from "vitest";
import type { TLShape, TLShapeId, TLShapePartial } from "tldraw";
import type { Stroke } from "@/lib/hand";
import type { GraphIntent, LiveEngine, NumberLineIntent, PlaneGraphIntent, Rect } from "../../contracts";
import { getEngine } from "../../engine";
import { HandWriter, wallMsOf, type HandLinePlan } from "../../handwriting";
import { rectsIntersect } from "../../placement";
import {
  GRAPH,
  chooseWindow,
  fromPx,
  graphPaceFor,
  niceStepFor,
  numberLineWindow,
  placeGraphBlock,
  planGraph,
  ticksIn,
  toPx,
  traceFunction,
} from "..";

/**
 * The sketch: window, ticks, curves, regions, number lines, pacing and where it goes. The maths
 * comes from the real engine (`graphFor`); what it looks like is docs/graph/gallery.png.
 */
let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

const intent = (lines: string[]): GraphIntent => {
  const g = engine.graphFor!(lines);
  if (!g) throw new Error(`nothing to graph for ${lines.join(" / ")}`);
  return g;
};
const planeOf = (lines: string[]) => intent(lines) as PlaneGraphIntent;
const box = GRAPH.box;

/** Every point of a plan line in plot-box px. */
const pointsOf = (l: HandLinePlan) => l.strokes.flatMap((s) => s.points.map((p) => ({ x: p.x + l.x, y: p.y + l.y })));
const strokeLen = (s: Stroke) => s.points.reduce((acc, p, i) => (i === 0 ? 0 : acc + Math.hypot(p.x - s.points[i - 1].x, p.y - s.points[i - 1].y)), 0);

describe("tick spacing", () => {
  it.each([
    [7.7, 1],
    [22, 2],
    [0.9, 0.1],
    [160, 20],
    [45, 5],
  ])("a span of %s ticks every %s", (span, step) => {
    expect(niceStepFor(span)).toBe(step);
  });

  it("ticks are multiples of the step, with no -0 and no float noise", () => {
    expect(ticksIn(-3.2, 4.1, 1)).toEqual([-3, -2, -1, 0, 1, 2, 3, 4]);
    expect(ticksIn(-0.35, 0.35, 0.1)).toEqual([-0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3]);
  });
});

describe("window choice", () => {
  const within = (w: ReturnType<typeof chooseWindow>, x: number, y: number) => x > w.xMin && x < w.xMax && y > w.yMin && y < w.yMax;

  it("a line: its intercepts and the origin in view, with room round them, and the same unit both ways", () => {
    const g = planeOf(["y = 2x + 1"]);
    const w = chooseWindow(g, box);
    for (const p of g.points) expect(within(w, p.x, p.y)).toBe(true);
    expect(within(w, 0, 0)).toBe(true);
    expect(w.xMax - w.xMin).toBeGreaterThanOrEqual(6);
    expect(w.equal).toBe(true);
    expect(box.w / (w.xMax - w.xMin)).toBeCloseTo(box.h / (w.yMax - w.yMin), 6);
    expect(w.xStep).toBe(w.yStep);
  });

  it("a parabola: vertex and roots in view, each axis its own scale (not squeezed into a needle)", () => {
    const g = planeOf(["y = x^{2} - 2x - 3"]);
    const w = chooseWindow(g, box);
    for (const [x, y] of [[1, -4], [-1, 0], [3, 0]]) expect(within(w, x, y)).toBe(true);
    expect(w.equal).toBe(false);
    // the arms climb a little past the key points, not to the top of the search range
    expect(w.yMax).toBeLessThan(15);
  });

  it("a system: where the lines cross and where they meet the axes", () => {
    const w = chooseWindow(planeOf(["x + y = 6", "x - y = 2"]), box);
    for (const [x, y] of [[4, 2], [6, 0], [0, 6], [0, -2]]) expect(within(w, x, y)).toBe(true);
  });

  it("a circle: all of it, and round", () => {
    const w = chooseWindow(planeOf(["(x - 1)^{2} + (y + 2)^{2} = 9"]), box);
    expect(w.xMin).toBeLessThan(-2);
    expect(w.xMax).toBeGreaterThan(4);
    expect(w.yMin).toBeLessThan(-5);
    expect(w.yMax).toBeGreaterThan(1);
    expect(w.equal).toBe(true);
  });

  it("an asymptote is in view with the curve on both sides of it", () => {
    const w = chooseWindow(planeOf(["y = \\frac{2x + 1}{x - 1}"]), box);
    expect(within(w, 1, 2)).toBe(true);
    expect(w.xMax - 1).toBeGreaterThan(1);
  });

  it("a number line: a few ticks either side of the answer, whole numbers for whole answers", () => {
    const nl = numberLineWindow(intent(["x > 4"]) as NumberLineIntent);
    expect(nl.step).toBe(1);
    expect(nl.lo).toBeLessThanOrEqual(1);
    expect(nl.hi).toBeGreaterThanOrEqual(7);
    const chain = numberLineWindow(intent(["-2 \\le x < 3"]) as NumberLineIntent);
    expect(chain.lo).toBeLessThan(-2);
    expect(chain.hi).toBeGreaterThan(3);
  });
});

describe("curves", () => {
  it("1 / (x - 2) is broken at its asymptote: no stroke crosses x = 2, and none leaves the box", () => {
    const g = planeOf(["y = \\frac{1}{x - 2}"]);
    const w = chooseWindow(g, box);
    const c = g.curves[0];
    if (c.kind !== "function") throw new Error("expected a function");
    const runs = traceFunction(c.f, w, [2]);
    const wall = toPx(w, 2, 0).x;
    expect(runs.length).toBeGreaterThanOrEqual(2);
    for (const r of runs) {
      const left = r.every((p) => p.x <= wall + 0.5);
      const right = r.every((p) => p.x >= wall - 0.5);
      expect(left || right).toBe(true);
      for (const p of r) {
        expect(p.x).toBeGreaterThanOrEqual(-0.01);
        expect(p.x).toBeLessThanOrEqual(w.w + 0.01);
        expect(p.y).toBeGreaterThanOrEqual(-0.01);
        expect(p.y).toBeLessThanOrEqual(w.h + 0.01);
      }
    }
    // each branch runs right up to the box edge as it heads off to infinity
    expect(runs.some((r) => r.some((p) => p.y < 1 || p.y > w.h - 1))).toBe(true);
  });

  it("a square root starts exactly at its end point", () => {
    const g = planeOf(["y = \\sqrt{x + 4}"]);
    const w = chooseWindow(g, box);
    const c = g.curves[0];
    if (c.kind !== "function") throw new Error("expected a function");
    const runs = traceFunction(c.f, w, []);
    expect(runs).toHaveLength(1);
    const start = toPx(w, -4, 0);
    expect(Math.hypot(runs[0][0].x - start.x, runs[0][0].y - start.y)).toBeLessThan(0.5);
  });

  it("a strict inequality's boundary is dashed; a non-strict one is drawn solid", () => {
    const dashed = planGraph(intent(["y < 2x + 1"]), { seed: 1 })!;
    const solid = planGraph(intent(["y \\le 2x + 1"]), { seed: 1 })!;
    const curve = (p: typeof dashed) => p.plan.lines.find((l) => l.latex.includes("2x + 1"))!;
    expect(Math.max(...curve(dashed).strokes.map(strokeLen))).toBeLessThan(14);
    expect(curve(dashed).strokes.length).toBeGreaterThan(8);
    expect(Math.max(...curve(solid).strokes.map(strokeLen))).toBeGreaterThan(60);
  });
});

describe("regions", () => {
  /** The hatching: the plan line right after the boundary. */
  const hatchOf = (lines: string[], boundary: string) => {
    const planned = planGraph(intent(lines), { seed: 3 })!;
    const i = planned.plan.lines.findIndex((l) => l.latex === boundary);
    return { planned, hatch: planned.plan.lines[i + 1] };
  };

  it.each([
    ["y < 2x + 1", (x: number, y: number) => y < 2 * x + 1],
    ["y \\ge -x + 2", (x: number, y: number) => y >= -x + 2],
    ["2x + 3y \\ge 6", (x: number, y: number) => 2 * x + 3 * y >= 6],
  ])("%s is hatched on its own side, and only there", (latex, holds) => {
    const { planned, hatch } = hatchOf([latex], latex);
    expect(hatch.latex).toBe("");
    const pts = pointsOf(hatch);
    expect(pts.length).toBeGreaterThan(40);
    for (const p of pts) {
      const d = fromPx(planned.window!, p.x, p.y);
      expect(holds(d.x, d.y)).toBe(true);
    }
  });

  it("the hatching is light: a few parallel strokes, not a fill", () => {
    const { hatch } = hatchOf(["y < 2x + 1"], "y < 2x + 1");
    expect(hatch.strokes.length).toBeLessThan(40);
  });
});

describe("number lines", () => {
  const setOf = (latex: string) => {
    const planned = planGraph(intent([latex]), { seed: 5 })!;
    return planned.plan.lines[planned.plan.lines.length - 1];
  };
  /** a stroke that closes on itself: a ring round an end point */
  const rings = (l: HandLinePlan) =>
    l.strokes.filter((s) => {
      const a = s.points[0];
      const b = s.points[s.points.length - 1];
      const xs = s.points.map((p) => p.x);
      return Math.hypot(a.x - b.x, a.y - b.y) < 4 && Math.max(...xs) - Math.min(...xs) > 8;
    }).length;
  /** a spiral in to the centre: the filling of a closed end point */
  const fills = (l: HandLinePlan) => l.strokes.filter((s) => s.points.length > 20 && strokeLen(s) < 60 && rings({ ...l, strokes: [s] }) === 0).length;

  it("x > 4: an open circle and a ray with an arrow, to the right", () => {
    const set = setOf("x > 4");
    expect(rings(set)).toBe(1);
    expect(fills(set)).toBe(0);
    const pts = pointsOf(set);
    expect(Math.max(...pts.map((p) => p.x))).toBeGreaterThan(GRAPH.line.w - 6);
    expect(Math.min(...pts.map((p) => p.x))).toBeGreaterThan(GRAPH.line.w / 3);
  });

  it("-2 ≤ x < 3: a closed circle, an open one, and the segment between — no arrow", () => {
    const set = setOf("-2 \\le x < 3");
    expect(rings(set)).toBe(2);
    expect(fills(set)).toBe(1);
    const pts = pointsOf(set);
    expect(Math.max(...pts.map((p) => p.x))).toBeLessThan(GRAPH.line.w - 20);
    expect(Math.min(...pts.map((p) => p.x))).toBeGreaterThan(20);
  });

  it("x < 2, x ≥ 3: two rays, out to both ends", () => {
    const pts = pointsOf(setOf("x < 2, \\ x \\ge 3"));
    expect(Math.min(...pts.map((p) => p.x))).toBeLessThan(6);
    expect(Math.max(...pts.map((p) => p.x))).toBeGreaterThan(GRAPH.line.w - 6);
  });

  it("the ticks are numbered in the tutor's hand", () => {
    const planned = planGraph(intent(["x > 4"]), { seed: 5 })!;
    const numbers = planned.plan.lines[2];
    expect(numbers.strokes.length).toBeGreaterThanOrEqual(6);
  });
});

describe("the sketch as the hand draws it", () => {
  it("axes first, then ticks, numbers, the curve, the points, their coordinates last", () => {
    const planned = planGraph(intent(["y = x^{2} - 2x - 3"]), { seed: 2 })!;
    const lines = planned.plan.lines;
    const order = lines.map((l) => l.latex);
    const curve = order.indexOf("y = x^{2} - 2x - 3");
    expect(curve).toBeGreaterThan(2);
    // the vertex has first pick of a spot, so it is written first of the four
    expect(order.slice(-4)).toEqual(["(1, -4)", "(-1, 0)", "(3, 0)", "(0, -3)"]);
    for (let i = 1; i < lines.length; i++) expect(lines[i].startMs).toBeGreaterThan(lines[i - 1].startMs);
  });

  it.each([["y = 2x + 1"], ["y < 2x + 1"], ["x + y = 6", "x - y = 2"], ["(x - 1)^{2} + (y + 2)^{2} = 9"], ["x > 4"]])(
    "%s is drawn in about 4–6 s",
    (...lines) => {
      const plan = planGraph(intent(lines), { seed: 9 })!.plan;
      expect(wallMsOf(plan)).toBeLessThanOrEqual(GRAPH.pace.maxWallMs + 1);
      expect(wallMsOf(plan)).toBeGreaterThan(2500);
    },
  );

  it("a sketch is paced by its own clock", () => {
    expect(graphPaceFor(2000)).toBe(1);
    expect(20_000 / graphPaceFor(20_000)).toBeLessThanOrEqual(GRAPH.pace.maxWallMs + 1e-6);
  });

  it("the same graph is sketched the same way every time", () => {
    const a = planGraph(intent(["y = 2x + 1"]), { seed: 42 })!.plan;
    const b = planGraph(intent(["y = 2x + 1"]), { seed: 42 })!.plan;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("no words: every piece of writing is a number, an axis letter or coordinates", () => {
    const plan = planGraph(intent(["x + y = 6", "x - y = 2"]), { seed: 4 })!.plan;
    for (const l of plan.lines) expect(l.latex).not.toMatch(/\\text|[a-wz]{2,}/);
  });
});

describe("rational functions: dashed asymptotes with their equations, a hole's open circle", () => {
  const F = "f(x) = \\frac{x^{2} - 4}{x^{2} - x - 2}";
  const allStrokes = (lines: readonly HandLinePlan[]): Stroke[] => lines.flatMap((l) => l.strokes.map((s) => ({ ...s, points: s.points.map((p) => ({ ...p, x: p.x + l.x, y: p.y + l.y })) })));
  /** short strokes lying on the line through a with direction d (px) */
  const dashesAlong = (lines: readonly HandLinePlan[], on: (p: { x: number; y: number }) => boolean) =>
    allStrokes(lines).filter((s) => s.points.every(on) && strokeLen(s) < 14 && strokeLen(s) > 2);

  it("x = -1 and y = 1 are dashed at their places, each with its equation; the hole is an open circle the curve stops at", () => {
    const planned = planGraph(intent([F]), { seed: 11 })!;
    const w = planned.window!;
    const lines = planned.plan.lines;
    const vx = toPx(w, -1, 0).x;
    const hy = toPx(w, 0, 1).y;
    expect(dashesAlong(lines, (p) => Math.abs(p.x - vx) < 1.5).length).toBeGreaterThanOrEqual(10);
    expect(dashesAlong(lines, (p) => Math.abs(p.y - hy) < 1.5).length).toBeGreaterThanOrEqual(10);
    const written = lines.map((l) => l.latex);
    expect(written).toEqual(expect.arrayContaining(["x = -1", "y = 1", "(2, \\frac{4}{3})"]));
    // the hole: one closed ring round (2, 4/3), and no stroke of the curve inside it
    const hole = toPx(w, 2, 4 / 3);
    const rings = allStrokes(lines).filter((s) => {
      const d = s.points.map((p) => Math.hypot(p.x - hole.x, p.y - hole.y));
      return d.every((r) => Math.abs(r - GRAPH.holeR) < 1.5) && strokeLen(s) > 30;
    });
    expect(rings).toHaveLength(1);
    const curve = lines.find((l) => l.latex === F)!;
    for (const p of pointsOf(curve)) expect(Math.hypot(p.x - hole.x, p.y - hole.y)).toBeGreaterThan(GRAPH.holeR);
    // and the curve comes right up to it from both sides
    const near = pointsOf(curve).filter((p) => Math.hypot(p.x - hole.x, p.y - hole.y) < GRAPH.holeR + 3);
    expect(near.some((p) => p.x < hole.x) && near.some((p) => p.x > hole.x)).toBe(true);
  });

  it("no stroke of the curve crosses the pole; each branch is in view", () => {
    const planned = planGraph(intent(["y = \\frac{2x + 1}{x - 3}"]), { seed: 3 })!;
    const w = planned.window!;
    const wall = toPx(w, 3, 0).x;
    const curve = planned.plan.lines.find((l) => l.latex === "y = \\frac{2x + 1}{x - 3}")!;
    for (const s of curve.strokes) {
      const xs = s.points.map((p) => p.x + curve.x);
      expect(Math.max(...xs) <= wall + 0.5 || Math.min(...xs) >= wall - 0.5).toBe(true);
    }
    // a real stretch of the branch right of the asymptote, not a sliver in the corner
    expect(w.xMax - 3).toBeGreaterThanOrEqual(2.5);
    const right = pointsOf(curve).filter((p) => p.x > wall + 1);
    expect(Math.max(...right.map((p) => p.x)) - Math.min(...right.map((p) => p.x))).toBeGreaterThan(60);
  });

  it("a slant asymptote is dashed along y = x + 1, with its equation", () => {
    const planned = planGraph(intent(["f(x) = \\frac{x^{2} + 1}{x - 1}"]), { seed: 5 })!;
    const w = planned.window!;
    const on = (p: { x: number; y: number }) => {
      const d = fromPx(w, p.x, p.y);
      const py = toPx(w, d.x, d.x + 1).y;
      return Math.abs(py - p.y) < 1.5;
    };
    expect(dashesAlong(planned.plan.lines, on).length).toBeGreaterThanOrEqual(10);
    expect(planned.plan.lines.map((l) => l.latex)).toContain("y = x + 1");
  });

  it("an asymptote on an axis is not drawn again, and its equation is not written", () => {
    const planned = planGraph(intent(["y = \\frac{1}{x}"]), { seed: 2 })!;
    expect(planned.plan.lines.map((l) => l.latex)).not.toContain("x = 0");
    expect(planned.plan.lines.map((l) => l.latex)).not.toContain("y = 0");
  });
});

describe("transformations: the parent dotted, the image solid, each named, an arrow between", () => {
  const lines = ["f(x) = x^{2}", "g(x) = f(x - 3) + 1"];

  it("two curves told apart without words", () => {
    const planned = planGraph(intent(lines), { seed: 21 })!;
    const parent = planned.plan.lines.find((l) => l.latex === "f(x) = x^{2}")!;
    const image = planned.plan.lines.find((l) => l.latex === "g(x) = f(x - 3) + 1")!;
    expect(parent.strokes.length).toBeGreaterThan(20);
    expect(Math.max(...parent.strokes.map(strokeLen))).toBeLessThan(GRAPH.parentDash.on + 3);
    expect(Math.max(...image.strokes.map(strokeLen))).toBeGreaterThan(60);
    const written = planned.plan.lines.map((l) => l.latex);
    expect(written).toEqual(expect.arrayContaining(["f", "g", "(3, 1)"]));
    // the parent is drawn before its image
    expect(written.indexOf("f(x) = x^{2}")).toBeLessThan(written.indexOf("g(x) = f(x - 3) + 1"));
  });

  it("the arrow runs from the parent's vertex to the image's, stopping short of both dots", () => {
    const planned = planGraph(intent(lines), { seed: 21 })!;
    const w = planned.window!;
    const from = toPx(w, 0, 0);
    const to = toPx(w, 3, 1);
    const shaft = planned.plan.lines
      .flatMap((l) => l.strokes.map((s) => s.points.map((p) => ({ x: p.x + l.x, y: p.y + l.y }))))
      .find((pts) => Math.hypot(pts[0].x - from.x, pts[0].y - from.y) < GRAPH.arrowClear + 1.5 && Math.hypot(pts[pts.length - 1].x - to.x, pts[pts.length - 1].y - to.y) < GRAPH.arrowClear + 1.5);
    expect(shaft).toBeDefined();
  });

  it.each([
    [["f(x) = x^{2}", "g(x) = f(2x)"]],
    [["f(x) = \\frac{1}{x}", "g(x) = f(x - 2) + 3"]],
    [["y = 2(x - 1)^{2} + 3", "f(x) = x^{2}", "y = 2f(x - 1) + 3"]],
    [["f(x) = \\frac{x^{2} - 4}{x^{2} - x - 2}"]],
    [["f(x) = \\frac{x^{2} + 1}{x - 1}"]],
  ])("%j: no words, drawn within the pacing budget", (ls) => {
    const plan = planGraph(intent(ls), { seed: 8 })!.plan;
    // the writing: numbers, letters, coordinates, equations — a command (`\frac`) is not a word
    for (const l of plan.lines) {
      if (ls.includes(l.latex)) continue;
      expect(l.latex).not.toMatch(/\\text/);
      expect(l.latex.replace(/\\[a-zA-Z]+/g, "")).not.toMatch(/[a-wz]{2,}/);
    }
    expect(wallMsOf(plan)).toBeLessThanOrEqual(GRAPH.pace.maxWallMs + 1);
  });
});

describe("placement", () => {
  const screen: Rect = { x: 0, y: 0, w: 1600, h: 900 };
  const size = { w: 360, h: 300 };

  it("beside the work, level with its top", () => {
    const column = { x: 100, y: 120, w: 200, h: 150 };
    const r = placeGraphBlock(size, { column, under: column, bounds: screen, avoid: [column] })!;
    expect(r.x).toBeGreaterThan(column.x + column.w);
    expect(r.y).toBe(column.y);
  });

  it("under the work (and its solution) when the side is taken, never over anything", () => {
    const column = { x: 100, y: 120, w: 200, h: 150 };
    const steps = { x: 100, y: 290, w: 220, h: 120 };
    const wall = { x: 330, y: 0, w: 1270, h: 470 };
    const r = placeGraphBlock(size, { column, under: { x: 100, y: 120, w: 220, h: 290 }, bounds: screen, avoid: [column, steps, wall] })!;
    expect(r).not.toBeNull();
    expect(r.y).toBeGreaterThan(steps.y + steps.h);
    for (const a of [column, steps, wall]) expect(rectsIntersect(r, a)).toBe(false);
  });

  it("no room anywhere: no graph, rather than one over the student's ink", () => {
    const column = { x: 100, y: 120, w: 200, h: 150 };
    const full = { x: 0, y: 0, w: 1600, h: 900 };
    expect(placeGraphBlock(size, { column, under: column, bounds: screen, avoid: [full] })).toBeNull();
  });
});

describe("HandWriter: a sketch after the steps, and whole or not at all", () => {
  function harness() {
    let clock = 0;
    const timers: Array<{ at: number; fn: () => void }> = [];
    const shapes = new Map<string, TLShape>();
    const writer = new HandWriter(
      {
        write: (fn) => fn(),
        createShapes: (ps: TLShapePartial[]) => ps.forEach((p) => shapes.set(p.id, p as unknown as TLShape)),
        updateShapes: () => undefined,
        getShape: (id: TLShapeId) => shapes.get(id),
      },
      {
        now: () => clock,
        setTimer: (fn, ms) => {
          timers.push({ at: clock + ms, fn });
          timers.sort((a, b) => a.at - b.at);
          return timers.length as unknown as ReturnType<typeof setTimeout>;
        },
        clearTimer: () => undefined,
        reducedMotion: () => false,
      },
    );
    const runUntil = (t: number) => {
      while (timers.length && timers[0].at <= t) {
        const next = timers.shift()!;
        clock = next.at;
        next.fn();
      }
      clock = t;
    };
    return { writer, shapes, runUntil };
  }
  const meta = { live: true as const, source: "ai" as const, lineId: "l1", createdAt: 0 };

  it("with a delay, nothing is drawn until it has passed; cancelled before then, nothing at all", () => {
    const plan = planGraph(intent(["y = 2x + 1"]), { seed: 1 })!.plan;
    const a = harness();
    a.writer.start(plan, { meta, delayMs: 1500, whole: true });
    a.runUntil(1400);
    expect(a.shapes.size).toBe(0);
    a.runUntil(1700);
    expect(a.shapes.size).toBeGreaterThan(0);

    const b = harness();
    b.writer.start(plan, { meta, delayMs: 1500, whole: true });
    b.runUntil(1000);
    b.writer.cancel();
    expect(b.shapes.size).toBe(0);
  });

  it("a sketch cut short is completed whole: never axes without their curve", () => {
    const plan = planGraph(intent(["y = 2x + 1"]), { seed: 1 })!.plan;
    const total = plan.lines.reduce((n, l) => n + l.strokes.length, 0);
    const h = harness();
    h.writer.start(plan, { meta, whole: true });
    h.runUntil(300);
    expect(h.shapes.size).toBeGreaterThan(0);
    expect(h.shapes.size).toBeLessThan(total);
    h.writer.cancel();
    expect(h.shapes.size).toBe(total);
  });
});
