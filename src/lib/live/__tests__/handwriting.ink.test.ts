import { describe, expect, it } from "vitest";
import { getSnapshot, type TLDrawShape } from "tldraw";
import type { Stroke } from "@/lib/hand";
import { createFakeEditor } from "../__fixtures__/fakeEditor";
import { HAND_BLOCK_META, HAND_LINE_META, HAND_PART_META, HAND_WRITE, HandWriter, planFromStrokes, planHandwriting, type HandPlan } from "../handwriting";

/**
 * What the HandWriter saves into the board: the block's summary once (`leadMeta`), and every
 * coordinate at the switch's precision (`HAND_WRITE.inkPrecision`, see inkCompact.ts) — through
 * the reveal as well as at the end, and without changing how many points the pen reveals.
 */

const META = { live: true, source: "ai", lineId: "chat", createdAt: 1_790_000_000_000 } as const;

function board() {
  const editor = createFakeEditor();
  const canvas = {
    write: (fn: () => void) => fn(),
    createShapes: (s: Parameters<typeof editor.createShapes>[0]) => editor.createShapes(s),
    updateShapes: (s: Parameters<typeof editor.updateShapes>[0]) => editor.updateShapes(s),
    getShape: (id: Parameters<typeof editor.getShape>[0]) => editor.getShape(id),
  };
  const strokes = () => editor.getCurrentPageShapes().filter((s): s is TLDrawShape => s.type === "draw");
  return { editor, canvas, strokes };
}

