import { describe, expect, it } from "vitest";
import { LECTURE_SKETCH_LIMITS, SketchDrawingSchema, type SketchDrawing } from "@/lib/live/lecture/contracts";
import { cleanLabel, extractSvg, sketchBox, SVG_LIMITS, svgToDrawing, type SvgParse } from "../svg";

/** Parses, and holds every result to the contract: a drawing that comes back always validates. */
function parse(svg: string, aspect = 2, tolerance?: number): SvgParse {
  const r = svgToDrawing(svg, { aspect, tolerance });
  if (r.drawing) expect(SketchDrawingSchema.safeParse(r.drawing).success).toBe(true);
  return r;
}
const drawing = (svg: string, aspect = 2): SketchDrawing => {
  const r = parse(svg, aspect);
  if (!r.drawing) throw new Error(`no drawing: ${r.problems.join("; ")}`);
  return r.drawing;
};
/** A 1000 × 500 canvas (aspect 2): user units are drawing units. */
const svg = (body: string, attrs = 'viewBox="0 0 1000 500"') => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;
const LINE = '<line x1="100" y1="100" x2="300" y2="100" stroke="#1d1d1d"/>';
const round = (pts: ReadonlyArray<readonly [number, number]>) => pts.map(([x, y]) => [Math.round(x), Math.round(y)]);

describe("the box: 1000 wide, 1000 / aspect tall, the viewBox fitted with its aspect kept and centred", () => {
  it("h follows the aspect, whole units, within the contract's 300..2500", () => {
    expect(sketchBox(2)).toEqual({ w: 1000, h: 500 });
    expect(sketchBox(0.81)).toEqual({ w: 1000, h: 1235 });
    expect(sketchBox(1.57)).toEqual({ w: 1000, h: 637 });
    expect(sketchBox(0.4)).toEqual({ w: 1000, h: 2500 });
    expect(sketchBox(2.5)).toEqual({ w: 1000, h: 400 });
    expect(sketchBox(NaN)).toEqual({ w: 1000, h: 750 });
  });

  it("a tall panel keeps its real height: a drawing down to y ≈ h validates", () => {
    const d = drawing(svg('<line x1="500" y1="0" x2="500" y2="2000" stroke="blue"/><circle cx="500" cy="1900" r="50" stroke="blue"/>', 'viewBox="0 0 1000 2000"'), 0.5);
    expect(d.h).toBe(2000);
    expect(Math.max(...d.strokes.flatMap((s) => s.points.map((p) => p[1])))).toBeGreaterThan(1900);
  });

  it("the viewBox scaled into the box; a viewBox of another aspect centred", () => {
    expect(round(drawing(svg('<line x1="0" y1="0" x2="100" y2="50" stroke="black"/>', 'viewBox="0 0 100 50"')).strokes[0].points)).toEqual([[0, 0], [1000, 500]]);
    // a square viewBox in a 2:1 box: scale 5, 250 each side
    expect(round(drawing(svg('<line x1="0" y1="0" x2="100" y2="100" stroke="black"/>', 'viewBox="0 0 100 100"')).strokes[0].points)).toEqual([[250, 0], [750, 500]]);
    // a viewBox that does not start at 0
    expect(round(drawing(svg('<line x1="-50" y1="-25" x2="50" y2="25" stroke="black"/>', 'viewBox="-50 -25 100 50"')).strokes[0].points)).toEqual([[0, 0], [1000, 500]]);
  });

  it("no viewBox: width and height, else what was drawn", () => {
    expect(round(drawing(svg('<line x1="0" y1="0" x2="200" y2="100" stroke="black"/>', 'width="200" height="100"')).strokes[0].points)).toEqual([[0, 0], [1000, 500]]);
    const fitted = drawing(svg('<line x1="10" y1="10" x2="30" y2="20" stroke="black"/><line x1="10" y1="20" x2="30" y2="10" stroke="black"/>', ""));
    const xs = fitted.strokes.flatMap((s) => s.points.map((p) => p[0]));
    expect(Math.min(...xs)).toBeGreaterThan(0);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(800);
  });

  it("a drawing mostly outside its viewBox (drawn in 0..1000 inside a viewBox of 0..100) is fitted to what was drawn", () => {
    const r = parse(svg('<rect x="100" y="100" width="600" height="300" stroke="black" fill="none"/><circle cx="800" cy="250" r="100" stroke="blue" fill="none"/>', 'viewBox="0 0 100 100"'));
    expect(r.drawing?.strokes).toHaveLength(2);
    expect(r.problems.join(" ")).toMatch(/outside its viewBox/);
  });

  it("a little outside the viewBox is clipped as a renderer would: a line cut, a filled shape kept closed", () => {
    const d = drawing(svg('<line x1="-100" y1="250" x2="1100" y2="250" stroke="black"/><rect x="900" y="100" width="300" height="100" stroke="green" fill="green"/>' + LINE));
    expect(round(d.strokes[0].points)).toEqual([[0, 250], [1000, 250]]);
    expect(d.strokes[1]).toMatchObject({ closed: true, fill: true, color: "green" });
    expect(Math.max(...d.strokes[1].points.map((p) => p[0]))).toBeLessThanOrEqual(1000);
    // an outline leaving the box is cut, never drawn along the edge
    const cut = drawing(svg('<rect x="900" y="100" width="300" height="100" stroke="black" fill="none"/>' + LINE));
    expect(cut.strokes.filter((s) => s.closed)).toHaveLength(0);
  });
});

