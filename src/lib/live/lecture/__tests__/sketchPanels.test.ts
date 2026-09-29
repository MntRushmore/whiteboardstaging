import { describe, expect, it } from "vitest";
import type { Rect } from "../../contracts";
import { SketchRequestSchema } from "../contracts";
import { sketchDrawing } from "../sketch/ink";
import { PANELS, sketchPanels } from "../sketch/panels";
import { planPanels, planSketch } from "../sketch/plan";
import { problemsOf } from "./gallery";
import { COMICS, PICTURE_BOX, SKETCH_GALLERY, STRIP_BOX, planComic } from "./sketchGallery";

const SQUARE = { w: 900, h: 900 };
const caps = (n: number) => ["The night shift begins.", "A call for help!", "She blasts off across the sky.", "Saved!"].slice(0, n);
/** 90 characters: the longest caption a panel may have */
const longest = (i: number) => `Panel ${i + 1}: Officer Vega races across the rooftops of Neo City towards the signal in the sky.`.slice(0, 90);

const wall = (p: { totalMs: number; pace?: number }) => p.totalMs / (p.pace ?? 1);

function inside(r: Rect, box: { w: number; h: number }): boolean {
  return r.x >= -1e-6 && r.y >= -1e-6 && r.x + r.w <= box.w + 1e-6 && r.y + r.h <= box.h + 1e-6;
}

describe("planPanels: the layout", () => {
  it("2–4 panels go in a row across a wide box, two by two in a square one", () => {
    for (const n of [2, 3, 4]) {
      const wide = sketchPanels({ count: n, captions: caps(n), title: "Officer Vega", framed: true }, { seed: 1, box: STRIP_BOX })!;
      expect([wide.cols, wide.rows], `${n} wide`).toEqual([n, 1]);
      const square = sketchPanels({ count: n, captions: caps(n), title: "Officer Vega", framed: true }, { seed: 1, box: SQUARE })!;
      expect([square.cols, square.rows], `${n} square`).toEqual(n === 2 ? [1, 2] : [2, 2]);
    }
  });

  it("frames are equal, in reading order, and none overlaps another", () => {
    for (const box of [STRIP_BOX, SQUARE, { w: 760, h: 700 }]) {
      for (const n of [1, 2, 3, 4]) {
        const out = sketchPanels({ count: n, captions: caps(n), framed: true }, { seed: 2, box })!;
        expect(out.frames, `${n} in ${box.w}x${box.h}`).toHaveLength(n);
        for (const f of out.frames) {
          expect(f.w).toBeCloseTo(out.frames[0].w, 6);
          expect(f.h).toBeCloseTo(out.frames[0].h, 6);
        }
        for (let i = 1; i < n; i++) {
          const a = out.frames[i - 1];
          const b = out.frames[i];
          // the next is to the right on the same row, or lower down
          expect(b.y > a.y + a.h || (Math.abs(b.y - a.y) < 1e-6 && b.x > a.x + a.w), `${n} in ${box.w}x${box.h}: ${i}`).toBe(true);
        }
      }
    }
  });

  it("three in a square box: two above, one centred under them", () => {
    const out = sketchPanels({ count: 3, captions: caps(3), framed: true }, { seed: 3, box: SQUARE })!;
    const [a, b, c] = out.frames;
    expect(c.x + c.w / 2).toBeCloseTo((a.x + b.x + b.w) / 2, 6);
  });

  it("a frame's drawing area is inset from the frame, and shaped for the illustrator", () => {
    for (const box of [STRIP_BOX, SQUARE, PICTURE_BOX, { w: 1500, h: 400 }, { w: 400, h: 1200 }]) {
      for (const n of [1, 2, 3, 4]) {
        const out = sketchPanels({ count: n, captions: caps(n), title: "A title", framed: true }, { seed: 4, box });
        if (!out) continue;
        out.frames.forEach((f, i) => {
          const o = out.outlines[i];
          expect(f.x - o.x).toBeCloseTo(PANELS.inset, 6);
          expect(o.x + o.w - (f.x + f.w)).toBeCloseTo(PANELS.inset, 6);
          const aspect = f.w / f.h;
          expect(SketchRequestSchema.shape.aspect.safeParse(aspect).success, `${n} in ${box.w}x${box.h}: ${aspect}`).toBe(true);
        });
      }
    }
  });

  it("a single picture without a frame: the whole room under the title, above the caption", () => {
    const out = sketchPanels({ count: 1, captions: ["A plant cell, seen from above"], title: "Plant cells", framed: false }, { seed: 5, box: PICTURE_BOX })!;
    expect(out.sketch.plan.lines.map((l) => l.part)).toEqual(["title", "caption:0"]);
    const [f] = out.frames;
    expect(f.w).toBeGreaterThan(PICTURE_BOX.w - 10);
    const title = out.sketch.texts.find((t) => t.part === "title")!.rect;
    const caption = out.sketch.texts.find((t) => t.part === "caption:0")!.rect;
    expect(f.y).toBeGreaterThan(title.y + title.h);
    expect(f.y + f.h).toBeLessThan(caption.y);
  });

  it("a single picture with nothing to write still has its room", () => {
    const out = planPanels({ count: 1, captions: [], framed: false }, { seed: 6, box: PICTURE_BOX })!;
    expect(out.plan.lines).toHaveLength(0);
    expect(out.frames[0].w).toBeGreaterThan(PICTURE_BOX.w - 10);
    expect(out.frames[0].h).toBeGreaterThan(PICTURE_BOX.h - 10);
    expect(out.plan.bounds).toEqual({ x: 0, y: 0, w: out.frames[0].x + out.frames[0].w, h: out.frames[0].y + out.frames[0].h });
  });

  it("names its parts: the title, each frame, each caption", () => {
    const out = planPanels({ count: 4, captions: caps(4), title: "Officer Vega saves Neo City", framed: true }, { seed: 7, box: STRIP_BOX })!;
    expect(out.plan.lines.map((l) => l.part)).toEqual(["title", "frame:0", "frame:1", "frame:2", "frame:3", "caption:0", "caption:1", "caption:2", "caption:3"]);
    const unframed = planPanels({ count: 2, captions: [undefined, "Later"], framed: false }, { seed: 7, box: STRIP_BOX })!;
    expect(unframed.plan.lines.map((l) => l.part)).toEqual(["caption:1"]);
  });
});

