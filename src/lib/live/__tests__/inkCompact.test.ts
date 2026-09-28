import { describe, expect, it } from "vitest";
import { INK_PRECISION, roundInk, roundInkPoints } from "../inkCompact";

describe("inkCompact: the tutor's ink at tldraw's own precision", () => {
  it("rounds to 1/100 px by default", () => {
    expect(INK_PRECISION).toBe(100);
    expect(roundInk(12.345678)).toBe(12.35);
    expect(roundInk(-3.14159)).toBe(-3.14);
    expect(roundInk(7)).toBe(7);
    expect(roundInk(0.1 + 0.2)).toBe(0.3);
  });

  it("never writes -0, and leaves what is not a finite number alone", () => {
    expect(Object.is(roundInk(-0.001), 0)).toBe(true);
    expect(roundInk(Number.NaN)).toBeNaN();
    expect(roundInk(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
  });

  it("keeps full precision at precision 0", () => {
    expect(roundInk(1.23456789, 0)).toBe(1.23456789);
    const pts = [{ x: 1.23456789, y: 2.3456789, z: 0.456789 }];
    const out = roundInkPoints(pts, 0);
    expect(out).toEqual(pts);
    expect(out[0]).not.toBe(pts[0]);
  });

  it("rounds x and y to the precision and the pressure to two decimals", () => {
    expect(roundInkPoints([{ x: 1.23456, y: 9.87654, z: 0.456789 }])).toEqual([{ x: 1.23, y: 9.88, z: 0.46 }]);
    expect(roundInkPoints([{ x: 1.23456, y: 9.87654, z: 0.456789 }], 10)).toEqual([{ x: 1.2, y: 9.9, z: 0.46 }]);
  });

  it("keeps every point: which points are stored changes what tldraw draws", () => {
    const pts = Array.from({ length: 50 }, (_, i) => ({ x: i * 2 + 0.001, y: 5.000001, z: 0.5 }));
    expect(roundInkPoints(pts)).toHaveLength(50);
  });
});