describe("the subset: every element, transforms through groups", () => {
  it("path, line, polyline, polygon, rect (and rounded), circle, ellipse", () => {
    const d = drawing(
      svg(`<path d="M10 10 L 100 10 Z" stroke="black"/><polyline points="10,50 60,90 110,50" stroke="black" fill="none"/><polygon points="200,50 250,90 150,90" stroke="black" fill="none"/>
      <rect x="300" y="50" width="100" height="60" stroke="black" fill="none"/><rect x="450" y="50" width="100" height="60" rx="20" stroke="black" fill="none"/>
      <circle cx="650" cy="80" r="40" stroke="black" fill="none"/><ellipse cx="800" cy="80" rx="80" ry="30" stroke="black" fill="none"/>`),
    );
    expect(d.strokes.map((s) => s.closed)).toEqual([true, false, true, true, true, true, true]);
    expect(d.strokes[3].points).toHaveLength(4); // a rect's corners
    expect(d.strokes[4].points.length).toBeGreaterThan(8); // rounded corners
    const circle = d.strokes[5].points;
    for (const [x, y] of circle) expect(Math.hypot(x - 650, y - 80)).toBeCloseTo(40, 0);
    const ellipse = d.strokes[6].points;
    expect(Math.abs(Math.max(...ellipse.map((p) => p[0])) - Math.min(...ellipse.map((p) => p[0])) - 160)).toBeLessThan(1.5);
  });

  it("every path command through the whole pipeline, relative arcs included", () => {
    const d = drawing(svg('<path d="M100 250 h100 v-50 l50 50 c 20 -40 60 -40 80 0 s 60 40 80 0 q 40 -60 80 0 t 80 0 a 40 40 0 0 1 80 0 A 40 60 30 1 0 800 300 z" stroke="black" fill="none"/>'));
    expect(d.strokes).toHaveLength(1);
    expect(d.strokes[0].closed).toBe(true);
    const ys = d.strokes[0].points.map((p) => p[1]);
    expect(Math.min(...ys)).toBeCloseTo(200, 0); // the v-50
    expect(Math.max(...ys)).toBeGreaterThan(300); // the large arc swings below its end
    expect(d.strokes[0].points.length).toBeGreaterThan(30); // the curves, flattened
  });

  it("transforms compose through nested groups (translate, scale, rotate, matrix)", () => {
    const d = drawing(
      svg(`<g transform="translate(100 0)"><g transform="scale(2)"><line x1="0" y1="10" x2="10" y2="10" stroke="black"/></g></g>
      <g transform="rotate(90 500 250)"><line x1="400" y1="250" x2="600" y2="250" stroke="black"/></g>
      <g transform="matrix(1 0 0 1 10 20)"><g transform="translate(5)"><line x1="0" y1="0" x2="100" y2="0" stroke="black"/></g></g>`),
    );
    expect(round(d.strokes[0].points)).toEqual([[100, 20], [120, 20]]);
    expect(round(d.strokes[1].points)).toEqual([[500, 150], [500, 350]]);
    expect(round(d.strokes[2].points)).toEqual([[15, 20], [115, 20]]);
  });

  it("a shape's own transform, a skew, and a degenerate scale(0) (nothing drawn)", () => {
    const d = drawing(svg('<line x1="0" y1="0" x2="10" y2="0" stroke="black" transform="translate(50 50) scale(10)"/><rect x="0" y="0" width="10" height="10" stroke="black" transform="scale(0)"/>' + LINE));
    expect(round(d.strokes[0].points)).toEqual([[50, 50], [150, 50]]);
    expect(d.strokes).toHaveLength(2);
  });

  it("groups nested 100 deep: what is past the depth limit is skipped, what is within it is drawn", () => {
    const deep = (n: number, inner: string) => "<g transform=\"translate(1 0)\">".repeat(n) + inner + "</g>".repeat(n);
    const r = parse(svg(deep(40, '<line x1="0" y1="100" x2="100" y2="100" stroke="black"/>') + deep(100, '<line x1="0" y1="200" x2="100" y2="200" stroke="black"/>')));
    expect(r.drawing?.strokes).toHaveLength(1);
    expect(round(r.drawing!.strokes[0].points)).toEqual([[40, 100], [140, 100]]);
    expect(r.stats.ignored["(nested too deep)"]).toBeGreaterThan(0);
  });

  it("text → labels: plain words, centred at (x, y) whatever the anchor, tspans joined, cut at a word", () => {
    const d = drawing(
      svg(`${LINE}<text x="500" y="100" font-size="40" text-anchor="middle">Nucleus</text>
      <text x="100" y="300" font-size="20"><tspan>Cell</tspan> <tspan>wall</tspan></text>
      <text x="900" y="400" style="font-size: 30px; text-anchor: end">Costs $5 &lt;now&gt;</text>
      <text x="500" y="450">The mitochondria is the powerhouse of the cell</text>
      <text x="1" y="1">\\frac{a}{b}</text>`),
    );
    const [nucleus, wall, costs, long] = d.labels;
    expect(nucleus).toEqual({ text: "Nucleus", x: 500, y: 86, size: 40 });
    expect(wall.text).toBe("Cell wall");
    expect(wall.x).toBeGreaterThan(100); // anchored at its start: its centre is to the right
    expect(costs.text).toBe("Costs 5 now");
    expect(costs.x).toBeLessThan(900); // anchored at its end
    expect(long.text).toBe("The mitochondria is the");
    expect(d.labels.every((l) => l.text.length <= 28)).toBe(true);
    expect(cleanLabel("   ")).toBeNull();
    expect(cleanLabel("Supercalifragilisticexpialidocious")).toBeNull();
  });

  it("a label set against the edge is moved in until its words fit the box", () => {
    const d = drawing(svg(`${LINE}<text x="10" y="100" font-size="40" text-anchor="end">Mitochondria</text>`));
    const l = d.labels[0];
    expect(l.x - 0.55 * 40 * "Mitochondria".length / 2).toBeGreaterThanOrEqual(-0.1);
  });

  it("at most 16 labels: the largest stay", () => {
    const texts = Array.from({ length: 20 }, (_, i) => `<text x="${40 + i * 45}" y="200" font-size="${i === 19 ? 80 : 20}">L${i}</text>`).join("");
    const r = parse(svg(LINE + texts));
    expect(r.drawing?.labels).toHaveLength(LECTURE_SKETCH_LIMITS.labels);
    expect(r.drawing?.labels.some((l) => l.text === "L19")).toBe(true);
    expect(r.problems.join(" ")).toMatch(/labels/);
  });
});