describe("planPanels: the captions", () => {
  it("are all one size, each first line on its row's writing line, under its own frame", () => {
    for (const box of [STRIP_BOX, SQUARE]) {
      const texts = ["Short.", "A caption that is rather longer than the others here", "Mid-length words", "Saved!"];
      const out = sketchPanels({ count: 4, captions: texts, framed: true }, { seed: 8, box })!;
      const parts = out.sketch.plan.lines.filter((l) => l.part?.startsWith("caption:"));
      expect(parts).toHaveLength(4);
      const weights = new Set(parts.flatMap((l) => l.strokes.map((s) => s.weight)));
      expect(weights.size, `${box.w}x${box.h}`).toBe(1);
      const byRow = new Map<number, number[]>();
      out.frames.forEach((f, i) => {
        const key = Math.round(f.y);
        byRow.set(key, [...(byRow.get(key) ?? []), out.captionBaselines[i]!]);
        const t = out.sketch.texts.find((x) => x.part === `caption:${i}`)!.rect;
        const o = out.outlines[i];
        expect(t.y).toBeGreaterThan(o.y + o.h);
        expect(t.x + t.w / 2).toBeCloseTo(o.x + o.w / 2, -1);
        expect(t.w).toBeLessThanOrEqual(o.w);
      });
      for (const [, baselines] of byRow) for (const b of baselines) expect(b).toBeCloseTo(baselines[0], 6);
    }
  });

  it("the longest captions still fit under a strip of four, small, and the same size", () => {
    const out = sketchPanels({ count: 4, captions: [0, 1, 2, 3].map(longest), title: "A strip with the longest captions there are", framed: true }, { seed: 9, box: STRIP_BOX })!;
    expect(out).not.toBeNull();
    expect(out.captionSize).toBeGreaterThanOrEqual(PANELS.caption.crowded.min);
    expect(problemsOf(out.sketch, STRIP_BOX)).toEqual([]);
  });

  it("a panel without a caption keeps the same frame as those with one", () => {
    const out = sketchPanels({ count: 3, captions: ["One", undefined, "Three"], framed: true }, { seed: 10, box: STRIP_BOX })!;
    expect(out.captionBaselines[1]).toBeNull();
    expect(out.frames[1].h).toBeCloseTo(out.frames[0].h, 6);
  });
});

