import { describe, expect, it } from "vitest";
import { markAnchor, markKey, markStrokes, ringRadii, ringRect } from "../marks";

const line = { x: 100, y: 200, w: 180, h: 40 };

describe("the tutor's marks", () => {
  it("the ring goes round the whole line: every corner of the ink box is inside it", () => {
    const { rx, ry } = ringRadii(line);
    const cx = line.x + line.w / 2;
    const cy = line.y + line.h / 2;
    for (const [x, y] of [
      [line.x, line.y],
      [line.x + line.w, line.y],
      [line.x, line.y + line.h],
      [line.x + line.w, line.y + line.h],
    ]) {
      expect(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2).toBeLessThan(1);
    }
    const r = ringRect(line);
    expect(r.x).toBeLessThan(line.x);
    expect(r.x + r.w).toBeGreaterThan(line.x + line.w);
  });

  it("the ring is one open stroke that overlaps its start, as a hand draws it", () => {
    const [ring] = markStrokes("circle", line, 7);
    expect(markStrokes("circle", line, 7)).toHaveLength(1);
    expect(ring.points.length).toBeGreaterThan(40);
  });

  it("a tick sits after the ink, as tall as the writing (within bounds)", () => {
    const a = markAnchor(line);
    expect(a.x).toBeGreaterThan(line.x + line.w);
    expect(a.h).toBeGreaterThanOrEqual(18);
    expect(a.h).toBeLessThanOrEqual(44);
    for (const p of markStrokes("check", line, 1)[0].points) expect(p.x).toBeGreaterThan(line.x + line.w);
  });

  it("a question mark is a hook and a dot", () => {
    expect(markStrokes("question", line, 3)).toHaveLength(2);
  });

  it("the same line and seed draw the same mark; the key changes only with kind or place", () => {
    expect(markStrokes("check", line, 5)).toEqual(markStrokes("check", line, 5));
    expect(markKey("check", line)).toBe(markKey("check", { ...line, x: line.x + 1 }));
    expect(markKey("check", line)).not.toBe(markKey("circle", line));
    expect(markKey("check", line)).not.toBe(markKey("check", { ...line, y: line.y + 40 }));
  });
});
