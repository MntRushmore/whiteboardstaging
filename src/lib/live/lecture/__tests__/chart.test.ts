import { describe, expect, it } from "vitest";
import { sketchChart } from "../chart";
import { formatNumber, formatValue, niceStepAtMost, valueScale } from "../chart/axes";
import { leastSquares } from "../chart/scatter";
import { ChartSpecSchema, type ChartSpec } from "../contracts";
import { LECTURE_BOXES } from "../plan";
import { CHART_GALLERY, problemsOf, wallMs } from "./gallery";

const BIG = LECTURE_BOXES.visual[0];
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const long = (i: number) => `A rather long category ${i + 1}`.slice(0, 28);

/** The hard cases: the most of everything the contract allows. */
const EXTREME: ReadonlyArray<{ title: string; spec: ChartSpec }> = [
  { title: "bar: 12 categories, big numbers", spec: { kind: "bar", title: "A title that runs on for quite a long way here", labels: months, series: [{ values: months.map((_, i) => (i + 1) * 1234.5) }], yLabel: "Something measured", unit: "kg" } },
  { title: "bar: 6 long labels", spec: { kind: "bar", labels: months.slice(0, 6).map((_, i) => long(i)), series: [{ values: [3, 1, 4, 1, 5, 9] }], yLabel: "Something measured" } },
  {
    title: "bar: 3 series x 12, negatives",
    spec: {
      kind: "bar",
      labels: months,
      series: [0, 1, 2].map((j) => ({ name: `Series number ${j + 1}`, values: months.map((_, i) => Math.round(Math.sin(i + j) * 100)) })),
      unit: "%",
      xLabel: "Month of the year",
      yLabel: "Change",
    },
  },
  { title: "bar: all zero", spec: { kind: "bar", labels: ["A", "B"], series: [{ values: [0, 0] }] } },
  { title: "bar: all negative", spec: { kind: "bar", labels: ["North", "South", "East"], series: [{ values: [-5, -12, -3.5] }], unit: "°C" } },
  { title: "bar: tiny and huge", spec: { kind: "bar", labels: ["Ant", "Whale"], series: [{ values: [0.003, 150000000] }], unit: "$" } },
  { title: "line: 12 points, 3 series", spec: { kind: "line", title: "Monthly rainfall", labels: months, series: [0, 1, 2].map((j) => ({ name: ["London", "Paris", "Rome"][j], values: months.map((_, i) => 40 + 30 * Math.sin(i / 2 + j)) })), unit: "mm" } },
  { title: "line: flat", spec: { kind: "line", labels: ["Mon", "Tue", "Wed"], series: [{ values: [7, 7, 7] }] } },
  {
    title: "pie: eight slices, slivers",
    spec: {
      kind: "pie",
      title: "Where the money goes",
      slices: [
        { label: "Health and social care", value: 40 },
        { label: "Pensions", value: 25 },
        { label: "Education", value: 15 },
        { label: "Defence", value: 10 },
        { label: "Transport", value: 6 },
        { label: "Culture", value: 2 },
        { label: "Libraries", value: 1.5 },
        { label: "Parks", value: 0.5 },
      ],
    },
  },
  { title: "pie: two equal", spec: { kind: "pie", slices: [{ label: "Heads", value: 1 }, { label: "Tails", value: 1 }] } },
  { title: "scatter: 40 points, far from 0", spec: { kind: "scatter", title: "Height and weight", points: Array.from({ length: 40 }, (_, i) => ({ x: 150 + i, y: 50 + i * 0.8 + ((i * 7) % 5) })), xLabel: "Height (cm)", yLabel: "Weight (kg)", trend: true } },
  { title: "scatter: one x", spec: { kind: "scatter", points: [{ x: 2, y: 1 }, { x: 2, y: 3 }, { x: 2, y: 5 }], trend: true } },
  { title: "scatter: negatives", spec: { kind: "scatter", points: [{ x: -3, y: -2 }, { x: 0, y: 1 }, { x: 4, y: -6 }, { x: 2.5, y: 3 }] } },
  {
    title: "table: 4 x 6, long cells",
    spec: {
      kind: "table",
      title: "Comparing the planets",
      columns: ["Planet", "Distance from Sun", "Moons", "Notable feature"],
      rows: [
        ["Mercury", "58 million km", "0", "Closest to the Sun"],
        ["Venus", "108 million km", "0", "Hottest planet"],
        ["Earth", "150 million km", "1", "Liquid water"],
        ["Mars", "228 million km", "2", "Red iron dust"],
        ["Jupiter", "778 million km", "95", "Great Red Spot"],
        ["Saturn", "1.4 billion km", "146", "Bright rings of ice"],
      ],
    },
  },
];

