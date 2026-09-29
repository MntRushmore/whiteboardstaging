import { describe, expect, it } from "vitest";
import type { HandPlan } from "../../handwriting";
import type { SketchDrawing, SketchStroke } from "../contracts";
import { SKETCH_INK, sketchDrawing, weightFor } from "../sketch/ink";
import { planSketch } from "../sketch/plan";
import { wordsWeight } from "../words";
import { problemsOf } from "./gallery";
import { PICTURE_BOX, SKETCH_GALLERY, circuit, plantCell } from "./sketchGallery";

const BOX = PICTURE_BOX;

function drawing(strokes: Array<Partial<SketchStroke> & { points: Array<[number, number]> }>, h = 750, labels: SketchDrawing["labels"] = []): SketchDrawing {
  return { w: 1000, h, strokes: strokes.map((s) => ({ closed: false, fill: false, ...s })), labels };
}

function ring(cx: number, cy: number, r: number, n = 48): Array<[number, number]> {
  return Array.from({ length: n }, (_, i) => [cx + r * Math.cos((i / n) * Math.PI * 2), cy + r * Math.sin((i / n) * Math.PI * 2)] as [number, number]);
}

/** The ink's box in plan px (every point of every stroke). */
function inkBox(plan: HandPlan): { x: number; y: number; w: number; h: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const l of plan.lines)
    for (const s of l.strokes)
      for (const p of s.points) {
        minX = Math.min(minX, l.x + p.x);
        minY = Math.min(minY, l.y + p.y);
        maxX = Math.max(maxX, l.x + p.x);
        maxY = Math.max(maxY, l.y + p.y);
      }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

const part = (plan: HandPlan, name: string) => plan.lines.find((l) => l.part === name);
const wall = (plan: HandPlan) => plan.totalMs / (plan.pace ?? 1);

describe("planSketch: the fit", () => {
  it("fills the box with the drawing, aspect kept, centred", () => {
    // a 800 × 300 rectangle: as wide as the box allows, a third as tall, in the middle
    const plan = planSketch(drawing([{ points: [[100, 100], [900, 100], [900, 400], [100, 400]], closed: true }], 500), { seed: 1, box: BOX })!;
    const b = inkBox(plan);
    expect(b.w).toBeGreaterThan(BOX.w - 10);
    expect(b.w).toBeLessThanOrEqual(BOX.w);
    expect(b.w / b.h).toBeCloseTo(800 / 300, 1);
    expect(b.y + b.h / 2).toBeCloseTo(BOX.h / 2, -0.5);
    expect(b.x + b.w / 2).toBeCloseTo(BOX.w / 2, -0.5);
  });

  it("keeps a circle round in a box of another shape", () => {
    for (const box of [BOX, { w: 300, h: 600 }, { w: 900, h: 260 }]) {
      // (big enough in its own box that the zoom cap does not hold it back)
      const b = inkBox(planSketch(drawing([{ points: ring(500, 375, 360), closed: true }]), { seed: 2, box })!);
      expect(b.w / b.h, `${box.w}x${box.h}`).toBeCloseTo(1, 1);
      expect(Math.max(b.w / box.w, b.h / box.h), `${box.w}x${box.h}`).toBeGreaterThan(0.97);
    }
  });

  it("enlarges a small subject, but at most maxZoom past its own box's fit", () => {
    const b = inkBox(planSketch(drawing([{ points: ring(500, 375, 50), closed: true }]), { seed: 3, box: BOX })!);
    const own = Math.min((BOX.w - 4) / 1000, (BOX.h - 4) / 750);
    expect(b.w).toBeLessThanOrEqual(100 * own * SKETCH_INK.maxZoom + 3);
    expect(b.w).toBeGreaterThan(100 * own * SKETCH_INK.maxZoom - 3);
  });

  it("clips what is past the drawing's box, and drops a background that is the whole box", () => {
    const d = drawing([
      { points: [[0, 0], [1000, 0], [1000, 750], [0, 750]], closed: true, fill: true, color: "light-blue" },
      { points: [[-50, 700], [1050, 700]] },
      { points: [[600, 600], [1040, 600], [1040, 740], [600, 740]], closed: true, fill: true, color: "green" },
      { points: ring(300, 300, 120), closed: true },
    ]);
    const plan = planSketch(d, { seed: 4, box: BOX })!;
    expect(part(plan, "stroke:0")).toBeUndefined();
    const b = inkBox(plan);
    expect(b.w).toBeLessThanOrEqual(BOX.w);
    // the ground line reaches both sides of the (clipped) picture, the half-off shape is still one closed stroke
    expect(part(plan, "stroke:2")!.strokes).toHaveLength(1);
    expect(part(plan, "stroke:2")!.style).toEqual({ color: "green", closed: true, fill: "solid" });
  });

  it("bounds start at (0, 0) and hold the ink, inside the box, for every gallery drawing in every box", () => {
    for (const [i, g] of SKETCH_GALLERY.entries()) {
      for (const box of [BOX, { w: 330, h: 400 }, { w: 690, h: 390 }, { w: 200, h: 160 }]) {
        const sk = sketchDrawing(g.drawing, { seed: 10 + i, box });
        expect(sk, `${g.title} in ${box.w}x${box.h}`).not.toBeNull();
        expect(problemsOf(sk!, box).filter((p) => !p.startsWith("a line runs through")), `${g.title} in ${box.w}x${box.h}`).toEqual([]);
      }
    }
  });
});

