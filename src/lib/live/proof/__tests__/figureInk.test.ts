import { describe, expect, it } from "vitest";
import { boundsOf, labelAt, Pen } from "@/__eval__/drawings";
import { buildFigure } from "../figure";
import { figureFromInk, type InkLabel } from "../figureInk";

type P = { x: number; y: number };
const G = 20;

/** Straight strokes through these points, and a letter beside each named point. */
function figure(points: Record<string, P>, strokes: string[], labelOffset: Record<string, [number, number]> = {}, seed = 1) {
  const pen = new Pen("fig", seed);
  const ink = strokes.map((s) => pen.stroke(...[...s].map((k) => points[k])));
  const labels: InkLabel[] = Object.entries(points).map(([name, p]) => {
    const [dx, dy] = labelOffset[name] ?? [-22, -22];
    return { text: name, bounds: boundsOf(labelAt(name, p.x + dx, p.y + dy)) };
  });
  return { ink, labels };
}
const sortLines = (lines: readonly string[]) => lines.map((l) => (l < [...l].reverse().join("") ? l : [...l].reverse().join(""))).sort();

describe("reading a proof's figure from its ink", () => {
  it("two segments crossing at a labelled point are two lines through it", () => {
    const P = { A: { x: 100, y: 100 }, B: { x: 100, y: 400 }, C: { x: 400, y: 100 }, D: { x: 400, y: 400 }, E: { x: 250, y: 250 } };
    const { ink, labels } = figure(P, ["AD", "BC", "AB", "CD"], { E: [30, 0], C: [22, -22], D: [22, 22], B: [-22, 22] });
    const read = figureFromInk(ink, labels, G)!;
    expect(sortLines(read.lines)).toEqual(sortLines(["AED", "BEC", "AB", "CD"]));
    expect(Object.keys(read.points).sort()).toEqual(["A", "B", "C", "D", "E"]);
    const fig = buildFigure(read);
    expect(fig.vertical.length).toBeGreaterThan(0);
    expect(fig.triangles.map((t) => [...t].sort().join("")).sort()).toEqual(expect.arrayContaining(["ABE", "CDE"]));
  });

  it("a letter written on the crossing (kept as a mark, never read) is the one point the proof names that no label does", () => {
    const P = { A: { x: 100, y: 100 }, B: { x: 100, y: 400 }, C: { x: 400, y: 100 }, D: { x: 400, y: 400 }, E: { x: 250, y: 250 } };
    const { ink, labels } = figure(P, ["AD", "BC", "AB", "CD"], { C: [22, -22], D: [22, 22], B: [-22, 22] });
    const read4 = labels.filter((l) => l.text !== "E");
    // without the proof's names the crossing stays unnamed
    expect(sortLines(figureFromInk(ink, read4, G)!.lines)).toEqual(sortLines(["AD", "BC", "AB", "CD"]));
    const read = figureFromInk(ink, read4, G, ["A", "B", "C", "D", "E"])!;
    expect(sortLines(read.lines)).toEqual(sortLines(["AED", "BEC", "AB", "CD"]));
    expect(buildFigure(read).vertical.length).toBeGreaterThan(0);
    // two names missing: nothing is guessed
    expect(sortLines(figureFromInk(ink, read4, G, ["A", "B", "C", "D", "E", "F"])!.lines)).toEqual(sortLines(["AD", "BC", "AB", "CD"]));
  });

  it("a triangle in one stroke, and a point on a side, and an altitude", () => {
    const P = { A: { x: 100, y: 400 }, B: { x: 250, y: 100 }, C: { x: 400, y: 400 }, D: { x: 250, y: 400 } };
    const { ink, labels } = figure(P, ["ABCA", "BD"], { A: [-22, 10], C: [22, 10], D: [0, 26], B: [0, -26] });
    const read = figureFromInk(ink, labels, G)!;
    expect(sortLines(read.lines)).toEqual(sortLines(["AB", "BC", "ADC", "BD"]));
  });

  it("a numbered angle names the angle whose sector it sits in", () => {
    const P = { A: { x: 100, y: 250 }, E: { x: 250, y: 250 }, B: { x: 400, y: 250 }, C: { x: 180, y: 100 }, D: { x: 320, y: 400 } };
    const { ink, labels } = figure(P, ["AB", "CD"], { A: [-22, 0], B: [22, 0], C: [0, -22], D: [0, 22], E: [22, -24] });
    // `1` between the rays E→A and E→C (up and to the left of E)
    labels.push({ text: "1", bounds: boundsOf(labelAt("1", 222, 222)) });
    const read = figureFromInk(ink, labels, G)!;
    expect(read.angles?.["1"]).toMatch(/^(AEC|CEA)$/);
  });

  it("nothing to read: fewer than three named points", () => {
    const P = { A: { x: 100, y: 100 }, B: { x: 400, y: 100 } };
    const { ink, labels } = figure(P, ["AB"]);
    expect(figureFromInk(ink, labels, G)).toBeNull();
  });
});