describe("chart numbers", () => {
  it("writes numbers and units as a teacher does", () => {
    expect(formatNumber(12)).toBe("12");
    expect(formatNumber(3.14159)).toBe("3.14");
    expect(formatNumber(-0.25)).toBe("-0.25");
    expect(formatNumber(12500)).toBe("12,500");
    expect(formatNumber(2400000)).toBe("2.4M");
    expect(formatValue(12, "$")).toBe("$12");
    expect(formatValue(-12, "$")).toBe("-$12");
    expect(formatValue(45, "%")).toBe("45%");
    expect(formatValue(21, "°C")).toBe("21°C");
    expect(formatValue(3, "kg")).toBe("3 kg");
  });

  it("chooses a few round ticks, 0 on a bar's axis", () => {
    expect(valueScale(41, 55, 6, true)).toMatchObject({ lo: 0, hi: 60, step: 10 });
    const line = valueScale(50.1, 67.1, 5, false);
    expect(line.ticks.length).toBeLessThanOrEqual(6);
    expect(line.lo).toBeLessThanOrEqual(50.1);
    expect(line.hi).toBeGreaterThanOrEqual(67.1);
    expect(valueScale(-4, 9, 5, true).ticks).toContain(0);
    expect(valueScale(5, 5, 5, true)).toMatchObject({ lo: 0 });
    expect(valueScale(5, 5, 5, true).hi).toBeGreaterThanOrEqual(5);
    expect(valueScale(0, 0, 5, true)).toMatchObject({ lo: 0, hi: 1 });
    expect(niceStepAtMost(0, 212, 5)).toBe(50);
  });

  it("fits a least-squares line", () => {
    const fit = leastSquares([{ x: 0, y: 1 }, { x: 1, y: 3 }, { x: 2, y: 5 }])!;
    expect(fit.a).toBeCloseTo(1, 9);
    expect(fit.b).toBeCloseTo(2, 9);
    expect(leastSquares([{ x: 1, y: 1 }, { x: 1, y: 2 }])).toBeNull();
  });
});

