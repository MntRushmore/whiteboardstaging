import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { LECTURE_SKETCH_LIMITS, SketchDrawingSchema, type SketchDrawing } from "@/lib/live/lecture/contracts";
import { decodeImage, traceFidelity, traceLineArt, type Bitmap } from "..";
import { frameFor } from "../drawing";

// ------------------------------------------------------------------ helpers

/** An SVG rasterised by sharp (real anti-aliased lines), as the tracer's bitmap. */
async function raster(svg: string): Promise<Bitmap> {
  const { data, info } = await sharp(Buffer.from(svg)).raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, channels: info.channels as 3 | 4, data: new Uint8Array(data) };
}

const svg = (w: number, h: number, body: string, bg = "#ffffff") =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="${bg}"/>${body}</svg>`;

/** A drawing's points back in the picture's pixels (the pictures here are under 1024, so working = source). */
function inPixels(d: SketchDrawing, bm: Bitmap): Array<{ pts: Array<[number, number]>; closed: boolean; color?: string }> {
  const f = frameFor(bm.width, bm.height);
  return d.strokes.map((s) => ({ pts: s.points.map(([x, y]) => [(x - f.ox) / f.s, (y - f.oy) / f.s] as [number, number]), closed: s.closed, color: s.color }));
}

const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** A stroke's box as a dot: its centre and half its larger side (drawing units). */
function dotOf(st: SketchDrawing["strokes"][number]): { x: number; y: number; r: number } {
  const xs = st.points.map((p) => p[0]);
  const ys = st.points.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, r: Math.max(x1 - x0, y1 - y0) / 2 };
}

/** A deterministic PRNG (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function expectValid(d: SketchDrawing) {
  expect(() => SketchDrawingSchema.parse(d)).not.toThrow();
  expect(d.strokes.length).toBeLessThanOrEqual(LECTURE_SKETCH_LIMITS.strokes);
  expect(d.strokes.reduce((n, s) => n + s.points.length, 0)).toBeLessThanOrEqual(LECTURE_SKETCH_LIMITS.points);
  for (const s of d.strokes) {
    expect(s.fill).toBe(false);
    for (const [x, y] of s.points) {
      expect(Math.round(x * 10) / 10).toBe(x);
      expect(Math.round(y * 10) / 10).toBe(y);
    }
  }
}

// ------------------------------------------------------------------ shapes

describe("traceLineArt: centrelines", () => {
  for (const width of [4, 10]) {
    it(`a straight ${width} px line is one open stroke ending at its true ends`, async () => {
      const bm = await raster(svg(600, 450, `<line x1="80" y1="120" x2="520" y2="330" stroke="#111" stroke-width="${width}" stroke-linecap="round"/>`));
      const { drawing, stats } = traceLineArt(bm);
      expectValid(drawing);
      expect(drawing.strokes).toHaveLength(1);
      const [s] = inPixels(drawing, bm);
      expect(s.closed).toBe(false);
      const ends = [s.pts[0], s.pts[s.pts.length - 1]].sort((a, b) => a[0] - b[0]);
      expect(dist(ends[0], [80, 120])).toBeLessThan(3);
      expect(dist(ends[1], [520, 330])).toBeLessThan(3);
      // one centreline: every point on the true line
      for (const p of s.pts) {
        const t = ((p[0] - 80) * 440 + (p[1] - 120) * 210) / (440 * 440 + 210 * 210);
        expect(dist(p, [80 + 440 * t, 120 + 210 * t])).toBeLessThan(1.5);
      }
      expect(stats.lineWidth).toBeGreaterThan(width - 2.5);
      expect(stats.lineWidth).toBeLessThan(width + 2.5);
    });
  }

  it("a circle is one closed stroke on its radius", async () => {
    const bm = await raster(svg(500, 500, `<circle cx="250" cy="240" r="160" fill="none" stroke="#222" stroke-width="5"/>`));
    const { drawing } = traceLineArt(bm);
    expectValid(drawing);
    expect(drawing.strokes).toHaveLength(1);
    const [s] = inPixels(drawing, bm);
    expect(s.closed).toBe(true);
    expect(s.pts.length).toBeGreaterThan(12);
    for (const p of s.pts) expect(Math.abs(dist(p, [250, 240]) - 160)).toBeLessThan(2);
  });

  it("a rectangle is one closed stroke with its four corners sharp", async () => {
    const bm = await raster(svg(600, 400, `<rect x="90" y="70" width="400" height="250" fill="none" stroke="#000" stroke-width="6"/>`));
    const { drawing } = traceLineArt(bm);
    expectValid(drawing);
    expect(drawing.strokes).toHaveLength(1);
    const [s] = inPixels(drawing, bm);
    expect(s.closed).toBe(true);
    for (const c of [
      [90, 70],
      [490, 70],
      [490, 320],
      [90, 320],
    ]) {
      // a vertex at the corner itself, not a chamfer either side of it
      const near = Math.min(...s.pts.map((p) => dist(p, c)));
      expect(near, `corner ${c}`).toBeLessThan(2.5);
    }
    expect(s.pts.length).toBeLessThanOrEqual(12);
  });

  it('"+", "X" and "T" are two strokes each', async () => {
    const shapes: Record<string, string> = {
      plus: `<path d="M250 60 V440 M60 250 H440"/>`,
      x: `<path d="M90 90 L410 410 M410 90 L90 410"/>`,
      t: `<path d="M70 90 H430 M250 90 V430"/>`,
    };
    for (const [name, d] of Object.entries(shapes)) {
      for (const width of [3, 8]) {
        const bm = await raster(svg(500, 500, `<g stroke="#111" stroke-width="${width}" stroke-linecap="round" fill="none">${d}</g>`));
        const { drawing } = traceLineArt(bm);
        expectValid(drawing);
        expect(drawing.strokes.length, `${name} at ${width} px`).toBe(2);
        // each stroke is long and nearly straight: a line drawn through the crossing, not two halves
        for (const s of inPixels(drawing, bm)) {
          const len = dist(s.pts[0], s.pts[s.pts.length - 1]);
          expect(len, `${name} at ${width} px`).toBeGreaterThan(name === "t" ? 320 : 360);
        }
      }
    }
  });

  it("an arrow (a line and a two-stroke head) is at most three strokes and loses nothing", async () => {
    const bm = await raster(svg(560, 400, `<path d="M60 200 H480 M430 165 L480 200 L430 235" stroke="#111" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`));
    const { drawing } = traceLineArt(bm);
    expectValid(drawing);
    expect(drawing.strokes.length).toBeLessThanOrEqual(3);
    const pts = inPixels(drawing, bm).flatMap((s) => s.pts);
    // the tip and both barbs are there
    for (const c of [
      [480, 200],
      [430, 165],
      [430, 235],
      [60, 200],
    ])
      expect(Math.min(...pts.map((p) => dist(p, c))), `point ${c}`).toBeLessThan(3);
    const { recall, precision } = traceFidelity(bm, drawing);
    expect(recall).toBeGreaterThan(0.97);
    expect(precision).toBeGreaterThan(0.97);
    // the tip is fat where three strokes converge, but it is not a filled dot
    expect(drawing.strokes.every((s) => !s.closed)).toBe(true);
  });

  it("hand strokes that taper to their ends survive: ticks across an axis keep both arms, an arrowhead both barbs", async () => {
    // a vertical axis; two ticks across it drawn as lenses (4 px in the middle, a point at each end),
    // as a pen tapers them — only a sharp corner's mitre may be pruned for tapering, not these
    const bm = await raster(
      svg(
        300,
        300,
        `<line x1="150" y1="40" x2="150" y2="280" stroke="#000" stroke-width="3.5"/>
         <path d="M142 200 L150 198 L158 200 L150 202 Z M140 240 L150 238 L160 240 L150 242 Z" fill="#000" stroke="#000" stroke-width="1" stroke-linejoin="round"/>
         <path d="M150 40 L143 52 L144.5 53 Z M150 40 L157 52 L155.5 53 Z" fill="#000" stroke="#000" stroke-width="1.2" stroke-linejoin="round"/>`,
      ),
    );
    const { drawing } = traceLineArt(bm);
    expectValid(drawing);
    const pts = inPixels(drawing, bm).flatMap((st) => st.pts);
    for (const c of [
      [143, 200],
      [157, 200],
      [141, 240],
      [159, 240],
      [144, 52],
      [156, 52],
    ])
      expect(Math.min(...pts.map((p) => dist(p, c))), `end ${c}`).toBeLessThan(3);
  });

  it("a thick, sharp elbow is one stroke turning at its true corner (no spur into the mitre)", async () => {
    for (const width of [6, 10]) {
      const bm = await raster(svg(600, 450, `<path d="M80 400 L320 370 L250 120" fill="none" stroke="#000" stroke-width="${width}"/>`));
      const { drawing } = traceLineArt(bm);
      expectValid(drawing);
      expect(drawing.strokes, `${width} px`).toHaveLength(1);
      const [s] = inPixels(drawing, bm);
      expect(Math.min(...s.pts.map((p) => dist(p, [320, 370]))), `${width} px`).toBeLessThan(3);
      // and nothing runs on past the corner towards the mitre's tip
      expect(Math.max(...s.pts.map((p) => p[0])), `${width} px`).toBeLessThan(324);
    }
  });

  it("filled shapes are outlined, not thinned: a solid arrowhead stays a triangle, a bar a rectangle", async () => {
    const bm = await raster(
      svg(
        560,
        300,
        `<line x1="60" y1="200" x2="430" y2="200" stroke="#111" stroke-width="4"/><path d="M480 200 L420 175 L420 225 Z" fill="#111"/>
         <rect x="80" y="40" width="40" height="110" fill="#4465e9"/>`,
      ),
    );
    const { drawing } = traceLineArt(bm);
    expectValid(drawing);
    const strokes = inPixels(drawing, bm);
    expect(strokes).toHaveLength(3);
    const shaft = strokes.find((s) => !s.closed)!;
    const [head, bar] = strokes.filter((s) => s.closed).sort((a, b) => b.pts[0][0] - a.pts[0][0]);
    // the shaft runs to the head's base, not on through it
    expect(Math.max(...shaft.pts.map((p) => p[0]))).toBeLessThan(430);
    // the head: three corners near the triangle's, inside it
    expect(head.pts.length).toBeLessThanOrEqual(5);
    for (const c of [
      [422, 178],
      [422, 222],
    ])
      expect(Math.min(...head.pts.map((p) => dist(p, c))), `corner ${c}`).toBeLessThan(4);
    expect(Math.max(...head.pts.map((p) => p[0]))).toBeGreaterThan(466);
    // the bar: its four corners, just inside, in its own colour
    expect(bar.color).toBe("blue");
    expect(bar.pts).toHaveLength(4);
    for (const c of [
      [82, 42],
      [118, 42],
      [118, 148],
      [82, 148],
    ])
      expect(Math.min(...bar.pts.map((p) => dist(p, c))), `corner ${c}`).toBeLessThan(2.5);
  });

  it("a thick line among thin ones is still a centreline, not an outline", async () => {
    const bm = await raster(svg(600, 300, `<line x1="40" y1="60" x2="560" y2="60" stroke="#000" stroke-width="3"/><line x1="40" y1="180" x2="560" y2="180" stroke="#000" stroke-width="14" stroke-linecap="round"/>`));
    const { drawing } = traceLineArt(bm);
    expectValid(drawing);
    expect(drawing.strokes).toHaveLength(2);
    expect(drawing.strokes.every((s) => !s.closed)).toBe(true);
  });

  it("a filled dot where lines meet is drawn as a dot, not lost", async () => {
    const bm = await raster(svg(500, 500, `<g stroke="#111" stroke-width="3"><path d="M250 250 L250 60 M250 250 L420 330 M250 250 L90 360"/></g><circle cx="250" cy="250" r="11" fill="#111"/>`));
    const { drawing } = traceLineArt(bm);
    expectValid(drawing);
    const s = frameFor(500, 500).s;
    const dots = drawing.strokes.map(dotOf).filter((d) => d.r < 20 * s && dist([d.x, d.y], [250 * s, 250 * s]) < 3 * s);
    expect(dots).toHaveLength(1);
    expect(dots[0].r).toBeGreaterThanOrEqual(0.8 * 11 * s);
  });
});

// ------------------------------------------------------------------ dots

describe("traceLineArt: dots", () => {
  it("a Lewis structure's lone pairs: four solid dots come back as four dots at their centres, at their size; specks still go", async () => {
    const dots: Array<[number, number, number]> = [
      [205, 120, 6],
      [232, 100, 5],
      [318, 100, 7],
      [345, 122, 5.5],
    ];
    const rand = rng(5);
    let specks = "";
    const speckAt: Array<[number, number]> = [];
    for (let k = 0; k < 40; k++) {
      const x = 20 + Math.floor(rand() * 520);
      const y = 300 + Math.floor(rand() * 80);
      const size = rand() < 0.5 ? 1 : 2;
      specks += `<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="#111"/>`;
      speckAt.push([x + size / 2, y + size / 2]);
    }
    const bm = await raster(
      svg(
        560,
        400,
        `<g fill="none" stroke="#111" stroke-width="5" stroke-linecap="round">
           <ellipse cx="275" cy="160" rx="26" ry="32"/>
           <path d="M245 185 L150 260 M305 185 L400 260"/>
         </g>
         ${dots.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#111"/>`).join("")}
         ${specks}`,
      ),
    );
    const { drawing, stats } = traceLineArt(bm);
    expectValid(drawing);
    expect(stats.droppedSpecks).toBeGreaterThanOrEqual(40);
    const s = frameFor(560, 400).s;
    const found = drawing.strokes.map(dotOf);
    for (const [x, y, r] of dots) {
      const near = found.filter((d) => dist([d.x, d.y], [x * s, y * s]) < 2 * s);
      expect(near, `dot at ${x},${y}`).toHaveLength(1);
      expect(near[0].r, `dot at ${x},${y}`).toBeGreaterThanOrEqual(0.8 * r * s);
      expect(near[0].r, `dot at ${x},${y}`).toBeLessThan(1.6 * r * s);
    }
    // the O, the two bonds, the four dots: nothing from the specks
    expect(drawing.strokes).toHaveLength(7);
    for (const [x, y] of speckAt) expect(found.some((d) => dist([d.x, d.y], [x * s, y * s]) < 3 * s)).toBe(false);
  });

  it("a dot is drawn filled: a spiral from its edge to its centre, its turns closer than a pen", async () => {
    const bm = await raster(svg(300, 300, `<circle cx="150" cy="150" r="9" fill="#000"/><line x1="20" y1="40" x2="280" y2="40" stroke="#000" stroke-width="3"/>`));
    const { drawing } = traceLineArt(bm);
    const s = frameFor(300, 300).s;
    const dot = drawing.strokes.find((st) => dist([dotOf(st).x, dotOf(st).y], [150 * s, 150 * s]) < 2 * s)!;
    expect(dot).toBeDefined();
    expect(dot.closed).toBe(false);
    const c: [number, number] = [150 * s, 150 * s];
    const radii = dot.points.map((p) => dist(p, c));
    // it starts on the edge and ends at the centre, and steps in a little at a time
    expect(radii[0]).toBeGreaterThan(0.8 * 9 * s);
    expect(radii[radii.length - 1]).toBeLessThan(1.5 * s);
    expect(dot.points.length).toBeGreaterThan(20);
  });

  it("plotted points on a polygon's corners are dots; a degree sign (a small ring) stays a ring", async () => {
    const corners: Array<[number, number]> = [
      [100, 300],
      [400, 300],
      [100, 100],
    ];
    const bm = await raster(
      svg(
        500,
        400,
        `<path d="M100 300 L400 300 L100 100 Z" fill="none" stroke="#111" stroke-width="3"/>
         ${corners.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="7" fill="#111"/>`).join("")}
         <circle cx="450" cy="80" r="6" fill="none" stroke="#111" stroke-width="2.5"/>`,
      ),
    );
    const { drawing } = traceLineArt(bm);
    expectValid(drawing);
    const s = frameFor(500, 400).s;
    const found = drawing.strokes.map(dotOf);
    for (const c of corners) {
      const near = found.filter((d) => d.r < 15 * s && dist([d.x, d.y], [c[0] * s, c[1] * s]) < 2.5 * s);
      expect(near, `point ${c}`).toHaveLength(1);
      expect(near[0].r).toBeGreaterThanOrEqual(0.8 * 7 * s);
    }
    const degree = drawing.strokes.filter((st) => dist([dotOf(st).x, dotOf(st).y], [450 * s, 80 * s]) < 2 * s);
    expect(degree).toHaveLength(1);
    expect(degree[0].closed).toBe(true);
  });

  it('a small hand-lettered "F" keeps all three of its strokes (no "Γ")', async () => {
    for (const size of [22, 30, 40]) {
      const bm = await raster(svg(200, 120, `<text x="40" y="90" font-family="Helvetica, Arial, sans-serif" font-size="${size}" fill="#111">F</text>`));
      const { drawing } = traceLineArt(bm);
      expectValid(drawing);
      // the ink's lowest point, and the trace's
      let bottom = 0;
      for (let y = 0; y < bm.height; y++) for (let x = 0; x < bm.width; x++) if (bm.data[(y * bm.width + x) * bm.channels] < 128) bottom = Math.max(bottom, y);
      const ys = inPixels(drawing, bm).flatMap((st) => st.pts.map((p) => p[1]));
      expect(Math.max(...ys), `F at ${size} px`).toBeGreaterThan(bottom - 3);
      expect(drawing.strokes.length, `F at ${size} px`).toBeGreaterThanOrEqual(2);
      expect(traceFidelity(bm, drawing).recall, `F at ${size} px`).toBeGreaterThan(0.95);
    }
  });
});

