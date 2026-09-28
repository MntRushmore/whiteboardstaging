import { describe, expect, it } from "vitest";
import { placeCoachMark, type Box } from "../placement";

const VIEW = { w: 1440, h: 900 };
const SIZE = { w: 320, h: 170 };
const intersects = (a: Box, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const boxOf = (p: { x: number; y: number }): Box => ({ x: p.x, y: p.y, ...SIZE });

describe("placing a coach mark", () => {
  it("sits centred above a toolbar button at the bottom, with its arrow on the button", () => {
    const pen = { x: 690, y: 846, w: 40, h: 40 };
    const p = placeCoachMark({ anchor: pen, size: SIZE, viewport: VIEW, prefer: ["top", "right", "left"] });
    expect(p.side).toBe("top");
    expect(p.y + SIZE.h).toBeLessThanOrEqual(pen.y);
    expect(p.x + (p.arrow ?? 0)).toBeCloseTo(pen.x + pen.w / 2);
    expect(p.overlaps).toBe(false);
  });

  it("never covers the problem: slides past it and drops the arrow when it must", () => {
    const tabs = { x: 60, y: 16, w: 260, h: 36 };
    const problem = { x: 55, y: 80, w: 300, h: 120 };
    const p = placeCoachMark({ anchor: tabs, size: SIZE, viewport: VIEW, avoid: [problem], prefer: ["bottom", "right"] });
    expect(intersects(boxOf(p), problem)).toBe(false);
    expect(intersects(boxOf(p), tabs)).toBe(false);
    expect(p.overlaps).toBe(false);
    expect(p.side).toBe("bottom");
    expect(p.x).toBeGreaterThanOrEqual(problem.x + problem.w);
    expect(p.arrow).toBeNull();
  });

  it("keeps the arrow when the popover still reaches under the anchor", () => {
    const ask = { x: 330, y: 16, w: 80, h: 36 };
    const problem = { x: 55, y: 80, w: 280, h: 120 };
    const p = placeCoachMark({ anchor: ask, size: SIZE, viewport: VIEW, avoid: [problem], prefer: ["bottom"] });
    expect(intersects(boxOf(p), problem)).toBe(false);
    expect(p.arrow).not.toBeNull();
    expect(p.x + (p.arrow as number)).toBeCloseTo(ask.x + ask.w / 2);
  });

  it("stays inside the viewport on a phone", () => {
    const phone = { w: 390, h: 844 };
    const size = { w: 366, h: 190 };
    const pen = { x: 260, y: 790, w: 44, h: 44 };
    const p = placeCoachMark({ anchor: pen, size, viewport: phone, prefer: ["top", "right", "left"] });
    expect(p.x).toBeGreaterThanOrEqual(12);
    expect(p.x + size.w).toBeLessThanOrEqual(phone.w - 12);
    expect(p.y).toBeGreaterThanOrEqual(12);
    expect(p.y + size.h).toBeLessThanOrEqual(pen.y);
  });

  it("tries the next side when the preferred one has no room", () => {
    const top = { x: 600, y: 10, w: 60, h: 30 };
    const p = placeCoachMark({ anchor: top, size: SIZE, viewport: VIEW, prefer: ["top", "bottom"] });
    expect(p.side).toBe("bottom");
  });

  it("covers as little as it can when nothing is clear, and says so", () => {
    const anchor = { x: 600, y: 400, w: 40, h: 40 };
    const everything = { x: 0, y: 0, w: VIEW.w, h: VIEW.h };
    const p = placeCoachMark({ anchor, size: SIZE, viewport: VIEW, avoid: [everything] });
    expect(p.overlaps).toBe(true);
    expect(p.x).toBeGreaterThanOrEqual(0);
  });
});
