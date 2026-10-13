import fs from "node:fs";
import path from "node:path";
import { evaluate } from "mathjs";
import { describe, expect, it } from "vitest";
import { LANDING_COPY } from "@/components/landing/copy";
import { pathBounds } from "../replay";
import { INK_PACE, inkTimeline, TYPING_PACE, typingDemo } from "../devices";
import { PHONE_SCENE, TABLET_SCENE } from "../devicesInk";

const laptop = LANDING_COPY.devices.items[1];

/** where a linear equation in x is true (it is linear: two values tell its line) */
function root(equation: string): number {
  const [l, r] = equation.split("=");
  const f = (x: number) => Number(evaluate(`(${l}) - (${r})`, { x }));
  const a = f(1) - f(0);
  expect(a, equation).not.toBe(0);
  return -f(0) / a;
}
const holds = (equation: string, x: number) => {
  const [l, r] = equation.split("=");
  return Math.abs(Number(evaluate(l, { x })) - Number(evaluate(r, { x }))) < 1e-9;
};

describe("the laptop's Type it", () => {
  it("types a right next step for the board's first problem (so the check mark is honest)", () => {
    const [first] = laptop.problems;
    const x = root(first);
    expect(x).toBe(5);
    expect(holds(laptop.typed, x)).toBe(true);
    // a step, not the problem again
    expect(laptop.typed.replace(/\s/g, "")).not.toBe(first.replace(/\s/g, ""));
    // and every problem on the board has a whole-number answer, as the board's would
    for (const p of laptop.problems) expect(Number.isInteger(root(p)), p).toBe(true);
  });

  it("says the board writes the line in their pen color, not their own handwriting", () => {
    expect(laptop.body).toContain(laptop.typed);
    expect(laptop.body).toMatch(/pen color/);
    expect(laptop.body).not.toMatch(/own handwriting/);
  });

  it("types key by key, the preview being the bar's own reading of the box after each key", () => {
    const demo = typingDemo(laptop.typed);
    expect(demo.keys.map((k) => k.char).join("")).toBe(laptop.typed);
    for (let i = 1; i < demo.keys.length; i++) expect(demo.keys[i].atMs).toBeGreaterThan(demo.keys[i - 1].atMs);
    expect(demo.firstMs).toBe(TYPING_PACE.typeAtMs);
    expect(demo.previews.map((p) => p.latex)).toEqual(["3", "3x", "3x =", "3x = 1", "3x = 15"]);
    expect(demo.latex).toBe("3x = 15");
    for (const p of demo.previews) expect(p.toMs).toBeGreaterThan(p.fromMs);
    expect(demo.previews.at(-1)!.toMs).toBe(demo.clearMs);
    // Enter after the last key, the box empties, then the board writes
    expect(demo.enterMs).toBeGreaterThan(demo.keys.at(-1)!.atMs);
    expect(demo.clearMs).toBeGreaterThan(demo.enterMs);
    expect(demo.writeMs).toBeGreaterThan(demo.clearMs);
  });

  it("never types a line the bar could not read", () => {
    expect(() => typingDemo("3x=")).not.toThrow();
    expect(() => typingDemo("")).toThrow(/cannot read/);
  });
});

describe("the tablet's and the phone's ink", () => {
  it("plays each line's strokes in order, then its check mark a beat later", () => {
    for (const scene of [TABLET_SCENE, PHONE_SCENE]) {
      const { lines, endMs } = inkTimeline(scene);
      expect(lines).toHaveLength(scene.lines.length);
      let last = 0;
      for (const line of lines) {
        for (const s of line.kid) {
          expect(s.atMs).toBeGreaterThanOrEqual(last);
          expect(s.forMs).toBeGreaterThanOrEqual(INK_PACE.minStrokeMs);
          expect(s.forMs).toBeLessThanOrEqual(INK_PACE.maxStrokeMs);
          last = s.atMs + s.forMs;
        }
        expect(line.check.atMs).toBe(last + INK_PACE.beforeCheckMs);
        last = line.check.atMs + line.check.forMs;
      }
      expect(endMs).toBe(last);
      // quick enough to watch to the end
      expect(endMs).toBeLessThan(8000);
    }
  });

  it("has every line written and checked, inside its picture", () => {
    for (const scene of [TABLET_SCENE, PHONE_SCENE]) {
      expect(scene.lines.length).toBeGreaterThan(1);
      for (const line of scene.lines) {
        expect(line.kid.length).toBeGreaterThan(0);
        for (const s of [...line.kid, line.check]) {
          const b = pathBounds(s.d);
          expect(b.minX).toBeGreaterThanOrEqual(0);
          expect(b.minY).toBeGreaterThanOrEqual(0);
          expect(b.maxX).toBeLessThanOrEqual(scene.width);
          expect(b.maxY).toBeLessThanOrEqual(scene.height);
          expect(s.len).toBeGreaterThan(0);
        }
      }
    }
  });

  it("has its screenshot in public, small enough for the page", () => {
    for (const scene of [TABLET_SCENE, PHONE_SCENE]) {
      const file = path.join(__dirname, "../../../../public", scene.image);
      expect(fs.existsSync(file), file).toBe(true);
      expect(scene.image).toMatch(/^\/landing\/v3\/devices-/);
      expect(fs.statSync(file).size).toBeLessThan(120_000);
    }
  });
});
