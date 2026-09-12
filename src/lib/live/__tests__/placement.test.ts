import { describe, expect, it } from "vitest";
import type { Rect } from "../contracts";
import {
  ECHO_HEIGHTS,
  echoSizeFor,
  estimateEchoWidth,
  findFreeSlot,
  normalizeBBox,
  placeEcho,
  placeFloating,
  placeGraph,
  placeStep,
  rectsIntersect,
} from "../placement";

const viewport: Rect = { x: 0, y: 0, w: 1200, h: 800 };
const line: Rect = { x: 100, y: 200, w: 180, h: 40 };

describe("placeEcho", () => {
  it("sits 24 px right of the ink, vertically centred", () => {
    const r = placeEcho(line, "2x+3=11", "m", viewport);
    expect(r.x).toBe(280 + 24);
    expect(r.h).toBe(ECHO_HEIGHTS.m);
    expect(r.y + r.h / 2).toBeCloseTo(220);
    expect(r.w).toBe(estimateEchoWidth("2x+3=11", "m"));
  });

  it("falls below the ink when it would overflow the viewport", () => {
    const wide: Rect = { x: 900, y: 200, w: 250, h: 40 };
    const r = placeEcho(wide, "2x+3=11", "m", viewport);
    expect(r.x).toBe(wide.x);
    expect(r.y).toBe(240 + 12);
  });

  it("estimates width from visible characters", () => {
    expect(estimateEchoWidth("\\frac{1}{2}", "m")).toBeLessThan(estimateEchoWidth("\\frac{1}{2}+x^{2}-3", "m"));
    expect(estimateEchoWidth("x", "s")).toBeLessThan(estimateEchoWidth("x", "l"));
    expect(estimateEchoWidth("", "m")).toBeGreaterThanOrEqual(48);
  });

  it("picks the echo size from ink height", () => {
    expect(echoSizeFor(20)).toBe("s");
    expect(echoSizeFor(40)).toBe("m");
    expect(echoSizeFor(90)).toBe("l");
  });
});

describe("findFreeSlot", () => {
  const candidate: Rect = { x: 304, y: 198, w: 100, h: 44 };

  it("returns the candidate when nothing is in the way", () => {
    expect(findFreeSlot(candidate, [], line)).toEqual(candidate);
  });

  it("shifts right in 40 px steps past an obstacle", () => {
    const obstacle: Rect = { x: 300, y: 190, w: 60, h: 60 };
    const r = findFreeSlot(candidate, [obstacle], line);
    expect(r.x).toBe(candidate.x + 80);
    expect(r.y).toBe(candidate.y);
    expect(rectsIntersect(r, obstacle)).toBe(false);
  });

  it("drops to rows below the line when the whole right side is blocked", () => {
    const wall: Rect = { x: 290, y: 100, w: 600, h: 300 };
    const r = findFreeSlot(candidate, [wall], line);
    expect(r.x).toBe(line.x);
    expect(r.y).toBeGreaterThan(line.y + line.h);
    expect(rectsIntersect(r, wall)).toBe(false);
    expect(r.y).toBe(240 + 12 + 1 * (44 + 8));
  });

  it("gives up with the original candidate when everything is blocked", () => {
    const everything: Rect = { x: -10_000, y: -10_000, w: 20_000, h: 20_000 };
    expect(findFreeSlot(candidate, [everything], line)).toEqual(candidate);
  });
});

describe("placeGraph / placeStep / placeFloating", () => {
  it("places the graph right of the echo, or below when overflowing", () => {
    const echo: Rect = { x: 304, y: 198, w: 100, h: 44 };
    const g = placeGraph(line, echo, { w: 240, h: 200 }, viewport);
    expect(g.x).toBe(404 + 16);
    expect(g.y).toBe(line.y);
    const narrow: Rect = { x: 0, y: 0, w: 600, h: 800 };
    const below = placeGraph(line, echo, { w: 240, h: 200 }, narrow);
    expect(below.x).toBe(line.x);
    expect(below.y).toBe(Math.max(240, 242) + 16);
  });

  it("stacks solution steps at a 52 px pitch below the last line", () => {
    const column: Rect = { x: 100, y: 200, w: 300, h: 130 };
    const last: Rect = { x: 100, y: 290, w: 120, h: 40 };
    const s1 = placeStep(column, last, 1, "2x=8");
    const s3 = placeStep(column, last, 3, "x=4");
    expect(s1.x).toBe(100);
    expect(s1.y).toBe(330 + 16);
    expect(s3.y - s1.y).toBe(104);
  });

  it("floats to the viewport centre without an anchor", () => {
    const r = placeFloating(null, { w: 200, h: 44 }, viewport);
    expect(r.x + r.w / 2).toBe(600);
    expect(r.y + r.h / 2).toBe(400);
    const under = placeFloating(line, { w: 200, h: 44 }, viewport);
    expect(under.y).toBe(240 + 16);
  });

  it("normalizes bboxes into the region (clamped 0..1)", () => {
    const region: Rect = { x: 76, y: 176, w: 400, h: 200 };
    const [x0, y0, x1, y1] = normalizeBBox(line, region);
    expect(x0).toBeCloseTo(24 / 400);
    expect(y0).toBeCloseTo(24 / 200);
    expect(x1).toBeCloseTo(204 / 400);
    expect(y1).toBeCloseTo(64 / 200);
    expect(normalizeBBox({ x: -999, y: -999, w: 5000, h: 5000 }, region)).toEqual([0, 0, 1, 1]);
  });
});