describe("ink: the palette, fills, backgrounds, what is invisible", () => {
  it("stroke and fill from attributes or style=, inherited from groups; style beats the attribute", () => {
    const d = drawing(
      svg(`<g stroke="#099268" fill="none"><line x1="0" y1="10" x2="100" y2="10"/><line x1="0" y1="20" x2="100" y2="20" style="stroke: #4465e9"/></g>
      <line x1="0" y1="30" x2="100" y2="30" stroke="green" style="stroke:orange !important"/>`),
    );
    expect(d.strokes.map((s) => s.color)).toEqual(["green", "blue", "yellow"]);
  });

  it("NEVER red: a red line is orange", () => {
    expect(drawing(svg('<line x1="0" y1="10" x2="100" y2="10" stroke="red"/><line x1="0" y1="20" x2="100" y2="20" stroke="#e03131"/>')).strokes.map((s) => s.color)).toEqual(["orange", "orange"]);
  });

  it("a filled closed shape is a closed stroke with fill; SVG's default fill is black; a black outline round a coloured fill takes the fill's colour", () => {
    const d = drawing(
      svg(`<circle cx="100" cy="100" r="50" fill="#4465e9"/><rect x="200" y="50" width="100" height="100"/>
      <circle cx="400" cy="100" r="50" stroke="#1d1d1d" fill="#099268"/><circle cx="550" cy="100" r="50" stroke="#ae3ec9" fill="#f1ac4b"/>
      <circle cx="700" cy="100" r="50" stroke="black" fill="none"/>`),
    );
    expect(d.strokes.map((s) => [s.color, s.closed, s.fill])).toEqual([
      ["blue", true, true],
      ["black", true, true],
      ["green", true, true],
      ["violet", true, true],
      ["black", true, false],
    ]);
  });

  it("a filled open path is filled as if closed; an outlined open path with a big gap stays open and unfilled", () => {
    const d = drawing(svg('<path d="M100 100 L 200 100 L 150 200" fill="green"/><path d="M300 100 L 400 100 L 350 200" fill="green" stroke="black"/>'));
    expect(d.strokes.map((s) => [s.closed, s.fill])).toEqual([[true, true], [false, false]]);
  });

  it("currentColor through color; a gradient is grey; opacity 0, display:none and visibility:hidden draw nothing", () => {
    const d = drawing(
      svg(`<g color="#099268"><line x1="0" y1="10" x2="100" y2="10" stroke="currentColor"/></g>
      <rect x="100" y="100" width="50" height="50" fill="url(#grad)"/>
      <line x1="0" y1="30" x2="100" y2="30" stroke="black" opacity="0"/><line x1="0" y1="40" x2="100" y2="40" stroke="black" style="display:none"/>
      <g visibility="hidden"><line x1="0" y1="50" x2="100" y2="50" stroke="black"/></g><g opacity="0"><line x1="0" y1="60" x2="100" y2="60" stroke="black"/></g>
      <line x1="0" y1="70" x2="100" y2="70" stroke="black" stroke-width="0"/>`),
    );
    expect(d.strokes.map((s) => [s.color, s.fill])).toEqual([["green", false], ["grey", true]]);
  });

  it("a background (a filled rect over the whole canvas) and a border are dropped; a big circle is a subject and stays", () => {
    const r = parse(svg(`<rect width="1000" height="500" fill="#e6f0ff"/><rect x="5" y="5" width="990" height="490" stroke="black" fill="none"/><circle cx="500" cy="250" r="250" stroke="blue" fill="none"/>${LINE}`));
    expect(r.drawing?.strokes.map((s) => s.color)).toEqual(["blue", "black"]);
    expect(r.problems.join(" ")).toMatch(/background or a border/);
  });

  it("white is invisible on a whiteboard: a white line and a white fill go — unless they sat on a dark background, then they are the drawing, in black", () => {
    const light = drawing(svg(`${LINE}<line x1="0" y1="10" x2="100" y2="10" stroke="white"/><circle cx="500" cy="250" r="50" fill="#fff" stroke="blue"/><circle cx="700" cy="250" r="50" fill="white"/>`));
    expect(light.strokes.map((s) => [s.color, s.fill])).toEqual([["black", false], ["blue", false]]);
    const night = drawing(svg('<rect width="1000" height="500" fill="#0b1026"/><path d="M100 400 L 300 100 L 500 400" stroke="#ffffff" fill="none"/><circle cx="800" cy="100" r="40" fill="#fff"/>'));
    expect(night.strokes.map((s) => [s.color, s.fill])).toEqual([["black", false], ["black", true]]);
  });

  it("what never draws is skipped with its whole subtree: script, style, image, foreignObject, defs and use, gradients, filters, masks", () => {
    const r = parse(
      svg(`<script>alert(1)</script><style>.a{stroke:red}</style><image href="x.png" width="100" height="100"/>
      <foreignObject width="100" height="100"><div><svg><line x1="0" y1="0" x2="999" y2="499" stroke="black"/></svg></div></foreignObject>
      <defs><path id="p" d="M0 0 L 999 499" stroke="black"/><linearGradient id="g"><stop offset="0"/></linearGradient></defs><use href="#p"/>
      <filter id="f"><feGaussianBlur/></filter><mask id="m"><rect width="1000" height="500" fill="white"/></mask><clipPath id="c"><rect width="10" height="10"/></clipPath>
      <line class="a" x1="100" y1="100" x2="300" y2="100" stroke="black"/><animate attributeName="x"/>`),
    );
    expect(r.drawing?.strokes).toHaveLength(1);
    expect(r.drawing?.strokes[0].color).toBe("black"); // the class's red was never applied
    for (const name of ["script", "style", "image", "foreignobject", "defs", "use", "filter", "mask", "clippath", "animate"]) expect(r.stats.ignored[name], name).toBe(1);
    expect(r.problems.join(" ")).toMatch(/ignored/);
  });
});

