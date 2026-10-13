import { describe, expect, it } from "vitest";
import { HERO_SCENE, HERO_SCENE_PHONE } from "../heroScene";
import { homography, invert, localScale, paintedInk, polylinePoints, project, SCREEN, screenHomography } from "../sceneInk";

const close = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
};

const LINE = { latex: "7+5=12", size: 112, seed: 4, startMs: 500 };
const SCENES = [HERO_SCENE, HERO_SCENE_PHONE];

describe("sceneInk", () => {
  it("maps the flat screen's corners onto the painted ones, and back", () => {
    for (const scene of SCENES) {
      const board = scene.board!;
      const flat = [
        { x: 0, y: 0 },
        { x: SCREEN.width, y: 0 },
        { x: SCREEN.width, y: SCREEN.height },
        { x: 0, y: SCREEN.height },
      ];
      const painted = [board.tl, board.tr, board.br, board.bl];
      const h = homography(flat, painted);
      flat.forEach((p, i) => close(project(h, p), painted[i]));
      const back = invert(h);
      painted.forEach((p, i) => close(project(back, p), flat[i]));
    }
  });

  it("scales a plain stretch by its own factor", () => {
    const h = homography(
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
      [
        { x: 10, y: 20 },
        { x: 14, y: 20 },
        { x: 14, y: 24 },
        { x: 10, y: 24 },
      ],
    );
    expect(localScale(h, { x: 0.5, y: 0.5 })).toBeCloseTo(4, 6);
  });

  it("reads only straight-line paths, so the projection is exact", () => {
    expect(polylinePoints("M175.3 15.4L179.6 19.5")).toEqual([
      { x: 175.3, y: 15.4 },
      { x: 179.6, y: 19.5 },
    ]);
    expect(() => polylinePoints("M0 0C1 1 2 2 3 3")).toThrow();
  });

  it("writes every stroke on the painted screen, right of the pen tip, never under his hand", () => {
    for (const scene of SCENES) {
      const h = screenHomography(scene.board!);
      const back = invert(h);
      const { strokes, tip } = paintedInk(scene.board!, scene.penTip!, LINE);
      expect(strokes.length).toBeGreaterThan(5);
      for (const s of strokes) {
        for (const p of polylinePoints(s.d)) {
          const flat = project(back, p);
          // rounding to a tenth of a painting pixel moves a point a little on the flat screen
          expect(flat.x).toBeGreaterThan(tip.x);
          expect(flat.x).toBeLessThan(SCREEN.width);
          expect(flat.y).toBeGreaterThan(0);
          expect(flat.y).toBeLessThan(tip.y + 2);
        }
        expect(s.width).toBeGreaterThan(1);
      }
    }
  });

  it("writes the kid's line first, stroke after stroke, and the tutor's check last", () => {
    const { strokes } = paintedInk(HERO_SCENE.board!, HERO_SCENE.penTip!, LINE);
    const kid = strokes.filter((s) => s.ink === "kid");
    const check = strokes.at(-1)!;
    expect(check.ink).toBe("tutor");
    expect(strokes.filter((s) => s.ink === "tutor")).toHaveLength(1);
    for (let i = 1; i < kid.length; i++) expect(kid[i].atMs).toBeGreaterThan(kid[i - 1].atMs);
    expect(kid[0].atMs).toBe(LINE.startMs);
    expect(check.atMs).toBeGreaterThan(kid.at(-1)!.atMs + kid.at(-1)!.forMs);
  });

  it("is the same on every render (static HTML)", () => {
    expect(paintedInk(HERO_SCENE.board!, HERO_SCENE.penTip!, LINE)).toEqual(paintedInk(HERO_SCENE.board!, HERO_SCENE.penTip!, LINE));
  });
});