describe("planSketch: the hand", () => {
  it("draws a closed stroke as ONE pen stroke that goes round and a little past its start", () => {
    const plan = planSketch(drawing([{ points: ring(500, 375, 300), closed: true, color: "violet" }]), { seed: 5, box: BOX })!;
    const l = part(plan, "stroke:0")!;
    expect(l.style).toEqual({ color: "violet", closed: true });
    expect(l.strokes).toHaveLength(1);
    const pts = l.strokes[0].points;
    const d = Math.hypot(pts[pts.length - 1].x - pts[0].x, pts[pts.length - 1].y - pts[0].y);
    expect(d).toBeGreaterThan(2);
    expect(d).toBeLessThanOrEqual(SKETCH_INK.overshoot.px * 1.3 + 1);
  });

  it("a filled stroke is one closed stroke tinted in its colour, even when not marked closed", () => {
    const plan = planSketch(drawing([{ points: [[200, 200], [800, 200], [500, 600]], fill: true, closed: false, color: "orange" }]), { seed: 6, box: BOX })!;
    const l = part(plan, "stroke:0")!;
    expect(l.style).toEqual({ color: "orange", closed: true, fill: "solid" });
    expect(l.strokes).toHaveLength(1);
  });

  it("a long closed outline stays one stroke within the HandWriter's points", () => {
    const wiggly = Array.from({ length: 600 }, (_, i) => {
      const a = (i / 600) * Math.PI * 2;
      const r = 330 + 25 * Math.sin(a * 24);
      return [500 + r * Math.cos(a), 375 + r * Math.sin(a) * 0.9] as [number, number];
    });
    const l = part(planSketch(drawing([{ points: wiggly, closed: true, fill: true }]), { seed: 7, box: { w: 900, h: 700 } })!, "stroke:0")!;
    expect(l.strokes).toHaveLength(1);
    expect(l.strokes[0].points.length).toBeLessThanOrEqual(400);
  });

  it("an open line is resampled finely, pinned at its ends, and split into pen-sized strokes", () => {
    const plan = planSketch(drawing([{ points: [[0, 375], [1000, 375]] }, { points: [[500, 100], [500, 110]] }]), { seed: 8, box: { w: 1004, h: 800 } })!;
    const l = part(plan, "stroke:0")!;
    expect(l.strokes.length).toBeGreaterThanOrEqual(4);
    for (const s of l.strokes) for (let i = 1; i < s.points.length; i++) expect(Math.hypot(s.points[i].x - s.points[i - 1].x, s.points[i].y - s.points[i - 1].y)).toBeLessThanOrEqual(2 + SKETCH_INK.jitter * 1.5);
    const first = l.strokes[0].points[0];
    const last = l.strokes[l.strokes.length - 1].points.at(-1)!;
    expect(l.x + first.x).toBeCloseTo(2, 5);
    expect(l.x + last.x).toBeCloseTo(1002, 5);
    // consecutive strokes join where one ends
    for (let i = 1; i < l.strokes.length; i++) expect(l.strokes[i].points[0]).toEqual(l.strokes[i - 1].points.at(-1));
  });

  it("colours come from the strokes (the tutor's blue by default); words are the tutor's", () => {
    const plan = planSketch(
      drawing([{ points: ring(300, 300, 100), closed: true, color: "green" }, { points: [[600, 200], [800, 500]] }, { points: [[600, 600], [900, 600]], color: "black" }], 750, [{ text: "A leaf", x: 300, y: 500 }]),
      { seed: 9, box: BOX },
    )!;
    expect(part(plan, "stroke:0")!.style?.color).toBe("green");
    expect(part(plan, "stroke:1")!.style?.color).toBe("blue");
    expect(part(plan, "stroke:2")!.style?.color).toBe("black");
    expect(part(plan, "label:0")!.style?.color).toBe("blue");
  });

  it("lines take the sketch pen, small details a finer one, words the words' pen", () => {
    const plan = planSketch(drawing([{ points: ring(500, 375, 300), closed: true }, { points: ring(500, 375, 6), closed: true, fill: true }], 750, [{ text: "Eye", x: 500, y: 700 }]), { seed: 10, box: BOX })!;
    const big = part(plan, "stroke:0")!.strokes[0].weight!;
    const small = part(plan, "stroke:1")!.strokes[0].weight!;
    expect(big).toBe(SKETCH_INK.weight);
    expect(small).toBeLessThan(big);
    expect(small).toBeGreaterThanOrEqual(SKETCH_INK.detailWeight);
    const label = part(plan, "label:0")!;
    for (const s of label.strokes) expect(s.weight).toBe(wordsWeight(SKETCH_INK.label.size));
    expect(weightFor(0)).toBe(SKETCH_INK.detailWeight);
    expect(weightFor(1000)).toBe(SKETCH_INK.weight);
  });

  it("is the same ink for the same seed, and another hand for another seed", () => {
    const d = plantCell();
    const a = planSketch(d, { seed: 77, box: BOX });
    const b = planSketch(d, { seed: 77, box: BOX });
    const c = planSketch(d, { seed: 78, box: BOX });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
    expect(a!.lines.map((l) => l.part)).toEqual(c!.lines.map((l) => l.part));
  });

  it("names every line after its stroke or label", () => {
    const d = plantCell();
    const plan = planSketch(d, { seed: 11, box: BOX })!;
    const names = plan.lines.map((l) => l.part);
    expect(new Set(names).size).toBe(names.length);
    expect(names.filter((n) => n?.startsWith("stroke:")).sort()).toEqual(d.strokes.map((_, i) => `stroke:${i}`).sort());
    expect(names.filter((n) => n?.startsWith("label:")).sort()).toEqual(d.labels.map((_, i) => `label:${i}`).sort());
  });
});

