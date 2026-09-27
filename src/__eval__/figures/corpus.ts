/**
 * The FIGURE corpus: hand-drawn geometry figures a student labels and leaves for the tutor to solve,
 * generated as strokes by the drawings scoreboard's wobbling pen (`Pen`, `labelAt` and the geometry
 * marks in ../drawings.ts). Each figure carries:
 *
 *  - its strokes (lines, arcs, right-angle boxes, tick marks, arrow marks) and its labels, each
 *    label written in the tutor's hand as a student writes it (`labelAt`);
 *  - the labels as the recognizer reads them when it reads them right (what the board sends);
 *  - the answer (the unknown and its value);
 *  - a GOLD read: the quantities and facts a careful reader would give — `planFigure` on it must
 *    give the answer (checked offline in figures.test.ts, with no model).
 *
 * One configuration per figure (`config`), across what a geometry course draws: a triangle's angles,
 * an exterior angle, a straight line, vertical angles, angles round a point, parallel lines and a
 * transversal, isosceles and equilateral triangles, right angles and Pythagoras, polygons, regular
 * polygons, circles (inscribed and central angles, a tangent, a semicircle, a cyclic quadrilateral),
 * similar triangles and a midsegment.
 */
import type { InkStroke } from "@/lib/live/contracts";
import { angleArc, angleLabel, arrowMark, labelAt, Pen, rightAngleBox, tickMarks } from "../drawings";

type Pt = { x: number; y: number };

export type FigureConfig =
  | "triangle"
  | "exterior angle"
  | "straight line"
  | "vertical angles"
  | "around a point"
  | "parallel lines"
  | "isosceles"
  | "equilateral"
  | "right angle"
  | "pythagoras"
  | "polygon"
  | "regular polygon"
  | "exterior angles"
  | "inscribed & central"
  | "tangent"
  | "semicircle"
  | "cyclic & same arc"
  | "similar"
  | "midsegment";

export interface GoldQuantity {
  id: string;
  what: "angle" | "length";
  label: string | null;
}

export interface FigureCase {
  id: string;
  config: FigureConfig;
  title: string;
  /** the figure's own strokes and the marks on it */
  strokes: InkStroke[];
  /** each label: what the recognizer reads, and its strokes */
  labels: Array<{ latex: string; strokes: InkStroke[] }>;
  answer: { letter: string; value: number };
  gold: { quantities: GoldQuantity[]; facts: Array<Record<string, unknown>> };
}

const A = (id: string, label: string | null = null): GoldQuantity => ({ id, what: "angle", label });
const S = (id: string, label: string | null = null): GoldQuantity => ({ id, what: "length", label });
const P = (x: number, y: number): Pt => ({ x, y });
const lab = (latex: string, strokes: InkStroke[]) => ({ latex, strokes });

/** A side's label: at its middle, `off` px out from the figure's centre `c`. */
function sideLabel(latex: string, a: Pt, b: Pt, c: Pt, off = 26) {
  const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const d = Math.hypot(m.x - c.x, m.y - c.y) || 1;
  return lab(latex, labelAt(latex, m.x + ((m.x - c.x) / d) * off, m.y + ((m.y - c.y) / d) * off));
}

/** An angle's label and its arc (the arc as one of the figure's marks). */
function angle(pen: Pen, strokes: InkStroke[], latex: string, v: Pt, p: Pt, q: Pt, d?: number, arc = true) {
  if (arc) strokes.push(angleArc(pen, v, p, q, 18));
  return lab(latex, angleLabel(latex, v, p, q, d));
}

const centroid = (...pts: Pt[]): Pt => ({ x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length });
const along = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

// ---------------------------------------------------------------- the figures

type Maker = (seed: number) => Omit<FigureCase, "id" | "config">;

function triangle3(la: string, lb: string, lc: string, answer: number, seed: number): ReturnType<Maker> {
  const pen = new Pen(`tri${seed}`, seed);
  const a = P(170, 20), b = P(20, 240), c = P(330, 240);
  const strokes = [pen.stroke(a, b), pen.stroke(b, c), pen.stroke(c, P(a.x + 2, a.y - 2))];
  const labels = [angle(pen, strokes, la, a, b, c), angle(pen, strokes, lb, b, a, c), angle(pen, strokes, lc, c, a, b)];
  const letter = [la, lb, lc].find((l) => /[a-z\\?]/.test(l.replace(/\^\{\\circ\}/g, "")))!;
  return {
    title: `triangle ${la}, ${lb}, ${lc}`,
    strokes,
    labels,
    answer: { letter: /\\theta/.test(letter) ? "\\theta" : "x", value: answer },
    gold: { quantities: [A("a", la), A("b", lb), A("c", lc)], facts: [{ type: "triangle", items: ["a", "b", "c"] }] },
  };
}