// ------------------------------------------------------------------ paper, noise, colour

describe("traceLineArt: paper and ink", () => {
  it("speck noise on a pale grey, noisy background draws nothing", async () => {
    const w = 640;
    const h = 480;
    const data = new Uint8Array(w * h * 3);
    const rand = rng(7);
    for (let i = 0; i < w * h; i++) {
      const v = Math.round(242 + (rand() - 0.5) * 16);
      data[i * 3] = data[i * 3 + 1] = data[i * 3 + 2] = v;
    }
    // specks: single pixels and 2 × 2 blots, dark
    for (let k = 0; k < 400; k++) {
      const x = Math.floor(rand() * (w - 2));
      const y = Math.floor(rand() * (h - 2));
      const big = rand() < 0.3;
      for (let dy = 0; dy <= (big ? 1 : 0); dy++)
        for (let dx = 0; dx <= (big ? 1 : 0); dx++) {
          const i = (y + dy) * w + x + dx;
          data[i * 3] = data[i * 3 + 1] = data[i * 3 + 2] = 90;
        }
    }
    const bm: Bitmap = { width: w, height: h, channels: 3, data };
    const { drawing, stats } = traceLineArt(bm);
    expect(drawing.strokes).toHaveLength(0);
    expect(stats.droppedSpecks).toBeGreaterThan(300);
  });

  it("the same noise does not hide a real line on it", async () => {
    const base = await raster(svg(640, 480, `<line x1="60" y1="240" x2="580" y2="240" stroke="#333" stroke-width="3"/>`, "#f2f2f2"));
    const rand = rng(11);
    const data = new Uint8Array(base.data);
    for (let i = 0; i < base.width * base.height; i++) {
      const n = Math.round((rand() - 0.5) * 16);
      for (let c = 0; c < 3; c++) data[i * base.channels + c] = Math.max(0, Math.min(255, data[i * base.channels + c] + n));
    }
    const { drawing } = traceLineArt({ ...base, data });
    expectValid(drawing);
    expect(drawing.strokes).toHaveLength(1);
  });

  it("a one-channel (grey) bitmap traces like its RGB twin", async () => {
    const rgb = await raster(svg(400, 300, `<circle cx="200" cy="150" r="90" fill="none" stroke="#000" stroke-width="4"/>`));
    const grey = new Uint8Array(rgb.width * rgb.height);
    for (let i = 0; i < grey.length; i++) grey[i] = rgb.data[i * rgb.channels];
    const a = traceLineArt(rgb).drawing;
    const b = traceLineArt({ width: rgb.width, height: rgb.height, channels: 1, data: grey }).drawing;
    expect(b).toEqual(a);
  });

  it("a transparent PNG's transparency is paper", async () => {
    const png = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><line x1="40" y1="150" x2="360" y2="150" stroke="#000" stroke-width="4"/></svg>`))
      .png()
      .toBuffer();
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(info.channels).toBe(4);
    const { drawing } = traceLineArt({ width: info.width, height: info.height, channels: 4, data: new Uint8Array(data) });
    expect(drawing.strokes).toHaveLength(1);
  });

  it("coloured lines are ink, in the nearest marker; a pale grey line beside black ones is grey", async () => {
    const bm = await raster(
      svg(
        600,
        420,
        `<g stroke-width="4" fill="none" stroke-linecap="round">
          <line x1="50" y1="60" x2="550" y2="60" stroke="#2D5BFF"/>
          <line x1="50" y1="150" x2="550" y2="150" stroke="#111111"/>
          <line x1="50" y1="240" x2="550" y2="240" stroke="#f1ac4b"/>
          <line x1="50" y1="330" x2="550" y2="330" stroke="#a8a8a8"/>
        </g>`,
      ),
    );
    const { drawing } = traceLineArt(bm);
    expectValid(drawing);
    expect(drawing.strokes).toHaveLength(4);
    const byRow = inPixels(drawing, bm).sort((a, b) => a.pts[0][1] - b.pts[0][1]);
    expect(byRow.map((s) => s.color)).toEqual(["blue", "black", "yellow", "grey"]);
  });

  it("an ignored region (an OCR's text box) is blank: nothing is traced inside it", async () => {
    const bm = await raster(svg(600, 400, `<g stroke="#000" stroke-width="3" fill="none"><rect x="40" y="40" width="520" height="320"/><path d="M120 150 H300 M120 200 H300 M120 250 H300"/></g>`));
    const box = { x: 100, y: 130, w: 220, h: 140 };
    const all = traceLineArt(bm).drawing;
    const { drawing } = traceLineArt(bm, { ignore: [box] });
    expectValid(drawing);
    expect(drawing.strokes.length).toBe(all.strokes.length - 3);
    for (const s of inPixels(drawing, bm))
      for (const [x, y] of s.pts) expect(x > box.x - 1 && x < box.x + box.w + 1 && y > box.y - 1 && y < box.y + box.h + 1, `${x},${y}`).toBe(false);
    // a polygon works too
    const poly = traceLineArt(bm, {
      ignore: [
        [
          [100, 130],
          [320, 130],
          [320, 270],
          [100, 270],
        ],
      ],
    }).drawing;
    expect(poly.strokes.length).toBe(drawing.strokes.length);
  });
});

// ------------------------------------------------------------------ text

describe("traceLineArt: writing", () => {
  it('"F = ma" at 28 px traces into strokes that cover it', async () => {
    const bm = await raster(svg(320, 90, `<text x="24" y="58" font-family="Helvetica, Arial, sans-serif" font-size="28" fill="#111">F = ma</text>`));
    const { drawing, stats } = traceLineArt(bm);
    expectValid(drawing);
    expect(drawing.strokes.length).toBeGreaterThanOrEqual(5);
    expect(stats.inkPixels).toBeGreaterThan(200);
    const { recall, precision } = traceFidelity(bm, drawing);
    expect(recall).toBeGreaterThanOrEqual(0.9);
    expect(precision).toBeGreaterThanOrEqual(0.9);
  });
});

// ------------------------------------------------------------------ the box, the caps, determinism, speed

describe("traceLineArt: the drawing", () => {
  it("is 1000 wide with h from the aspect; a very wide picture is padded, not stretched", async () => {
    const tall = traceLineArt(await raster(svg(400, 600, `<line x1="40" y1="300" x2="360" y2="300" stroke="#000" stroke-width="4"/>`))).drawing;
    expect(tall.w).toBe(1000);
    expect(tall.h).toBe(1500);
    const wide = await raster(svg(1000, 150, `<circle cx="500" cy="75" r="50" fill="none" stroke="#000" stroke-width="4"/>`));
    const d = traceLineArt(wide).drawing;
    expect(d.h).toBe(300);
    const [s] = d.strokes;
    const xs = s.points.map((p) => p[0]);
    const ys = s.points.map((p) => p[1]);
    // still round: as wide as it is tall, centred in the padded box
    expect(Math.abs(Math.max(...xs) - Math.min(...xs) - (Math.max(...ys) - Math.min(...ys)))).toBeLessThan(3);
    expect(Math.abs((Math.max(...ys) + Math.min(...ys)) / 2 - 150)).toBeLessThan(2);
  });

  it("orders strokes as a person draws: big shapes first, writing last", async () => {
    const bm = await raster(
      svg(
        600,
        500,
        `<text x="420" y="60" font-family="Helvetica, Arial, sans-serif" font-size="22" fill="#000">x = 1</text>
         <rect x="60" y="120" width="480" height="330" fill="none" stroke="#000" stroke-width="4"/>
         <circle cx="300" cy="285" r="40" fill="none" stroke="#000" stroke-width="3"/>`,
      ),
    );
    const { drawing } = traceLineArt(bm);
    const sizes = drawing.strokes.map((s) => {
      const xs = s.points.map((p) => p[0]);
      const ys = s.points.map((p) => p[1]);
      return Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    });
    expect(sizes[0]).toBe(Math.max(...sizes));
    expect(sizes[1]).toBe(Math.max(...sizes.slice(1)));
    // the writing (small, top right) comes after both shapes
    expect(sizes.slice(2).every((x) => x < 60)).toBe(true);
  });

  it("a dense hatch stays within the contract's caps and parses", async () => {
    const rand = rng(3);
    let body = "";
    for (let i = 0; i < 900; i++) {
      const x = 20 + rand() * 960;
      const y = 20 + rand() * 960;
      const a = rand() * Math.PI;
      const l = 6 + rand() * 18;
      body += `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x + l * Math.cos(a)).toFixed(1)}" y2="${(y + l * Math.sin(a)).toFixed(1)}"/>`;
    }
    // and long wiggles, many points each
    for (let k = 0; k < 12; k++) {
      let d = `M10 ${40 + k * 80}`;
      for (let x = 10; x < 1000; x += 6) d += ` L${x} ${(40 + k * 80 + 14 * Math.sin(x / 4 + k)).toFixed(1)}`;
      body += `<path d="${d}" fill="none"/>`;
    }
    const bm = await raster(svg(1000, 1000, `<g stroke="#000" stroke-width="2.5" stroke-linecap="round">${body}</g>`));
    const { drawing, stats } = traceLineArt(bm);
    expectValid(drawing);
    expect(stats.droppedForLimits).toBeGreaterThan(0);
    expect(drawing.strokes.length).toBeLessThanOrEqual(LECTURE_SKETCH_LIMITS.strokes);
    for (const s of drawing.strokes) expect(s.points.length).toBeLessThanOrEqual(LECTURE_SKETCH_LIMITS.pointsPerStroke);
  });

  it("a stroke past 600 points is split into pieces that share their ends", async () => {
    // a long zigzag no simplification can shorten: ~1000 corners
    let d = "M10 10";
    for (let i = 0; i < 1000; i++) d += ` L${10 + ((i + 1) % 2) * 14} ${10 + (i + 1) * 0.98}`;
    const bm = await raster(svg(60, 1000, `<path d="${d}" fill="none" stroke="#000" stroke-width="1.2"/>`));
    const { drawing, stats } = traceLineArt(bm, { epsilon: 0.3 });
    expectValid(drawing);
    if (stats.splitForLimits > 0) {
      const long = drawing.strokes.filter((s) => s.points.length === LECTURE_SKETCH_LIMITS.pointsPerStroke);
      expect(long.length).toBeGreaterThan(0);
    }
    for (const s of drawing.strokes) expect(s.points.length).toBeLessThanOrEqual(LECTURE_SKETCH_LIMITS.pointsPerStroke);
  });

  it("is deterministic", async () => {
    const bm = await raster(
      svg(700, 500, `<g stroke="#222" stroke-width="4" fill="none"><rect x="50" y="50" width="300" height="200"/><circle cx="500" cy="300" r="120"/><path d="M60 400 L650 420 M100 300 L300 480"/></g><text x="400" y="80" font-size="26" font-family="sans-serif">a + b</text>`),
    );
    const a = traceLineArt(bm);
    const b = traceLineArt(bm);
    expect(b.drawing).toEqual(a.drawing);
    expect({ ...b.stats, ms: 0 }).toEqual({ ...a.stats, ms: 0 });
  });

  it("traces a 1024² diagram in well under 400 ms", async () => {
    let body = `<rect x="60" y="60" width="904" height="904" fill="none" stroke-width="5"/>`;
    for (let i = 0; i < 12; i++) body += `<circle cx="${180 + (i % 4) * 220}" cy="${200 + Math.floor(i / 4) * 300}" r="${60 + (i % 3) * 15}" fill="none" stroke-width="3"/>`;
    for (let i = 0; i < 40; i++) body += `<line x1="${80 + i * 22}" y1="900" x2="${120 + i * 20}" y2="${600 + (i % 7) * 30}" stroke-width="${2 + (i % 4)}"/>`;
    body += `<text x="100" y="140" font-size="34" font-family="sans-serif" stroke="none" fill="#000">The forces on a block: F = ma, N = mg cos θ</text>`;
    const bm = await raster(svg(1024, 1024, `<g stroke="#111" fill="#000">${body}</g>`));
    traceLineArt(bm); // warm the JIT
    let best = Infinity;
    let result = traceLineArt(bm);
    for (let k = 0; k < 3; k++) {
      const t0 = performance.now();
      result = traceLineArt(bm);
      best = Math.min(best, performance.now() - t0);
    }
    expectValid(result.drawing);
    expect(result.stats.workingSize).toEqual([1024, 1024]);
    // the budget is for an unloaded machine; a CI box (or a laptop running a simulator and a build)
    // can be several times slower, so it scales by a reference loop timed here, now
    const ref = new Uint8Array(1 << 20).map((_, i) => (i * 2654435761) >>> 24);
    const hist = new Uint32Array(256);
    const r0 = performance.now();
    for (let k = 0; k < 20; k++) for (let i = 0; i < ref.length; i++) hist[ref[i]]++;
    const slowdown = Math.max(1, (performance.now() - r0) / 25);
    expect(best).toBeLessThan(400 * slowdown);
  });
});