describe("planSketch: the order", () => {
  it("big shapes first, then details, then the words", () => {
    const d = drawing(
      [
        { points: ring(150, 150, 12), closed: true },
        { points: [[600, 600], [620, 610]] },
        { points: ring(500, 375, 330), closed: true },
      ],
      750,
      [{ text: "Sun", x: 150, y: 250 }],
    );
    const names = planSketch(d, { seed: 12, box: BOX })!.lines.map((l) => l.part);
    expect(names).toEqual(["stroke:2", "stroke:0", "stroke:1", "label:0"]);
  });

  it("keeps the illustrator's layering where a filled shape overlaps: it hides what came before it, never what came after", () => {
    const d = drawing([
      // a detail, then a big filled shape over it (the illustrator hid it on purpose)
      { points: [[480, 360], [520, 390]] },
      { points: ring(500, 375, 200), closed: true, fill: true, color: "orange" },
      // a small filled window drawn on the big shape
      { points: ring(500, 375, 30), closed: true, fill: true, color: "yellow" },
      // a small line far away from everything: free to wait for the details
      { points: [[900, 50], [930, 60]] },
    ]);
    const names = planSketch(d, { seed: 13, box: BOX })!.lines.map((l) => l.part);
    expect(names.indexOf("stroke:0")).toBeLessThan(names.indexOf("stroke:1"));
    expect(names.indexOf("stroke:1")).toBeLessThan(names.indexOf("stroke:2"));
  });
});