describe("planPanels: the plan", () => {
  it("is clean, inside the box, its bounds from (0, 0) holding the frames too, and on the board in 2–3 s", () => {
    for (const box of [STRIP_BOX, SQUARE, PICTURE_BOX, { w: 1100, h: 480 }]) {
      for (const n of [1, 2, 3, 4]) {
        for (const framed of [true, false]) {
          const out = sketchPanels({ count: n, captions: caps(n), title: "Officer Vega saves the city", framed }, { seed: 11, box });
          const at = `${n} ${framed ? "framed" : "open"} in ${box.w}x${box.h}`;
          if (box === PICTURE_BOX && n > 2) continue;
          expect(out, at).not.toBeNull();
          // (with no frames drawn, the bounds reach past the ink to the drawing areas, on purpose)
          expect(problemsOf(out!.sketch, box).filter((p) => framed || !p.includes("do not hold the ink")), at).toEqual([]);
          const b = out!.sketch.plan.bounds;
          for (const f of [...out!.frames, ...out!.outlines]) expect(inside(f, { w: b.w, h: b.h }), at).toBe(true);
          const w = wall(out!.sketch.plan);
          expect(w, at).toBeLessThanOrEqual(PANELS.pace.maxWallMs + 1);
          if (framed && n === 4) expect(w, at).toBeGreaterThan(1500);
        }
      }
    }
  });

  it("is the same for the same seed", () => {
    const input = { count: 4, captions: caps(4), title: "Officer Vega", framed: true };
    expect(JSON.stringify(planPanels(input, { seed: 12, box: STRIP_BOX }))).toBe(JSON.stringify(planPanels(input, { seed: 12, box: STRIP_BOX })));
  });

  it("null for a count it cannot draw, or a box too small for any panel", () => {
    expect(planPanels({ count: 0, captions: [], framed: true }, { seed: 13, box: STRIP_BOX })).toBeNull();
    expect(planPanels({ count: 5, captions: [], framed: true }, { seed: 13, box: STRIP_BOX })).toBeNull();
    expect(planPanels({ count: 4, captions: caps(4), framed: true }, { seed: 13, box: { w: 260, h: 200 } })).toBeNull();
  });
});

describe("a comic on the board", () => {
  it("every drawing fills its frame's drawing area, inside it", () => {
    for (const [i, c] of COMICS.entries()) {
      const cc = planComic(c, 400 + i);
      expect(cc.panels, c.title).not.toBeNull();
      cc.drawings.forEach((d, j) => {
        const f = cc.panels!.frames[j];
        expect(d, `${c.title}: ${j}`).not.toBeNull();
        expect(d!.plan.bounds.w).toBeLessThanOrEqual(f.w + 0.5);
        expect(d!.plan.bounds.h).toBeLessThanOrEqual(f.h + 0.5);
      });
    }
  });

  it("any gallery drawing goes into any panel of the strip", () => {
    const out = planPanels({ count: 4, captions: caps(4), title: "Officer Vega", framed: true }, { seed: 14, box: STRIP_BOX })!;
    for (const f of out.frames) {
      for (const g of SKETCH_GALLERY) {
        const plan = planSketch(g.drawing, { seed: 15, box: { w: f.w, h: f.h } });
        expect(plan, g.title).not.toBeNull();
        const sk = sketchDrawing(g.drawing, { seed: 15, box: { w: f.w, h: f.h } })!;
        expect(problemsOf(sk, { w: f.w, h: f.h }).filter((p) => !p.startsWith("a line runs through")), g.title).toEqual([]);
      }
    }
  });
});