describe("hostile and broken input: never a throw, always bounded, a drawing only when there is one", () => {
  it("nothing to draw: empty, prose, an empty svg, only invisible or zero-size shapes", () => {
    expect(parse("").drawing).toBeNull();
    expect(parse("I'm sorry, I can't draw that.").problems.join(" ")).toMatch(/nothing to draw/);
    expect(parse(svg("")).drawing).toBeNull();
    expect(parse(svg('<rect width="0" height="10"/><circle r="0"/><path d="M5 5"/><line x1="5" y1="5" x2="5" y2="5" stroke="black"/>')).drawing).toBeNull();
    expect(parse(svg('<line x1="0" y1="0" x2="100" y2="0" stroke="none"/>')).problems.join(" ")).toMatch(/nothing visible/);
  });

  it("huge numbers and NaN: skipped, never Infinity or NaN in the drawing", () => {
    const r = parse(
      svg(`${LINE}<line x1="1e308" y1="0" x2="-1e308" y2="0" stroke="black" transform="scale(10)"/><circle cx="NaN" cy="100" r="50" stroke="black"/>
      <rect x="1e400" width="10" height="10" stroke="black"/><path d="M0 0 L 1e300 1e300" stroke="black"/><g transform="scale(1e200)"><line x1="0" y1="0" x2="1e200" y2="0" stroke="black"/></g>`),
    );
    for (const s of r.drawing!.strokes) for (const [x, y] of s.points) expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
  });

  it("unclosed tags, a reply cut off mid-element, CDATA and entities in text", () => {
    const d = drawing(`<svg viewBox="0 0 1000 500"><g stroke="black"><line x1="0" y1="10" x2="100" y2="10"><text x="500" y="100"><![CDATA[Fish & chips]]> &amp; peas</text><circle cx="500" cy="250" r="50" fill="none" stroke="blue"><path d="M0 0 L 10`);
    expect(d.labels.map((l) => l.text)).toEqual([]); // the text is a child of the unclosed <line>: never drawn
    const d2 = drawing(`<svg viewBox="0 0 1000 500"><line x1="0" y1="10" x2="100" y2="10" stroke="black"/><text x="500" y="100"><![CDATA[Fish & chips]]> &amp; peas</text><circle cx="500" cy="250" r="50" stroke="blue" fill="none"`);
    expect(d2.labels.map((l) => l.text)).toEqual(["Fish & chips & peas"]);
    expect(d2.strokes).toHaveLength(1); // the circle's tag was cut off: left out
  });

  it("50,000 elements: read up to the element limit, capped, fast", () => {
    const shapes = Array.from({ length: 50_000 }, (_, i) => `<circle cx="${(i * 37) % 1000}" cy="${(i * 53) % 500}" r="${2 + (i % 7)}" stroke="black" fill="none"/>`).join("");
    const t0 = performance.now();
    const r = parse(svg(shapes));
    expect(performance.now() - t0).toBeLessThan(3000);
    expect(r.stats.elements).toBeLessThanOrEqual(SVG_LIMITS.elements + 1);
    expect(r.drawing!.strokes.length).toBeLessThanOrEqual(LECTURE_SKETCH_LIMITS.strokes);
    expect(r.problems.join(" ")).toMatch(/too big/);
  });

  it("a flood of stray close tags against a deep stack of open ones stays fast", () => {
    const t0 = performance.now();
    const r = parse(svg(`${LINE}${"<g>".repeat(4000)}${"</x>".repeat(70_000)}`));
    expect(performance.now() - t0).toBeLessThan(1500);
    expect(r.drawing?.strokes).toHaveLength(1);
  });

  it("a monster input string is cut at SVG_LIMITS.chars; a billion-laughs DOCTYPE is never expanded", () => {
    const r = parse(svg(LINE + " ".repeat(SVG_LIMITS.chars * 2) + '<line x1="0" y1="200" x2="100" y2="200" stroke="black"/>'));
    expect(r.drawing?.strokes).toHaveLength(1);
    const laughs = `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol1 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;"><!ENTITY lol2 "&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;">]>${svg(`${LINE}<text x="500" y="200">&lol2;</text>`)}`;
    const d = drawing(laughs);
    expect(d.labels).toEqual([]);
  });
});