/** Two lines marked parallel (arrows) cut by a transversal; `at` picks the labelled angles: [crossing 1|2, UL|UR|BL|BR]. */
function parallels(seed: number, first: [1 | 2, string, string], second: [1 | 2, string, string], gold: ReturnType<Maker>["gold"], value: number, title: string): ReturnType<Maker> {
  const pen = new Pen(`par${seed}`, seed);
  const l1a = P(10, 90), l1b = P(340, 90), l2a = P(10, 210), l2b = P(340, 210);
  const ta = P(110, 20), tb = P(250, 280);
  const cross = (y: number) => along(ta, tb, (y - ta.y) / (tb.y - ta.y));
  const x1 = cross(90), x2 = cross(210);
  const strokes = [pen.stroke(l1a, l1b), pen.stroke(l2a, l2b), pen.stroke(ta, tb), arrowMark(pen, l1a, l1b, 0.8), arrowMark(pen, l2a, l2b, 0.8)];
  const region = (c: 1 | 2, r: string): [Pt, Pt, Pt] => {
    const v = c === 1 ? x1 : x2;
    const left = c === 1 ? l1a : l2a;
    const right = c === 1 ? l1b : l2b;
    const up = ta;
    const down = tb;
    switch (r) {
      case "UL":
        return [v, left, up];
      case "UR":
        return [v, up, right];
      case "BR":
        return [v, right, down];
      default:
        return [v, down, left];
    }
  };
  const labels = [first, second].map(([c, r, latex]) => {
    const [v, p, q] = region(c, r);
    return angle(pen, strokes, latex, v, p, q);
  });
  return { title, strokes, labels, answer: { letter: "x", value }, gold };
}

