import { describe, expect, it } from "vitest";
import { sketchChart } from "../chart";
import { barScale } from "../chart/axes";
import type { ChartSpec } from "../contracts";
import { sketchDiagram } from "../diagram";
import type { DiagramSpec } from "../contracts";
import { LECTURE_BOXES } from "../plan";
import { partDiff, problemsOf } from "./gallery";

/**
 * LIVE: a chart or a diagram is planned again, with the same box and seed, every time the
 * lecturer says more; the desk writes only the parts that changed. These are the updates that must
 * stay small.
 */

const BOX = LECTURE_BOXES.visual[0];
const SEED = 4242;

const sales = (values: Array<number | null>): ChartSpec => ({ kind: "bar", title: "Sales this year", labels: ["Q1", "Q2", "Q3", "Q4"], series: [{ values }], unit: "$", yLabel: "Millions" });

/** The parts each step writes (new or changed). */
function steps<T>(specs: readonly T[], plan: (s: T) => ReturnType<typeof sketchChart>): Array<{ written: string[]; removed: string[] }> {
  const plans = specs.map((s) => plan(s));
  for (const p of plans) {
    expect(p).not.toBeNull();
    expect(problemsOf(p!, BOX)).toEqual([]);
  }
  return plans.slice(1).map((p, i) => {
    const d = partDiff(plans[i]!.plan, p!.plan);
    return { written: [...d.added, ...d.changed], removed: d.removed };
  });
}

describe("a live bar chart", () => {
  it("draws the quarters said so far, the rest as empty slots", () => {
    const sk = sketchChart(sales([12, null, null, null]), { seed: SEED, box: BOX })!;
    const parts = sk.plan.lines.map((l) => l.part);
    for (const q of ["Q1", "Q2", "Q3", "Q4"]) expect(parts).toContain(`label:${q}`);
    expect(parts).toContain("bar:Q1:0");
    expect(parts.filter((p) => p?.startsWith("bar:"))).toEqual(["bar:Q1:0"]);
  });

  it("writes only the new bar and its value as each quarter is said, and a correction as two parts", () => {
    const seq = [sales([12, null, null, null]), sales([12, 15, null, null]), sales([12, 15, 9, null]), sales([12, 16, 9, null]), sales([12, 16, 9, 22])];
    const d = steps(seq, (s) => sketchChart(s, { seed: SEED, box: BOX }));
    expect(d[0].written.sort()).toEqual(["bar:Q2:0", "value:Q2:0"]);
    expect(d[1].written.sort()).toEqual(["bar:Q3:0", "value:Q3:0"]);
    expect(d[2].written.sort()).toEqual(["bar:Q2:0", "value:Q2:0"]);
    for (const x of d.slice(0, 3)) expect(x.removed).toEqual([]);
    // 22 is past the axis's top (20): the axis grows and the bars are drawn again — a real overflow
    expect(barScale(12, 16).hi).toBe(20);
    expect(barScale(12, 22).hi).toBeGreaterThan(20);
    expect(d[3].written.length).toBeGreaterThan(3);
  });

  it("keeps its axis while a value lands under it, with a quarter to spare", () => {
    for (const first of [3, 7, 12, 40, 55, 150, 212, 0.4, 9000]) {
      const top = barScale(0, first).hi;
      expect(top).toBeGreaterThanOrEqual(first * 1.25);
      // every value up to the top less its headroom lands under the same axis
      for (const next of [first, (first + top / 1.25) / 2, top / 1.25]) expect(barScale(0, next), `${first} then ${next}`).toEqual(barScale(0, first));
    }
  });

  it("adds a second series' bar without moving the first's", () => {
    const one: ChartSpec = { kind: "bar", labels: ["2023", "2024"], series: [{ name: "North", values: [30, 32] }, { name: "South", values: [null, null] }] };
    const two: ChartSpec = { kind: "bar", labels: ["2023", "2024"], series: [{ name: "North", values: [30, 32] }, { name: "South", values: [25, null] }] };
    const d = steps([one, two], (s) => sketchChart(s, { seed: SEED, box: BOX }));
    expect(d[0].written.sort()).toEqual(["bar:2023:1", "value:2023:1"]);
  });

  it("adds a point and a segment to a live line", () => {
    const line = (values: Array<number | null>): ChartSpec => ({ kind: "line", labels: ["Mon", "Tue", "Wed", "Thu"], series: [{ values }], unit: "°C" });
    const d = steps([line([4, 6, null, null]), line([4, 6, 5, null])], (s) => sketchChart(s, { seed: SEED, box: BOX }));
    expect(d[0].written.sort()).toEqual(["point:Wed:0", "segment:0:Tue-Wed"]);
  });

  it("fills a table's empty cell as one part", () => {
    const table = (cell: string): ChartSpec => ({ kind: "table", columns: ["Element", "Symbol", "Number"], rows: [["Hydrogen", "H", "1"], ["Helium", "He", cell]] });
    const d = steps([table(""), table("2")], (s) => sketchChart(s, { seed: SEED, box: BOX }));
    expect(d[0].written).toEqual(["cell:2:2"]);
  });
});

describe("a live diagram", () => {
  const scientific = ["Ask a question", "Research", "Form a hypothesis", "Experiment", "Analyse the data", "Draw a conclusion", "Share results"];

  it("adds a step to a flow without moving the steps drawn", () => {
    const flow = (n: number): DiagramSpec => ({ kind: "flow", title: "The scientific method", steps: scientific.slice(0, n) });
    const d = steps([3, 4, 5, 6, 7].map(flow), (s) => sketchDiagram(s, { seed: SEED, box: BOX }));
    d.forEach((x, i) => {
      const n = i + 3;
      expect(x.written.sort(), `step ${n + 1}`).toEqual([`arrow:${n - 1}-${n}`, `node:${n}`, `node:${n}:text`].sort());
      expect(x.removed).toEqual([]);
    });
  });

  it("adds an event to a timeline without moving the events drawn", () => {
    const events = [
      { when: "1939", what: "War begins" },
      { when: "1940", what: "Battle of Britain" },
      { when: "1941", what: "Pearl Harbor" },
      { when: "1944", what: "D-Day" },
      { when: "1945", what: "War ends" },
    ];
    const tl = (n: number): DiagramSpec => ({ kind: "timeline", title: "World War II", events: events.slice(0, n) });
    const d = steps([2, 3, 4, 5].map(tl), (s) => sketchDiagram(s, { seed: SEED, box: BOX }));
    d.forEach((x, i) => {
      const n = i + 2;
      expect(x.written.sort(), `event ${n + 1}`).toEqual([`tick:${n}`, `what:${n}`, `when:${n}`].sort());
    });
  });

  it("names every part uniquely and plans the same for the same seed", () => {
    const a = sketchDiagram({ kind: "flow", steps: scientific }, { seed: 9, box: BOX })!;
    const b = sketchDiagram({ kind: "flow", steps: scientific }, { seed: 9, box: BOX })!;
    expect(b.plan).toEqual(a.plan);
    const parts = a.plan.lines.map((l) => l.part);
    expect(new Set(parts).size).toBe(parts.length);
  });
});