describe("the caps: simplified, never cut short; the smallest details go first", () => {
  it("1000 small circles and one big shape: at most 400 strokes, the big shape kept", () => {
    const small = Array.from({ length: 1000 }, (_, i) => `<circle cx="${20 + (i % 40) * 24}" cy="${20 + Math.floor(i / 40) * 18}" r="${3 + (i % 5)}" stroke="black" fill="none"/>`).join("");
    const r = parse(svg(`<rect x="100" y="100" width="800" height="300" stroke="blue" fill="none"/>${small}`));
    expect(r.drawing!.strokes.length).toBeLessThanOrEqual(LECTURE_SKETCH_LIMITS.strokes);
    expect(r.drawing!.strokes.some((s) => s.color === "blue")).toBe(true);
    expect(r.stats.dropped).toBeGreaterThan(0);
    expect(r.problems.join(" ")).toMatch(/smallest details/);
    // what was dropped was the smallest: every kept circle is at least as big as every dropped one would be
    const radii = r.drawing!.strokes.filter((s) => s.color === "black").map((s) => (Math.max(...s.points.map((p) => p[0])) - Math.min(...s.points.map((p) => p[0]))) / 2);
    expect(Math.min(...radii)).toBeGreaterThan(3.5);
  });

  it("a stroke of 5000 wiggly points is simplified to at most 600, its ends kept", () => {
    const pts = Array.from({ length: 5000 }, (_, i) => `${(i / 5000) * 1000},${250 + 200 * Math.sin(i / 3)}`).join(" ");
    const r = parse(svg(`<polyline points="${pts}" stroke="black" fill="none"/>`));
    const s = r.drawing!.strokes[0];
    expect(s.points.length).toBeLessThanOrEqual(LECTURE_SKETCH_LIMITS.pointsPerStroke);
    expect(s.points[0][0]).toBeCloseTo(0, 0);
    expect(s.points[s.points.length - 1][0]).toBeCloseTo(999.8, 0);
  });

  it("too many points in all: the whole drawing simplified harder until it fits", () => {
    // 50 wavy paths of 50 quadratic humps each: ~1000 points apiece once flattened this finely
    const lines = Array.from({ length: 50 }, (_, k) => `<path d="M0 ${20 + k * 9} q 10 -20 20 0${" t 20 0".repeat(49)}" stroke="black" fill="none"/>`).join("");
    const r = parse(svg(lines), 2, 0.05);
    const total = r.drawing!.strokes.reduce((n, s) => n + s.points.length, 0);
    expect(total).toBeLessThanOrEqual(LECTURE_SKETCH_LIMITS.points);
    expect(r.stats.tolerance).toBeGreaterThan(0.05);
  });

  it("a curve is flattened within about a unit of the box, adaptively", () => {
    const d = drawing(svg('<circle cx="500" cy="250" r="200" stroke="black" fill="none"/><circle cx="100" cy="100" r="10" stroke="black" fill="none"/>'));
    const [big, small] = d.strokes;
    for (const [x, y] of big.points) expect(Math.abs(Math.hypot(x - 500, y - 250) - 200)).toBeLessThan(0.2);
    // chords of the big circle stay within ~1.5 units of it
    for (let i = 0; i < big.points.length; i++) {
      const [a, b] = [big.points[i], big.points[(i + 1) % big.points.length]];
      expect(200 - Math.hypot((a[0] + b[0]) / 2 - 500, (a[1] + b[1]) / 2 - 250)).toBeLessThan(1.6);
    }
    expect(small.points.length).toBeLessThan(big.points.length);
  });
});

