import { describe, expect, it } from "vitest";
import { autoYRange, buildPlot, niceStep, niceTicks, percentile, type PlotInput } from "../graph/plot";

function input(over: Partial<PlotInput> = {}): PlotInput {
  return {
    fns: [],
    points: [],
    xMin: -10,
    xMax: 10,
    yMin: -10,
    yMax: 10,
    autoY: true,
    grid: true,
    w: 240,
    h: 178,
    ...over,
  };
}

function isNiceStep(step: number): boolean {
  const exp = Math.floor(Math.log10(step));
  const mant = Number((step / Math.pow(10, exp)).toPrecision(6));
  return [1, 2, 5].includes(mant);
}

describe("niceTicks", () => {
  it("niceTicks(-3.2, 7.9) uses a 1/2/5 x 10^n step and covers the range", () => {
    const ticks = niceTicks(-3.2, 7.9);
    expect(ticks.length).toBeGreaterThanOrEqual(4);
    expect(ticks.length).toBeLessThanOrEqual(12);
    const step = ticks[1] - ticks[0];
    expect(isNiceStep(step)).toBe(true);
    expect(ticks[0]).toBeGreaterThanOrEqual(-3.2);
    expect(ticks[ticks.length - 1]).toBeLessThanOrEqual(7.9);
    expect(ticks).toContain(0);
    // evenly spaced
    for (let i = 2; i < ticks.length; i++) expect(ticks[i] - ticks[i - 1]).toBeCloseTo(step, 9);
  });

  it("handles small, large and reversed ranges", () => {
    expect(niceTicks(0, 0.05).every((t) => t >= 0 && t <= 0.05)).toBe(true);
    expect(niceTicks(0, 1e6).length).toBeGreaterThan(2);
    expect(niceTicks(5, -5)).toEqual(niceTicks(-5, 5));
    expect(niceTicks(NaN, 1)).toEqual([]);
    expect(niceTicks(2, 2)).toEqual([2]);
  });

  it("niceStep rounds up to 1, 2 or 5 times a power of ten", () => {
    expect(niceStep(1.85)).toBe(2);
    expect(niceStep(0.3)).toBe(0.5);
    expect(niceStep(7)).toBe(10);
    expect(niceStep(120)).toBe(200);
    expect(niceStep(0)).toBe(1);
  });
});

describe("autoYRange", () => {
  it("picks a padded 5th-95th percentile range", () => {
    const values = Array.from({ length: 101 }, (_, i) => i); // 0..100
    expect(percentile([...values], 0.05)).toBeCloseTo(5);
    expect(percentile([...values], 0.95)).toBeCloseTo(95);
    const [lo, hi] = autoYRange(values, -10, 10);
    // 5..95 padded by 10 % (9) -> [-4, 104] then lo snapped to 0 (x-axis is close)
    expect(lo).toBeLessThanOrEqual(0);
    expect(lo).toBeGreaterThanOrEqual(-4.01);
    expect(hi).toBeCloseTo(104, 5);
  });

  it("ignores outliers (asymptote samples) and non-finite values", () => {
    const values = [...Array.from({ length: 200 }, (_, i) => Math.sin(i / 10)), 1e9, -1e9, NaN, Infinity];
    const [lo, hi] = autoYRange(values, -10, 10);
    expect(lo).toBeGreaterThan(-2);
    expect(hi).toBeLessThan(2);
  });

  it("falls back to the given range when nothing is finite, and pads flat functions", () => {
    expect(autoYRange([NaN, Infinity], -3, 4)).toEqual([-3, 4]);
    const [lo, hi] = autoYRange([2, 2, 2], -10, 10);
    expect(lo).toBeLessThan(2);
    expect(hi).toBeGreaterThan(2);
  });
});