/** A manual clock: `tick` runs the writer's frames up to `ms` from the start. */
function clock() {
  let now = 0;
  let pending: { fn: () => void; at: number } | null = null;
  return {
    deps: {
      now: () => now,
      setTimer: (fn: () => void, ms: number) => {
        pending = { fn, at: now + ms };
        return 1 as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimer: () => {
        pending = null;
      },
      reducedMotion: () => false,
    },
    tick(ms: number) {
      while (pending && pending.at <= ms) {
        const p: { fn: () => void; at: number } = pending;
        pending = null;
        now = p.at;
        p.fn();
      }
      now = ms;
    },
  };
}

function twoLines(): HandPlan {
  const r = planHandwriting(["2x + 3 = 11", "x = 4"], { size: 30, seed: 7, origin: { x: 100.123456789, y: 200.987654321 } });
  if (!r.plan) throw new Error("no plan");
  return r.plan;
}

function decimals(n: number): number {
  const s = String(n);
  return s.includes(".") ? s.split(".")[1].length : 0;
}

describe("HandWriter: leadMeta", () => {
  it("stamps the block's summary on its first stroke only, and the block meta on every stroke", () => {
    const { canvas, strokes } = board();
    const writer = new HandWriter(canvas, { reducedMotion: () => true });
    const plan = twoLines();
    writer.start(plan, { meta: META, extraMeta: { lectureBlock: "note" }, leadMeta: { lectureWhat: "note: two-step equations" } });
    const all = strokes();
    expect(all.length).toBe(plan.lines.reduce((n, l) => n + l.strokes.length, 0));
    const lead = all.filter((s) => "lectureWhat" in s.meta);
    expect(lead).toHaveLength(1);
    expect(lead[0].meta.lectureWhat).toBe("note: two-step equations");
    // the first stroke of the first line
    expect(lead[0].id).toBe(writer.shapeIds[0]);
    expect(lead[0].meta[HAND_LINE_META]).toBe(plan.lines[0].latex);
    for (const s of all) {
      expect(s.meta.lectureBlock).toBe("note");
      expect(s.meta.source).toBe("ai");
      expect(typeof s.meta[HAND_BLOCK_META]).toBe("string");
    }
    expect(new Set(all.map((s) => s.meta[HAND_BLOCK_META])).size).toBe(1);
  });

  it("stamps it when the pen reaches the first stroke, not before, and never twice", () => {
    const { canvas, strokes } = board();
    const c = clock();
    const writer = new HandWriter(canvas, c.deps);
    writer.start(twoLines(), { meta: META, leadMeta: { lectureWhat: "x" }, delayMs: 500 });
    c.tick(400);
    expect(strokes()).toHaveLength(0);
    c.tick(900);
    expect(strokes().filter((s) => "lectureWhat" in s.meta)).toHaveLength(1);
    c.tick(60_000);
    expect(writer.active).toBe(false);
    expect(strokes().filter((s) => "lectureWhat" in s.meta)).toHaveLength(1);
  });

  it("adds nothing without it (and an empty one is no summary)", () => {
    const { canvas, strokes } = board();
    const writer = new HandWriter(canvas, { reducedMotion: () => true });
    writer.start(twoLines(), { meta: META, leadMeta: {} });
    for (const s of strokes()) expect(Object.keys(s.meta).sort()).toEqual([...Object.keys(META), HAND_BLOCK_META, HAND_LINE_META].sort());
  });
});

describe("HandWriter: ink precision", () => {
  it("is 1/100 px, what tldraw's own pen stores", () => {
    expect(HAND_WRITE.inkPrecision).toBe(100);
  });

  it("saves every point and origin at 1/100 px and pressure to two decimals, through the reveal too", () => {
    const { editor, canvas, strokes } = board();
    const c = clock();
    const writer = new HandWriter(canvas, c.deps);
    const plan = twoLines();
    writer.start(plan, { meta: META });
    const check = () => {
      for (const s of strokes()) {
        expect(decimals(s.x)).toBeLessThanOrEqual(2);
        expect(decimals(s.y)).toBeLessThanOrEqual(2);
        for (const p of s.props.segments[0].points) {
          expect(decimals(p.x)).toBeLessThanOrEqual(2);
          expect(decimals(p.y)).toBeLessThanOrEqual(2);
          expect(decimals(p.z ?? 0)).toBeLessThanOrEqual(2);
        }
      }
    };
    let midStroke = false;
    for (let t = 16; t < 60_000 && writer.active; t += 16) {
      c.tick(t);
      midStroke ||= strokes().some((s) => !s.props.isComplete);
      check();
    }
    expect(midStroke).toBe(true);
    expect(writer.active).toBe(false);
    // the same points, only rounded: the reveal and the geometry are the plan's
    // in writing order: line by line, stroke by stroke
    const all = writer.shapeIds.map((id) => editor.getShape(id) as TLDrawShape);
    const planned = plan.lines.flatMap((l) => l.strokes.map((st) => ({ line: l, st })));
    expect(all).toHaveLength(planned.length);
    all.forEach((s, k) => {
      const { line, st } = planned[k];
      const pts = s.props.segments[0].points;
      expect(pts).toHaveLength(st.points.length);
      expect(s.props.isComplete).toBe(true);
      for (let i = 0; i < pts.length; i++) {
        expect(Math.abs(s.x + pts[i].x - (line.x + st.points[i].x))).toBeLessThanOrEqual(0.0101);
        expect(Math.abs(s.y + pts[i].y - (line.y + st.points[i].y))).toBeLessThanOrEqual(0.0101);
        expect(Math.abs((pts[i].z ?? 0) - st.points[i].z)).toBeLessThanOrEqual(0.0051);
      }
    });
  });

  it("does not change the plan it was given", () => {
    const { canvas } = board();
    const plan = twoLines();
    const before = JSON.stringify(plan);
    new HandWriter(canvas, { reducedMotion: () => true }).start(plan, { meta: META });
    expect(JSON.stringify(plan)).toBe(before);
  });

  it("keeps a closed shape closed, filled once whole, and names its part", () => {
    const { canvas, strokes } = board();
    const c = clock();
    const bar: Stroke = {
      order: 0,
      kind: "rule",
      points: [
        { x: 10.123456, y: 90.98765, z: 0.5 },
        { x: 10.123456, y: 20.5555555, z: 0.5 },
        { x: 50.777777, y: 20.5555555, z: 0.5 },
        { x: 50.777777, y: 90.98765, z: 0.5 },
        { x: 10.123456, y: 90.98765, z: 0.5 },
      ],
    } as Stroke;
    const plan = planFromStrokes("bar", [bar], 30)!;
    plan.lines[0] = { ...plan.lines[0], style: { color: "orange", fill: "solid", closed: true }, part: "bar:Q1:0" };
    const writer = new HandWriter(canvas, c.deps);
    writer.start(plan, { meta: META });
    c.tick(100);
    const drawing = strokes()[0];
    expect(drawing.props.isComplete).toBe(false);
    expect(drawing.props.isClosed).toBe(false);
    expect(drawing.props.fill).toBe("none");
    c.tick(60_000);
    const done = strokes()[0];
    expect(done.props).toMatchObject({ isComplete: true, isClosed: true, fill: "solid", color: "orange" });
    expect(done.meta[HAND_PART_META]).toBe("bar:Q1:0");
    const pts = done.props.segments[0].points;
    expect(pts[0]).toEqual(pts[pts.length - 1]);
  });

  it("saves a worked solution in about half the bytes of full precision", () => {
    const plan = twoLines();
    const { editor, canvas } = board();
    const before = JSON.stringify(getSnapshot(editor.store)).length;
    new HandWriter(canvas, { reducedMotion: () => true }).start(plan, { meta: META });
    const saved = JSON.stringify(getSnapshot(editor.store)).length - before;
    const rawPoints = plan.lines.reduce((n, l) => n + l.strokes.reduce((m, st) => m + JSON.stringify(st.points).length, 0), 0);
    let points = 0;
    for (const s of editor.getCurrentPageShapes()) if (s.type === "draw") points += JSON.stringify((s as TLDrawShape).props.segments[0].points).length;
    expect(points).toBeLessThan(rawPoints * 0.6);
    // the whole block, records and meta included, against the same block at full precision
    expect(saved).toBeLessThan((saved - points + rawPoints) * 0.75);
  });
});