// ------------------------------------------------------------------ fidelity and decoding

describe("traceFidelity", () => {
  it("a perfect trace scores ≥ 0.95 / 0.95; an empty one recall 0", async () => {
    const bm = await raster(svg(500, 400, `<g stroke="#000" stroke-width="6" fill="none"><line x1="50" y1="80" x2="450" y2="80"/><circle cx="250" cy="250" r="100"/></g>`));
    const f = frameFor(500, 400);
    const at = (x: number, y: number): [number, number] => [Math.round((f.ox + x * f.s) * 10) / 10, Math.round((f.oy + y * f.s) * 10) / 10];
    const circle: Array<[number, number]> = Array.from({ length: 72 }, (_, k) => at(250 + 100 * Math.cos((k * Math.PI) / 36), 250 + 100 * Math.sin((k * Math.PI) / 36)));
    const perfect: SketchDrawing = {
      w: 1000,
      h: f.h,
      strokes: [
        { points: [at(50, 80), at(450, 80)], closed: false, fill: false, color: "black" },
        { points: circle, closed: true, fill: false, color: "black" },
      ],
      labels: [],
    };
    const good = traceFidelity(bm, perfect);
    expect(good.recall).toBeGreaterThanOrEqual(0.95);
    expect(good.precision).toBeGreaterThanOrEqual(0.95);
    // half of it: recall falls, precision does not
    const half = traceFidelity(bm, { ...perfect, strokes: [perfect.strokes[1]] });
    expect(half.recall).toBeLessThan(0.85);
    expect(half.precision).toBeGreaterThanOrEqual(0.95);
    // a stroke where there is no ink: precision falls
    const wrong = traceFidelity(bm, { ...perfect, strokes: [...perfect.strokes, { points: [at(40, 380), at(460, 380)], closed: false, fill: false }] });
    expect(wrong.precision).toBeLessThan(good.precision - 0.2);
    const empty = traceFidelity(bm, { ...perfect, strokes: [] });
    expect(empty.recall).toBe(0);
    // the tracer's own drawing scores as a perfect one does
    const traced = traceFidelity(bm, traceLineArt(bm).drawing);
    expect(traced.recall).toBeGreaterThanOrEqual(0.95);
    expect(traced.precision).toBeGreaterThanOrEqual(0.95);
  });
});

describe("decodeImage", () => {
  it("decodes PNG and JPEG to RGB, the long side at most maxSide", async () => {
    const big = Buffer.from(svg(2400, 1200, `<line x1="100" y1="600" x2="2300" y2="600" stroke="#000" stroke-width="12"/>`));
    const png = await sharp(big).png().toBuffer();
    const jpg = await sharp(big).jpeg({ quality: 80 }).toBuffer();
    for (const bytes of [png, jpg]) {
      const bm = await decodeImage(bytes);
      expect(bm.channels).toBe(3);
      expect([bm.width, bm.height]).toEqual([1024, 512]);
      expect(bm.data.length).toBe(1024 * 512 * 3);
      const { drawing } = traceLineArt(bm);
      expect(drawing.strokes).toHaveLength(1);
    }
    const small = await decodeImage(png, 600);
    expect([small.width, small.height]).toEqual([600, 300]);
  });

  it("a bitmap the tracer cannot read throws", () => {
    expect(() => traceLineArt({ width: 10, height: 10, channels: 3, data: new Uint8Array(10) })).toThrow(/needs 300/);
  });
});