describe("buildPlot", () => {
  it("renders axes only when no sampler has resolved yet", () => {
    const out = buildPlot(input({ fns: [{ id: "f", sampler: null, color: "#000" }], autoY: true }));
    expect(out.paths).toEqual([]);
    expect(out.axes.x0).not.toBeNull();
    expect(out.axes.y0).not.toBeNull();
    expect(out.yRange).toEqual([-10, 10]);
    expect(out.ticks.x.length).toBeGreaterThan(0);
    expect(out.gridLines.length).toBeGreaterThan(0);
  });

  it("draws x^2 as one continuous path with autoY", () => {
    const out = buildPlot(input({ fns: [{ id: "sq", sampler: (x) => x * x, color: "#2563eb" }] }));
    expect(out.paths).toHaveLength(1);
    expect(out.paths[0].segments).toBe(1);
    expect(out.paths[0].color).toBe("#2563eb");
    expect(out.paths[0].d.startsWith("M")).toBe(true);
    expect((out.paths[0].d.match(/L/g) ?? []).length).toBeGreaterThan(200);
    expect(out.yRange[0]).toBeLessThanOrEqual(0);
    expect(out.yRange[1]).toBeGreaterThan(50);
  });

  it("breaks the path at the asymptote of 1/x", () => {
    const out = buildPlot(input({ fns: [{ id: "inv", sampler: (x) => 1 / x, color: "#000" }] }));
    expect(out.paths).toHaveLength(1);
    expect(out.paths[0].segments).toBe(2);
    expect((out.paths[0].d.match(/M/g) ?? []).length).toBe(2);
  });

  it("breaks tan(x) at every asymptote in [-10, 10]", () => {
    const out = buildPlot(input({ fns: [{ id: "tan", sampler: Math.tan, color: "#000" }] }));
    // asymptotes at +-pi/2, +-3pi/2, +-5pi/2 -> 7 continuous runs
    expect(out.paths[0].segments).toBe(7);
  });

  it("breaks where the sampler returns non-finite values (sqrt, log)", () => {
    const out = buildPlot(input({ fns: [{ id: "sqrt", sampler: Math.sqrt, color: "#000" }] }));
    expect(out.paths[0].segments).toBe(1);
    // only the x >= 0 half is drawn: first M is at/after the middle of the plot
    const firstX = Number(/M([\d.]+)/.exec(out.paths[0].d)?.[1]);
    expect(firstX).toBeGreaterThanOrEqual(out.w / 2 - 2);
    const none = buildPlot(input({ fns: [{ id: "nan", sampler: () => NaN, color: "#000" }] }));
    expect(none.paths).toEqual([]);
  });

  it("honours a fixed y-range and reports off-screen axes as null", () => {
    const out = buildPlot(input({ autoY: false, yMin: 2, yMax: 8, xMin: 1, xMax: 5 }));
    expect(out.yRange).toEqual([2, 8]);
    expect(out.axes.x0).toBeNull();
    expect(out.axes.y0).toBeNull();
    expect(out.ticks.y.every((t) => t >= 2 && t <= 8)).toBe(true);
  });

  it("projects points and keeps them inside the plot area", () => {
    const out = buildPlot(
      input({ autoY: false, points: [{ x: 0, y: 0, label: "O" }, { x: 5, y: 5, label: "" }, { x: NaN, y: 1, label: "bad" }] }),
    );
    expect(out.points).toHaveLength(2);
    expect(out.points[0].cx).toBeCloseTo(out.w / 2, 5);
    expect(out.points[0].cy).toBeCloseTo(out.h / 2, 5);
    expect(out.points[1].cx).toBeGreaterThan(out.points[0].cx);
    expect(out.points[1].cy).toBeLessThan(out.points[0].cy);
    expect(out.points[0].label).toBe("O");
  });

  it("omits grid lines when grid is off and supports several functions", () => {
    const out = buildPlot(
      input({
        grid: false,
        fns: [
          { id: "a", sampler: (x) => x, color: "#111" },
          { id: "b", sampler: (x) => -x, color: "#222" },
          { id: "c", sampler: null, color: "#333" },
        ],
      }),
    );
    expect(out.gridLines).toEqual([]);
    expect(out.paths.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("never throws on degenerate input", () => {
    expect(() => buildPlot(input({ xMin: 3, xMax: 3, w: 0, h: 0 }))).not.toThrow();
    expect(() => buildPlot(input({ xMin: NaN, xMax: NaN }))).not.toThrow();
    const out = buildPlot(
      input({
        fns: [
          {
            id: "throws",
            sampler: () => {
              throw new Error("boom");
            },
            color: "#000",
          },
        ],
      }),
    );
    expect(out.paths).toEqual([]);
  });
});