describe("the SVG in a model's reply", () => {
  const S = '<svg viewBox="0 0 10 10"><path d="M0 0"/></svg>';
  it("JSON {svg}, a fenced block, prose round it, a reply cut off, escaped markup from broken JSON", () => {
    expect(extractSvg(JSON.stringify({ svg: S }))).toBe(S);
    expect(extractSvg("```svg\n" + S + "\n```")).toBe(S);
    expect(extractSvg(`Here is your drawing:\n${S}\nEnjoy!`)).toBe(S);
    expect(extractSvg('<svg viewBox="0 0 10 10"><path d="M0 0 L 5')).toBe('<svg viewBox="0 0 10 10"><path d="M0 0 L 5');
    expect(extractSvg(`{"svg": "${S.replace(/"/g, '\\"')}`)).toBe(S);
    expect(extractSvg(`{"svg": "\\u003csvg viewBox=\\"0 0 10 10\\"\\u003e\\u003cpath d=\\"M0 0\\"/\\u003e`)).toBe('<svg viewBox="0 0 10 10"><path d="M0 0"/>');
    expect(extractSvg('<path d="M0 0 L 5 5"/>')).toBe('<path d="M0 0 L 5 5"/>');
    expect(extractSvg("I can't draw that.")).toBeNull();
    expect(extractSvg("")).toBeNull();
  });
});