describe("planSketch: the words", () => {
  it("writes a label centred on its spot at a readable size", () => {
    const d = drawing([{ points: ring(500, 375, 300), closed: true }], 750, [{ text: "Earth", x: 500, y: 375 }]);
    const sk = sketchDrawing(d, { seed: 14, box: BOX })!;
    const t = sk.texts[0];
    expect(t.rect.x + t.rect.w / 2).toBeCloseTo(BOX.w / 2, -1);
    expect(t.rect.y + t.rect.h / 2).toBeCloseTo(BOX.h / 2, -1);
    // a capital is ~0.62 of the hand size: at least 20 px writing
    expect(t.rect.h).toBeGreaterThan(20 * 0.55);
  });

  it("never lets two labels touch, however the illustrator crowded them: what finds no room near its spot is left out", () => {
    const labels = Array.from({ length: 16 }, (_, i) => ({ text: `Label number ${i + 1}`, x: 500 + (i % 3) * 5, y: 375 + (i % 2) * 5 }));
    const sk = sketchDrawing(drawing([{ points: ring(500, 375, 300), closed: true }], 750, labels), { seed: 15, box: BOX })!;
    // a few round the spot, the rest left out rather than written over them
    expect(sk.texts.length).toBeGreaterThanOrEqual(3);
    expect(sk.texts.length).toBeLessThan(16);
    for (let i = 0; i < sk.texts.length; i++)
      for (let j = i + 1; j < sk.texts.length; j++) {
        const p = sk.texts[i].rect;
        const q = sk.texts[j].rect;
        expect(p.x < q.x + q.w && p.x + p.w > q.x && p.y < q.y + q.h && p.y + p.h > q.y, `${sk.texts[i].text} / ${sk.texts[j].text}`).toBe(false);
      }
    for (const t of sk.texts) {
      expect(t.rect.x).toBeGreaterThanOrEqual(0);
      expect(t.rect.x + t.rect.w).toBeLessThanOrEqual(BOX.w);
    }
  });

  it("writes a label at the end of its leader line, clear of it", () => {
    for (const d of [plantCell(), circuit()]) {
      const sk = sketchDrawing(d, { seed: 16, box: BOX })!;
      expect(sk.texts).toHaveLength(d.labels.length);
      expect(problemsOf(sk, BOX)).toEqual([]);
    }
  });

  it("a label too long for one line takes two, and still fits the box", () => {
    const d = drawing([{ points: ring(500, 375, 300), closed: true }], 750, [{ text: "The very long name here!", x: 500, y: 700, size: 90 }]);
    const sk = sketchDrawing(d, { seed: 17, box: { w: 220, h: 200 } })!;
    expect(sk.texts).toHaveLength(1);
    expect(sk.plan.bounds.w).toBeLessThanOrEqual(220);
  });
});