describe("planChart", () => {
  const all = [...CHART_GALLERY, ...EXTREME];

  it("every spec here is one the director may send", () => {
    for (const c of all) expect(ChartSpecSchema.safeParse(c.spec).success, c.title).toBe(true);
  });

  it("draws every typical and extreme chart in the big box: clean, in time", () => {
    for (const [i, c] of all.entries()) {
      const sk = sketchChart(c.spec, { seed: 100 + i, box: BIG });
      expect(sk, c.title).not.toBeNull();
      expect(problemsOf(sk!, BIG), c.title).toEqual([]);
      expect(wallMs(sk!), c.title).toBeLessThanOrEqual(7500);
      expect(wallMs(sk!), c.title).toBeGreaterThanOrEqual(1500);
    }
  });

  it("in the smaller boxes: clean when drawn, and the typical ones still drawn", () => {
    for (const box of LECTURE_BOXES.visual.slice(1)) {
      let drawn = 0;
      for (const [i, c] of CHART_GALLERY.entries()) {
        const sk = sketchChart(c.spec, { seed: 7 + i, box });
        if (!sk) continue;
        drawn++;
        expect(problemsOf(sk, box), `${c.title} in ${box.w}×${box.h}`).toEqual([]);
      }
      expect(drawn, `${box.w}×${box.h}`).toBeGreaterThanOrEqual(Math.ceil(CHART_GALLERY.length * (box.w >= 440 ? 0.9 : 0.6)));
    }
  });

  it("is the same sketch for the same seed", () => {
    for (const c of CHART_GALLERY) {
      const a = sketchChart(c.spec, { seed: 5, box: BIG });
      const b = sketchChart(c.spec, { seed: 5, box: BIG });
      expect(b, c.title).toEqual(a);
    }
  });

  it("tells series apart by pattern, and keys them", () => {
    const sk = sketchChart(CHART_GALLERY[2].spec, { seed: 1, box: BIG })!;
    for (const name of ["Oslo", "Rome", "Cairo"]) expect(sk.texts.map((t) => t.text)).toContain(name);
    const single = sketchChart(CHART_GALLERY[0].spec, { seed: 1, box: BIG })!;
    expect(single.texts.map((t) => t.text)).toContain("55 mm");
  });

  it("writes a pie's percentages so they add up to 100", () => {
    const sk = sketchChart(CHART_GALLERY[8].spec, { seed: 1, box: BIG })!;
    const pcts = sk.texts.map((t) => /(\d+)%$/.exec(t.text)?.[1]).filter(Boolean).map(Number);
    expect(pcts).toHaveLength(5);
    expect(pcts.reduce((a, b) => a + b, 0)).toBe(100);
    // slivers merge into "Other"
    const merged = sketchChart(EXTREME.find((e) => e.title.startsWith("pie: eight"))!.spec, { seed: 1, box: BIG })!;
    expect(merged.texts.some((t) => t.text.startsWith("Other"))).toBe(true);
    expect(merged.texts.some((t) => t.text.startsWith("Parks"))).toBe(false);
  });

  it("never drops a word: every category, cell and name is written whole", () => {
    for (const [i, c] of all.entries()) {
      const sk = sketchChart(c.spec, { seed: 100 + i, box: BIG })!;
      const written = sk.texts.map((t) => t.text).join(" | ");
      const s = c.spec;
      const words = s.kind === "table" ? [...s.columns, ...s.rows.flat()] : s.kind === "pie" ? [] : s.kind === "scatter" ? [s.xLabel, s.yLabel] : [...s.labels, s.xLabel];
      for (const w of words) if (w) expect(written, `${c.title}: ${w}`).toContain(w.replace(/\s+/g, " ").replace(/[’]/g, "'"));
    }
  });

  it("keeps a bar's value ≥ 6 px from its neighbour's", () => {
    for (const [i, c] of all.entries()) {
      const sk = sketchChart(c.spec, { seed: 100 + i, box: BIG })!;
      const values = sk.texts.filter((t) => t.part.startsWith("value:"));
      for (let a = 0; a < values.length; a++)
        for (let b = a + 1; b < values.length; b++) {
          const p = values[a].rect;
          const q = values[b].rect;
          const apart = Math.max(q.x - (p.x + p.w), p.x - (q.x + q.w), q.y - (p.y + p.h), p.y - (q.y + q.h));
          expect(apart, `${c.title}: ${values[a].text} / ${values[b].text}`).toBeGreaterThanOrEqual(6);
        }
    }
  });

  it("is null when the box is too small for the hand to draw it well", () => {
    expect(sketchChart(EXTREME[2].spec, { seed: 1, box: { w: 200, h: 150 } })).toBeNull();
    expect(sketchChart(CHART_GALLERY[11].spec, { seed: 1, box: { w: 160, h: 120 } })).toBeNull();
    expect(sketchChart(CHART_GALLERY[8].spec, { seed: 1, box: { w: 120, h: 90 } })).toBeNull();
  });
});