const MAKERS: Array<[FigureConfig, Maker]> = [
  // ---------------- a triangle's angles
  ["triangle", (seed) => triangle3("40^{\\circ}", "65^{\\circ}", "x", 75, seed)],
  ["triangle", (seed) => triangle3("58^{\\circ}", "x", "47^{\\circ}", 75, seed)],
  ["triangle", (seed) => triangle3("2x", "x", "30^{\\circ}", 50, seed)],
  ["triangle", (seed) => triangle3("\\theta", "50^{\\circ}", "60^{\\circ}", 70, seed)],

  // ---------------- exterior angle (the base extended)
  ...(["x", "120^{\\circ}"] as const).map(
    (ext): [FigureConfig, Maker] => [
      "exterior angle",
      (seed) => {
        const pen = new Pen(`ext${seed}`, seed);
        const a = P(140, 20), b = P(20, 220), c = P(250, 220), d = P(350, 220);
        const strokes = [pen.stroke(a, b), pen.stroke(b, d), pen.stroke(c, a)];
        const exterior = ext === "x";
        const labels = [
          angle(pen, strokes, exterior ? "40^{\\circ}" : "x", a, b, c),
          angle(pen, strokes, exterior ? "65^{\\circ}" : "50^{\\circ}", b, a, c),
          angle(pen, strokes, ext, c, d, a, 44),
        ];
        return {
          title: exterior ? "exterior angle x, remote 40°, 65°" : "exterior angle 120°, remote x, 50°",
          strokes,
          labels,
          answer: { letter: "x", value: exterior ? 105 : 70 },
          gold: {
            quantities: [A("r1", labels[0].latex), A("r2", labels[1].latex), A("e", ext)],
            facts: [{ type: "exterior_angle", items: ["e", "r1", "r2"] }],
          },
        };
      },
    ],
  ),

  // ---------------- angles on a straight line
  [
    "straight line",
    (seed) => {
      const pen = new Pen(`sl${seed}`, seed);
      const l = P(10, 200), r = P(340, 200), v = P(180, 200), ray = P(270, 40);
      const strokes = [pen.stroke(l, r), pen.stroke(v, ray)];
      const labels = [angle(pen, strokes, "130^{\\circ}", v, l, ray), angle(pen, strokes, "x", v, ray, r)];
      return {
        title: "a straight line, 130° and x",
        strokes,
        labels,
        answer: { letter: "x", value: 50 },
        gold: { quantities: [A("a", "130^{\\circ}"), A("b", "x")], facts: [{ type: "straight_line", items: ["a", "b"] }] },
      };
    },
  ],
  [
    "straight line",
    (seed) => {
      const pen = new Pen(`sl${seed}`, seed);
      const l = P(10, 200), r = P(340, 200), v = P(175, 200), r1 = P(60, 50), r2 = P(300, 60);
      const strokes = [pen.stroke(l, r), pen.stroke(v, r1), pen.stroke(v, r2)];
      const labels = [angle(pen, strokes, "x", v, l, r1), angle(pen, strokes, "50^{\\circ}", v, r1, r2), angle(pen, strokes, "60^{\\circ}", v, r2, r)];
      return {
        title: "three angles on a straight line: x, 50°, 60°",
        strokes,
        labels,
        answer: { letter: "x", value: 70 },
        gold: { quantities: [A("a", "x"), A("b", "50^{\\circ}"), A("c", "60^{\\circ}")], facts: [{ type: "straight_line", items: ["a", "b", "c"] }] },
      };
    },
  ],
  [
    "straight line",
    (seed) => {
      const pen = new Pen(`sl${seed}`, seed);
      const l = P(10, 190), r = P(340, 190), v = P(160, 190), ray = P(60, 40);
      const strokes = [pen.stroke(l, r), pen.stroke(v, ray)];
      const labels = [angle(pen, strokes, "65^{\\circ}", v, l, ray), angle(pen, strokes, "?", v, ray, r)];
      return {
        title: "a straight line, 65° and ?",
        strokes,
        labels,
        answer: { letter: "x", value: 115 },
        gold: { quantities: [A("a", "65^{\\circ}"), A("b", "?")], facts: [{ type: "straight_line", items: ["a", "b"] }] },
      };
    },
  ],

  // ---------------- vertical angles (two lines crossing)
  ...(
    [
      ["2x + 10", "70^{\\circ}", 30, "top", "bottom"],
      ["x", "115^{\\circ}", 115, "left", "right"],
      ["3x - 20", "2x + 10", 30, "top", "bottom"],
    ] as const
  ).map(
    ([la, lb, value, ra, rb]): [FigureConfig, Maker] => [
      "vertical angles",
      (seed) => {
        const pen = new Pen(`va${seed}`, seed);
        const p1 = P(20, 50), p2 = P(330, 230), q1 = P(20, 230), q2 = P(330, 50), v = P(175, 140);
        const strokes = [pen.stroke(p1, p2), pen.stroke(q1, q2)];
        const region = (r: string): [Pt, Pt] => (r === "top" ? [p1, q2] : r === "bottom" ? [q1, p2] : r === "left" ? [p1, q1] : [q2, p2]);
        const labels = [angle(pen, strokes, la, v, ...region(ra)), angle(pen, strokes, lb, v, ...region(rb))];
        return {
          title: `vertical angles ${la} and ${lb}`,
          strokes,
          labels,
          answer: { letter: "x", value },
          gold: { quantities: [A("a", la), A("b", lb)], facts: [{ type: "vertical", items: ["a", "b"] }] },
        };
      },
    ],
  ),

  // ---------------- angles round a point
  [
    "around a point",
    (seed) => {
      const pen = new Pen(`ap${seed}`, seed);
      const v = P(175, 140), up = P(175, 10), dl = P(40, 250), dr = P(310, 250);
      const strokes = [pen.stroke(v, up), pen.stroke(v, dl), pen.stroke(v, dr), pen.dot(v.x, v.y)];
      const labels = [angle(pen, strokes, "120^{\\circ}", v, up, dl), angle(pen, strokes, "100^{\\circ}", v, dr, up), angle(pen, strokes, "x", v, dl, dr)];
      return {
        title: "angles round a point: 120°, 100°, x",
        strokes,
        labels,
        answer: { letter: "x", value: 140 },
        gold: { quantities: [A("a", "120^{\\circ}"), A("b", "100^{\\circ}"), A("c", "x")], facts: [{ type: "around_point", items: ["a", "b", "c"] }] },
      };
    },
  ],
  [
    "around a point",
    (seed) => {
      const pen = new Pen(`ap${seed}`, seed);
      const v = P(175, 140), up = P(175, 10), left = P(20, 140), dr = P(300, 260);
      const strokes = [pen.stroke(v, up), pen.stroke(v, left), pen.stroke(v, dr), rightAngleBox(pen, v, up, left)];
      const labels = [angle(pen, strokes, "150^{\\circ}", v, left, dr), angle(pen, strokes, "x", v, dr, up)];
      return {
        title: "round a point: a right angle, 150°, x",
        strokes,
        labels,
        answer: { letter: "x", value: 120 },
        gold: {
          quantities: [A("r"), A("a", "150^{\\circ}"), A("b", "x")],
          facts: [{ type: "around_point", items: ["r", "a", "b"] }, { type: "right_angle", items: ["r"] }],
        },
      };
    },
  ],

  // ---------------- parallel lines and a transversal
  (["parallel lines", (seed: number) => parallels(seed, [1, "UR", "70^{\\circ}"], [2, "UR", "x"], { quantities: [A("a", "70^{\\circ}"), A("b", "x")], facts: [{ type: "corresponding", items: ["a", "b"] }] }, 70, "parallel lines: corresponding 70° and x")] as [FigureConfig, Maker]),
  (["parallel lines", (seed: number) => parallels(seed, [1, "BR", "x"], [2, "UL", "55^{\\circ}"], { quantities: [A("a", "x"), A("b", "55^{\\circ}")], facts: [{ type: "alternate_interior", items: ["a", "b"] }] }, 55, "parallel lines: alternate interior x and 55°")] as [FigureConfig, Maker]),
  (["parallel lines", (seed: number) => parallels(seed, [1, "UL", "3x - 20"], [2, "BR", "100^{\\circ}"], { quantities: [A("a", "3x - 20"), A("b", "100^{\\circ}")], facts: [{ type: "alternate_exterior", items: ["a", "b"] }] }, 40, "parallel lines: alternate exterior 3x − 20 and 100°")] as [FigureConfig, Maker]),
  (["parallel lines", (seed: number) => parallels(seed, [1, "BR", "x"], [2, "UR", "70^{\\circ}"], { quantities: [A("a", "x"), A("b", "70^{\\circ}")], facts: [{ type: "co_interior", items: ["a", "b"] }] }, 110, "parallel lines: co-interior x and 70°")] as [FigureConfig, Maker]),
  (["parallel lines", (seed: number) => parallels(seed, [1, "BL", "2x + 20"], [2, "UL", "3x - 40"], { quantities: [A("a", "2x + 20"), A("b", "3x - 40")], facts: [{ type: "co_interior", items: ["a", "b"] }] }, 40, "parallel lines: co-interior 2x + 20 and 3x − 40")] as [FigureConfig, Maker]),
  (["parallel lines", (seed: number) => parallels(seed, [1, "UL", "70^{\\circ}"], [2, "BL", "x"], { quantities: [A("a", "70^{\\circ}"), A("u"), A("b", "x")], facts: [{ type: "corresponding", items: ["a", "u"] }, { type: "straight_line", items: ["u", "b"] }] }, 110, "parallel lines: 70° above the top line, x below the bottom one, same side")] as [FigureConfig, Maker]),

  // ---------------- isosceles (tick marks)
  ...(
    [
      ["40^{\\circ}", "x", null, 70],
      ["x", "50^{\\circ}", null, 80],
      [null, "2x + 10", "50^{\\circ}", 20],
    ] as const
  ).map(
    ([apex, left, right, value]): [FigureConfig, Maker] => [
      "isosceles",
      (seed) => {
        const pen = new Pen(`iso${seed}`, seed);
        const a = P(175, 15), b = P(45, 250), c = P(305, 250);
        const strokes = [pen.stroke(a, b), pen.stroke(b, c), pen.stroke(c, a), ...tickMarks(pen, a, b), ...tickMarks(pen, a, c)];
        const labels = [];
        if (apex) labels.push(angle(pen, strokes, apex, a, b, c));
        if (left) labels.push(angle(pen, strokes, left, b, a, c));
        if (right) labels.push(angle(pen, strokes, right, c, a, b));
        return {
          title: `isosceles (ticks): apex ${apex ?? "—"}, base ${left}${right ? `, ${right}` : ""}`,
          strokes,
          labels,
          answer: { letter: "x", value },
          gold: { quantities: [A("a", apex), A("b", left), A("c", right)], facts: [{ type: "isosceles", items: ["a", "b", "c"] }] },
        };
      },
    ],
  ),

  // ---------------- equilateral (a tick on every side)
  [
    "equilateral",
    (seed) => {
      const pen = new Pen(`eq${seed}`, seed);
      const a = P(175, 20), b = P(40, 255), c = P(310, 255);
      const strokes = [pen.stroke(a, b), pen.stroke(b, c), pen.stroke(c, a), ...tickMarks(pen, a, b), ...tickMarks(pen, b, c), ...tickMarks(pen, a, c)];
      const labels = [angle(pen, strokes, "x", b, a, c)];
      return {
        title: "equilateral (a tick on each side), angle x",
        strokes,
        labels,
        answer: { letter: "x", value: 60 },
        gold: { quantities: [A("a", "x"), A("b"), A("c")], facts: [{ type: "equilateral", items: ["a", "b", "c"] }] },
      };
    },
  ],
  [
    "equilateral",
    (seed) => {
      const pen = new Pen(`eq${seed}`, seed);
      const a = P(175, 20), b = P(40, 255), c = P(310, 255), o = centroid(a, b, c);
      const strokes = [pen.stroke(a, b), pen.stroke(b, c), pen.stroke(c, a), ...tickMarks(pen, a, b), ...tickMarks(pen, b, c), ...tickMarks(pen, a, c)];
      const labels = [sideLabel("2x + 1", a, b, o, 44), sideLabel("7", b, c, o)];
      return {
        title: "equilateral: sides 2x + 1 and 7",
        strokes,
        labels,
        answer: { letter: "x", value: 3 },
        gold: { quantities: [S("s1", "2x + 1"), S("s2", "7"), S("s3")], facts: [{ type: "equilateral", items: ["s1", "s2", "s3"] }] },
      };
    },
  ],

  // ---------------- right angles
  [
    "right angle",
    (seed) => {
      const pen = new Pen(`ra${seed}`, seed);
      const a = P(40, 20), b = P(40, 250), c = P(320, 250);
      const strokes = [pen.stroke(a, b), pen.stroke(b, c), pen.stroke(c, a), rightAngleBox(pen, b, a, c)];
      const labels = [angle(pen, strokes, "35^{\\circ}", a, b, c, 52), angle(pen, strokes, "x", c, a, b, 64)];
      return {
        title: "right triangle (box), 35° and x",
        strokes,
        labels,
        answer: { letter: "x", value: 55 },
        gold: { quantities: [A("a", "35^{\\circ}"), A("b"), A("c", "x")], facts: [{ type: "triangle", items: ["a", "b", "c"] }, { type: "right_angle", items: ["b"] }] },
      };
    },
  ],
  [
    "right angle",
    (seed) => {
      const pen = new Pen(`ra${seed}`, seed);
      const v = P(40, 250), up = P(40, 20), right = P(330, 250), mid = P(300, 90);
      const strokes = [pen.stroke(v, up), pen.stroke(v, right), pen.stroke(v, mid), rightAngleBox(pen, v, up, right, 20)];
      const labels = [angle(pen, strokes, "x", v, up, mid, 90), angle(pen, strokes, "25^{\\circ}", v, mid, right, 110)];
      return {
        title: "a right angle split in two: x and 25°",
        strokes,
        labels,
        answer: { letter: "x", value: 65 },
        gold: { quantities: [A("a", "x"), A("b", "25^{\\circ}")], facts: [{ type: "right_angle_parts", items: ["a", "b"] }] },
      };
    },
  ],

  // ---------------- Pythagoras
  ...(
    [
      ["3", "4", "x", 5],
      ["5", "x", "13", 12],
      ["6", "8", "x", 10],
    ] as const
  ).map(
    ([leg1, leg2, hyp, value]): [FigureConfig, Maker] => [
      "pythagoras",
      (seed) => {
        const pen = new Pen(`py${seed}`, seed);
        const top = P(40, 20), corner = P(40, 230), right = P(320, 230), o = centroid(top, corner, right);
        const strokes = [pen.stroke(top, corner), pen.stroke(corner, right), pen.stroke(right, top), rightAngleBox(pen, corner, top, right)];
        const labels = [sideLabel(leg1, top, corner, o), sideLabel(leg2, corner, right, o), sideLabel(hyp, right, top, o)];
        return {
          title: `right triangle: legs ${leg1}, ${leg2}, hypotenuse ${hyp}`,
          strokes,
          labels,
          answer: { letter: "x", value },
          gold: { quantities: [S("a", leg1), S("b", leg2), S("c", hyp)], facts: [{ type: "right_triangle", items: ["a", "b", "c"] }] },
        };
      },
    ],
  ),

  // ---------------- polygons
  [
    "polygon",
    (seed) => {
      const pen = new Pen(`pg${seed}`, seed);
      const a = P(40, 40), b = P(290, 20), c = P(330, 240), d = P(30, 250);
      const strokes = [pen.stroke(a, b), pen.stroke(b, c), pen.stroke(c, d), pen.stroke(d, a)];
      const labels = [angle(pen, strokes, "x", a, d, b), angle(pen, strokes, "95^{\\circ}", b, a, c), angle(pen, strokes, "85^{\\circ}", c, b, d), angle(pen, strokes, "110^{\\circ}", d, c, a)];
      return {
        title: "quadrilateral: x, 95°, 85°, 110°",
        strokes,
        labels,
        answer: { letter: "x", value: 70 },
        gold: { quantities: [A("a", "x"), A("b", "95^{\\circ}"), A("c", "85^{\\circ}"), A("d", "110^{\\circ}")], facts: [{ type: "polygon", sides: 4, items: ["a", "b", "c", "d"] }] },
      };
    },
  ],
  [
    "polygon",
    (seed) => {
      const pen = new Pen(`pg${seed}`, seed);
      const pts = [P(180, 15), P(340, 120), P(280, 280), P(80, 280), P(20, 120)];
      const strokes = pts.map((p, i) => pen.stroke(p, pts[(i + 1) % 5]));
      const names = ["x", "100^{\\circ}", "120^{\\circ}", "110^{\\circ}", "95^{\\circ}"];
      const labels = pts.map((p, i) => angle(pen, strokes, names[i], p, pts[(i + 4) % 5], pts[(i + 1) % 5]));
      return {
        title: "pentagon: x, 100°, 120°, 110°, 95°",
        strokes,
        labels,
        answer: { letter: "x", value: 115 },
        gold: { quantities: names.map((n, i) => A(`a${i}`, n)), facts: [{ type: "polygon", sides: 5, items: names.map((_, i) => `a${i}`) }] },
      };
    },
  ],

  // ---------------- regular polygons
  [
    "regular polygon",
    (seed) => {
      const pen = new Pen(`rp${seed}`, seed);
      const c = P(175, 145);
      const pts = Array.from({ length: 6 }, (_, i) => P(c.x + 135 * Math.cos((Math.PI / 3) * i), c.y + 125 * Math.sin((Math.PI / 3) * i)));
      const strokes = pts.flatMap((p, i) => [pen.stroke(p, pts[(i + 1) % 6]), ...tickMarks(pen, p, pts[(i + 1) % 6])]);
      const labels = [angle(pen, strokes, "x", pts[3], pts[2], pts[4], 44)];
      return {
        title: "regular hexagon (a tick on every side), interior angle x",
        strokes,
        labels,
        answer: { letter: "x", value: 120 },
        gold: { quantities: [A("a", "x")], facts: [{ type: "regular_polygon", sides: 6, angle: "interior", items: ["a"] }] },
      };
    },
  ],
  [
    "regular polygon",
    (seed) => {
      const pen = new Pen(`rp${seed}`, seed);
      const c = P(160, 150);
      const pts = Array.from({ length: 5 }, (_, i) => P(c.x + 120 * Math.cos(-Math.PI / 2 + ((2 * Math.PI) / 5) * i), c.y + 120 * Math.sin(-Math.PI / 2 + ((2 * Math.PI) / 5) * i)));
      const strokes = pts.flatMap((p, i) => [pen.stroke(p, pts[(i + 1) % 5]), ...tickMarks(pen, p, pts[(i + 1) % 5])]);
      // one side extended past a vertex: the exterior angle there
      const v = pts[1], from = pts[0];
      const ext = P(v.x + (v.x - from.x) * 0.8, v.y + (v.y - from.y) * 0.8);
      strokes.push(pen.stroke(v, ext));
      const labels = [angle(pen, strokes, "x", v, ext, pts[2], 42)];
      return {
        title: "regular pentagon, one side extended: exterior angle x",
        strokes,
        labels,
        answer: { letter: "x", value: 72 },
        gold: { quantities: [A("a", "x")], facts: [{ type: "regular_polygon", sides: 5, angle: "exterior", items: ["a"] }] },
      };
    },
  ],

  // ---------------- a polygon's exterior angles
  [
    "exterior angles",
    (seed) => {
      const pen = new Pen(`ea${seed}`, seed);
      const pts = [P(80, 60), P(270, 50), P(300, 230), P(60, 220)];
      const strokes: InkStroke[] = [];
      const labels = [];
      const names = ["x", "100^{\\circ}", "80^{\\circ}", "90^{\\circ}"];
      for (let i = 0; i < 4; i++) {
        const p = pts[i], q = pts[(i + 1) % 4], prev = pts[(i + 3) % 4];
        // the side from the previous vertex runs on past this one
        const ext = P(p.x + (p.x - prev.x) * 0.3, p.y + (p.y - prev.y) * 0.3);
        strokes.push(pen.stroke(prev, ext));
        labels.push(angle(pen, strokes, names[i], p, ext, q, 40));
      }
      return {
        title: "a quadrilateral's exterior angles: x, 100°, 80°, 90°",
        strokes,
        labels,
        answer: { letter: "x", value: 90 },
        gold: { quantities: names.map((n, i) => A(`e${i}`, n)), facts: [{ type: "exterior_angles", items: names.map((_, i) => `e${i}`) }] },
      };
    },
  ],

  // ---------------- circles
  ...(
    [
      ["x", "100^{\\circ}", 50],
      ["35^{\\circ}", "x", 70],
    ] as const
  ).map(
    ([inscribed, central, value]): [FigureConfig, Maker] => [
      "inscribed & central",
      (seed) => {
        const pen = new Pen(`ic${seed}`, seed);
        const o = P(175, 145), r = 125;
        const at = (deg: number) => P(o.x + r * Math.cos((deg * Math.PI) / 180), o.y + r * Math.sin((deg * Math.PI) / 180));
        const a = at(145), b = at(35), c = at(270);
        const strokes = [pen.arc(o.x, o.y, r, r), pen.dot(o.x, o.y), pen.stroke(o, a), pen.stroke(o, b), pen.stroke(c, a), pen.stroke(c, b)];
        const labels = [angle(pen, strokes, inscribed, c, a, b, 56), angle(pen, strokes, central, o, a, b, 40), lab("O", labelAt("O", o.x, o.y - 22))];
        return {
          title: `inscribed angle ${inscribed}, central angle ${central} on the same arc`,
          strokes,
          labels,
          answer: { letter: "x", value },
          gold: { quantities: [A("i", inscribed), A("c", central)], facts: [{ type: "inscribed_central", items: ["i", "c"] }] },
        };
      },
    ],
  ),
  [
    "tangent",
    (seed) => {
      const pen = new Pen(`tg${seed}`, seed);
      const o = P(120, 170), r = 95, t = P(o.x + r, o.y), p = P(o.x + r, 10);
      const strokes = [pen.arc(o.x, o.y, r, r), pen.dot(o.x, o.y), pen.stroke(P(t.x, 290), P(t.x, 0)), pen.stroke(o, t), pen.stroke(o, p)];
      const labels = [angle(pen, strokes, "50^{\\circ}", o, t, p, 42), angle(pen, strokes, "x", p, o, t, 56), lab("O", labelAt("O", o.x - 18, o.y + 16)), lab("T", labelAt("T", t.x + 18, t.y + 14))];
      return {
        title: "a tangent at T and the radius OT; 50° at O, x at P",
        strokes,
        labels,
        answer: { letter: "x", value: 40 },
        gold: { quantities: [A("o", "50^{\\circ}"), A("p", "x"), A("t")], facts: [{ type: "triangle", items: ["o", "p", "t"] }, { type: "tangent_radius", items: ["t"] }] },
      };
    },
  ],
  [
    "semicircle",
    (seed) => {
      const pen = new Pen(`sc${seed}`, seed);
      const o = P(175, 230), r = 150, a = P(o.x - r, o.y), b = P(o.x + r, o.y);
      const c = P(o.x + r * Math.cos((-125 * Math.PI) / 180), o.y + r * Math.sin((-125 * Math.PI) / 180));
      const strokes = [pen.arc(o.x, o.y, r, r, Math.PI, 2 * Math.PI), pen.stroke(a, b), pen.stroke(a, c), pen.stroke(c, b)];
      const labels = [angle(pen, strokes, "35^{\\circ}", b, a, c, 60), angle(pen, strokes, "x", a, c, b, 50)];
      return {
        title: "a triangle in a semicircle: 35° and x",
        strokes,
        labels,
        answer: { letter: "x", value: 55 },
        gold: { quantities: [A("b", "35^{\\circ}"), A("a", "x"), A("c")], facts: [{ type: "triangle", items: ["a", "b", "c"] }, { type: "semicircle", items: ["c"] }] },
      };
    },
  ],
  [
    "cyclic & same arc",
    (seed) => {
      const pen = new Pen(`cy${seed}`, seed);
      const o = P(175, 150), r = 130;
      const at = (deg: number) => P(o.x + r * Math.cos((deg * Math.PI) / 180), o.y + r * Math.sin((deg * Math.PI) / 180));
      const pts = [at(200), at(290), at(350), at(110)];
      const strokes = [pen.arc(o.x, o.y, r, r), ...pts.map((p, i) => pen.stroke(p, pts[(i + 1) % 4]))];
      const labels = [angle(pen, strokes, "95^{\\circ}", pts[0], pts[3], pts[1]), angle(pen, strokes, "x", pts[2], pts[1], pts[3])];
      return {
        title: "a cyclic quadrilateral: opposite angles 95° and x",
        strokes,
        labels,
        answer: { letter: "x", value: 85 },
        gold: { quantities: [A("a", "95^{\\circ}"), A("b", "x")], facts: [{ type: "cyclic_opposite", items: ["a", "b"] }] },
      };
    },
  ],
  [
    "cyclic & same arc",
    (seed) => {
      const pen = new Pen(`sa${seed}`, seed);
      const o = P(175, 150), r = 130;
      const at = (deg: number) => P(o.x + r * Math.cos((deg * Math.PI) / 180), o.y + r * Math.sin((deg * Math.PI) / 180));
      const a = at(150), b = at(30), c = at(235), d = at(305);
      const strokes = [pen.arc(o.x, o.y, r, r), pen.stroke(c, a), pen.stroke(c, b), pen.stroke(d, a), pen.stroke(d, b)];
      const labels = [angle(pen, strokes, "40^{\\circ}", c, a, b, 60), angle(pen, strokes, "x", d, a, b, 60)];
      return {
        title: "two inscribed angles on the same arc: 40° and x",
        strokes,
        labels,
        answer: { letter: "x", value: 40 },
        gold: { quantities: [A("a", "40^{\\circ}"), A("b", "x")], facts: [{ type: "same_arc", items: ["a", "b"] }] },
      };
    },
  ],

  // ---------------- similar triangles (matching angle arcs)
  ...(
    [
      ["x", "8", "6", "12", 4],
      ["4", "6", "x", "9", 6],
    ] as const
  ).map(
    ([sLeft, sBase, bLeft, bBase, value]): [FigureConfig, Maker] => [
      "similar",
      (seed) => {
        const pen = new Pen(`si${seed}`, seed);
        const tri = (x: number, y: number, k: number) => [P(x + 40 * k, y), P(x, y + 90 * k), P(x + 110 * k, y + 90 * k)] as const;
        const [a1, b1, c1] = tri(10, 120, 1.1);
        const [a2, b2, c2] = tri(165, 40, 1.9);
        const strokes = [pen.stroke(a1, b1), pen.stroke(b1, c1), pen.stroke(c1, a1), pen.stroke(a2, b2), pen.stroke(b2, c2), pen.stroke(c2, a2)];
        // equal angles marked: one arc at the bottom left, two at the bottom right
        strokes.push(angleArc(pen, b1, a1, c1, 14), angleArc(pen, b2, a2, c2, 16), angleArc(pen, c1, a1, b1, 12), angleArc(pen, c1, a1, b1, 17), angleArc(pen, c2, a2, b2, 14), angleArc(pen, c2, a2, b2, 19));
        const o1 = centroid(a1, b1, c1), o2 = centroid(a2, b2, c2);
        const labels = [sideLabel(sLeft, a1, b1, o1, 20), sideLabel(sBase, b1, c1, o1, 20), sideLabel(bLeft, a2, b2, o2, 22), sideLabel(bBase, b2, c2, o2, 22)];
        return {
          title: `similar triangles: ${sLeft}, ${sBase} and ${bLeft}, ${bBase}`,
          strokes,
          labels,
          answer: { letter: "x", value },
          gold: {
            quantities: [S("p", sLeft), S("q", sBase), S("r", bLeft), S("s", bBase)],
            facts: [{ type: "similar", items: [["p", "r"], ["q", "s"]] }],
          },
        };
      },
    ],
  ),

  // ---------------- midsegment
  ...(
    [
      ["x", "18", 9],
      ["9", "x", 18],
    ] as const
  ).map(
    ([mid, base, value]): [FigureConfig, Maker] => [
      "midsegment",
      (seed) => {
        const pen = new Pen(`ms${seed}`, seed);
        const a = P(170, 15), b = P(20, 260), c = P(330, 260), o = centroid(a, b, c);
        const m1 = along(a, b, 0.5), m2 = along(a, c, 0.5);
        const strokes = [pen.stroke(a, b), pen.stroke(b, c), pen.stroke(c, a), pen.stroke(m1, m2), ...tickMarks(pen, a, m1), ...tickMarks(pen, m1, b), ...tickMarks(pen, a, m2, 2), ...tickMarks(pen, m2, c, 2)];
        const labels = [lab(mid, labelAt(mid, (m1.x + m2.x) / 2, m1.y + 20)), sideLabel(base, b, c, o, 24)];
        return {
          title: `midsegment ${mid}, base ${base}`,
          strokes,
          labels,
          answer: { letter: "x", value },
          gold: { quantities: [S("m", mid), S("b", base)], facts: [{ type: "midsegment", items: ["m", "b"] }] },
        };
      },
    ],
  ),

  // ---------------- the exterior angle at another vertex
  [
    "exterior angle",
    (seed) => {
      const pen = new Pen(`ch${seed}`, seed);
      const a = P(210, 20), b = P(90, 230), c = P(330, 230), d = P(10, 230);
      const strokes = [pen.stroke(a, b), pen.stroke(d, c), pen.stroke(c, a)];
      const labels = [angle(pen, strokes, "x", a, b, c), angle(pen, strokes, "70^{\\circ}", b, d, a, 42), angle(pen, strokes, "50^{\\circ}", c, a, b)];
      return {
        title: "triangle: 70° outside at one vertex, 50° inside at another, x at the third",
        strokes,
        labels,
        answer: { letter: "x", value: 20 },
        gold: {
          quantities: [A("x", "x"), A("e", "70^{\\circ}"), A("c", "50^{\\circ}")],
          facts: [{ type: "exterior_angle", items: ["e", "x", "c"] }],
        },
      };
    },
  ],
  [
    "exterior angle",
    (seed) => {
      const pen = new Pen(`ch${seed}`, seed);
      const a = P(210, 20), b = P(90, 230), c = P(330, 230), d = P(10, 230);
      const strokes = [pen.stroke(a, b), pen.stroke(d, c), pen.stroke(c, a)];
      const labels = [angle(pen, strokes, "x", a, b, c), angle(pen, strokes, "120^{\\circ}", b, d, a, 42), angle(pen, strokes, "2x", c, a, b)];
      return {
        title: "triangle: 120° outside at one vertex, x and 2x inside",
        strokes,
        labels,
        answer: { letter: "x", value: 40 },
        gold: { quantities: [A("x", "x"), A("e", "120^{\\circ}"), A("c", "2x")], facts: [{ type: "exterior_angle", items: ["e", "x", "c"] }] },
      };
    },
  ],
];

/** Every figure, with its id (`config/n`). */
export function buildFigureCorpus(): FigureCase[] {
  const counts = new Map<string, number>();
  return MAKERS.map(([config, make], i) => {
    const n = (counts.get(config) ?? 0) + 1;
    counts.set(config, n);
    return { id: `${config.replace(/[^a-z]+/g, "-")}-${n}`, config, ...make(1000 + i * 7) };
  });
}