describe("planSketch: what it will not draw", () => {
  it("null for nothing left after fitting", () => {
    const opts = { seed: 18, box: BOX };
    // everything off the picture
    expect(planSketch(drawing([{ points: [[-50, 100], [-10, 300]] }, { points: [[1010, 100], [1050, 200]] }]), opts)).toBeNull();
    // a speck
    expect(planSketch(drawing([{ points: [[500, 500], [501, 501]] }, { points: [[502, 500], [500, 502]] }]), opts)).toBeNull();
    // only a background
    expect(planSketch(drawing([{ points: [[0, 0], [1000, 0], [1000, 750], [0, 750]], closed: true, fill: true }]), opts)).toBeNull();
    // words and nothing drawn
    expect(planSketch(drawing([{ points: [[-40, 10], [-20, 10]] }], 750, [{ text: "Hello", x: 500, y: 300 }]), opts)).toBeNull();
    // no strokes at all, points that are not numbers
    expect(planSketch({ w: 1000, h: 750, strokes: [], labels: [] }, opts)).toBeNull();
    expect(planSketch(drawing([{ points: [[Number.NaN, 1], [2, Number.POSITIVE_INFINITY]] }]), opts)).toBeNull();
    // a box too small to draw in
    expect(planSketch(plantCell(), { seed: 18, box: { w: 20, h: 20 } })).toBeNull();
  });

  it("a stroke of one point, or a tiny one, is a dot", () => {
    const plan = planSketch(drawing([{ points: ring(500, 375, 300), closed: true }, { points: [[500, 375], [500, 375]] }]), { seed: 19, box: BOX })!;
    expect(part(plan, "stroke:1")!.strokes.length).toBeGreaterThan(0);
  });
});

describe("planSketch: the most the contract allows", () => {
  // 400 strokes, 24,000 points: a wobbly line each, a third of them closed and filled
  const big: SketchDrawing = {
    w: 1000,
    h: 1000,
    strokes: Array.from({ length: 400 }, (_, i) => {
      const cx = 40 + (i % 20) * 48;
      const cy = 40 + Math.floor(i / 20) * 48;
      const closed = i % 3 === 0;
      const points = Array.from({ length: 60 }, (_, j) => {
        const t = j / 60;
        return closed ? ([cx + 20 * Math.cos(t * Math.PI * 2), cy + 20 * Math.sin(t * Math.PI * 2)] as [number, number]) : ([cx - 20 + 40 * t, cy + 12 * Math.sin(t * 12 + i)] as [number, number]);
      });
      return { points, closed, fill: closed, color: (["blue", "orange", "green", "violet"] as const)[i % 4] };
    }),
    labels: Array.from({ length: 16 }, (_, i) => ({ text: `Part ${i + 1}`, x: 60 + (i % 4) * 280, y: 60 + Math.floor(i / 4) * 280 })),
  };

  it("draws it within the HandWriter's caps, in about six seconds", () => {
    const sk = sketchDrawing(big, { seed: 20, box: BOX })!;
    expect(sk).not.toBeNull();
    expect(problemsOf(sk, BOX).filter((p) => !p.startsWith("a line runs through"))).toEqual([]);
    expect(wall(sk.plan)).toBeLessThanOrEqual(SKETCH_INK.pace.maxWallMs + 1);
  });

  // ~17 ms on its own; the budget is for a pathological slowdown, not a benchmark: under the full
  // suite's parallel load the same planning took ~200 ms, and failed a 60 ms budget for nothing
  it("plans it in well under 400 ms, even under the full suite's load", () => {
    planSketch(big, { seed: 21, box: BOX });
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      planSketch(big, { seed: 22 + i, box: BOX });
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    expect(times[2]).toBeLessThan(400);
  });

  it("paces a typical picture at 4–6 s of wall time", () => {
    for (const g of SKETCH_GALLERY) {
      const w = wall(planSketch(g.drawing, { seed: 23, box: BOX })!);
      expect(w, g.title).toBeGreaterThan(4000);
      expect(w, g.title).toBeLessThanOrEqual(6001);
    }
  });
});
