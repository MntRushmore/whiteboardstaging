import { describe, expect, it } from "vitest";
import { CHECKS_SCENE, HELP_SCENE, type InkScene } from "../stepInk";

/** Every coordinate pair in an `M x y L x y ...` path. */
function points(d: string): { x: number; y: number }[] {
  expect(d).toMatch(/^M-?\d+(\.\d+)? -?\d+(\.\d+)?(L-?\d+(\.\d+)? -?\d+(\.\d+)?)*$/);
  return d
    .slice(1)
    .split("L")
    .map((pair) => {
      const [x, y] = pair.split(" ").map(Number);
      return { x, y };
    });
}

describe.each([
  ["CHECKS_SCENE", CHECKS_SCENE],
  ["HELP_SCENE", HELP_SCENE],
] as [string, InkScene][])("%s", (_name, scene) => {
  it("has paths that parse and stay inside its bounds, starting at (0, 0)", () => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const stroke of scene.strokes) {
      const pts = points(stroke.d);
      expect(pts.length).toBeGreaterThanOrEqual(2);
      for (const p of pts) {
        expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
      expect(stroke.len).toBeGreaterThan(0);
    }
    expect(minX).toBe(0);
    expect(minY).toBe(0);
    expect(maxX).toBeCloseTo(scene.width, 5);
    expect(maxY).toBeCloseTo(scene.height, 5);
  });

  it("has the student's ink and at least one tutor stroke", () => {
    expect(scene.strokes.some((s) => s.ink === "student")).toBe(true);
    expect(scene.strokes.some((s) => s.ink === "tutor")).toBe(true);
    expect(scene.says.length).toBeGreaterThan(0);
    expect(scene.source).toMatch(/^[0-9a-f-]{36} · /);
  });

  it("puts the ring inside the scene", () => {
    expect(scene.ring).not.toBeNull();
    const ring = scene.ring!;
    expect(ring.right).toBeGreaterThan(0);
    expect(ring.right).toBeLessThanOrEqual(scene.width);
    expect(ring.midY).toBeGreaterThan(0);
    expect(ring.midY).toBeLessThanOrEqual(scene.height);
  });
});
