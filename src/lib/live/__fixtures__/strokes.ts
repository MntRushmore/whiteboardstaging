import type { TLDrawShape, TLShapeId } from "tldraw";
import type { InkStroke } from "../contracts";

/**
 * Synthesized tldraw draw-shape records (no browser needed). Glyph strokes are
 * densely sampled polylines (~1.5 px steps) with a little deterministic jitter so
 * they look like real ink and RDP has something to remove.
 */

type Pt = { x: number; y: number };

let seed = 12345;
function jitter(): number {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return ((seed % 1000) / 1000 - 0.5) * 0.25;
}

function sampleLine(a: Pt, b: Pt, step = 1.5): Pt[] {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.max(2, Math.ceil(len / step));
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push({ x: a.x + (b.x - a.x) * t + jitter(), y: a.y + (b.y - a.y) * t + jitter() });
  }
  return out;
}

function sampleArc(cx: number, cy: number, rx: number, ry: number, from: number, to: number, step = 1.5): Pt[] {
  const len = Math.abs(to - from) * Math.max(rx, ry);
  const n = Math.max(4, Math.ceil(len / step));
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const a = from + ((to - from) * i) / n;
    out.push({ x: cx + rx * Math.cos(a) + jitter(), y: cy + ry * Math.sin(a) + jitter() });
  }
  return out;
}

function polyline(...parts: Pt[][]): Pt[] {
  const out: Pt[] = [];
  for (const p of parts) for (const q of p) out.push(q);
  return out;
}

/** Glyphs in a box of width w and height h at (x, y). Each returns one or more strokes. */
export const glyphs = {
  one(x: number, y: number, w: number, h: number): Pt[][] {
    return [sampleLine({ x: x + w * 0.5, y }, { x: x + w * 0.5, y: y + h })];
  },
  two(x: number, y: number, w: number, h: number): Pt[][] {
    const r = w * 0.45;
    return [
      polyline(
        sampleArc(x + w * 0.5, y + r, r, r, Math.PI, Math.PI * 2 + 0.6),
        sampleLine({ x: x + w * 0.5 + r * Math.cos(0.6), y: y + r + r * Math.sin(0.6) }, { x, y: y + h }),
        sampleLine({ x, y: y + h }, { x: x + w, y: y + h }),
      ),
    ];
  },
  three(x: number, y: number, w: number, h: number): Pt[][] {
    const r = h / 4;
    return [
      polyline(
        sampleArc(x + w * 0.5, y + r, w * 0.45, r, Math.PI * 1.15, Math.PI * 2.5),
        sampleArc(x + w * 0.5, y + 3 * r, w * 0.45, r, Math.PI * 1.5, Math.PI * 2.85),
      ),
    ];
  },
  four(x: number, y: number, w: number, h: number): Pt[][] {
    return [
      polyline(sampleLine({ x: x + w * 0.7, y }, { x, y: y + h * 0.65 }), sampleLine({ x, y: y + h * 0.65 }, { x: x + w, y: y + h * 0.65 })),
      sampleLine({ x: x + w * 0.7, y }, { x: x + w * 0.7, y: y + h }),
    ];
  },
  eight(x: number, y: number, w: number, h: number): Pt[][] {
    const r = h / 4;
    return [
      polyline(
        sampleArc(x + w * 0.5, y + r, w * 0.4, r, -Math.PI / 2, Math.PI * 1.5),
        sampleArc(x + w * 0.5, y + 3 * r, w * 0.45, r, -Math.PI / 2, Math.PI * 1.5),
      ),
    ];
  },
  x(x: number, y: number, w: number, h: number): Pt[][] {
    return [sampleLine({ x, y }, { x: x + w, y: y + h }), sampleLine({ x: x + w, y }, { x, y: y + h })];
  },
  plus(x: number, y: number, w: number, h: number): Pt[][] {
    return [
      sampleLine({ x: x + w / 2, y }, { x: x + w / 2, y: y + h }),
      sampleLine({ x, y: y + h / 2 }, { x: x + w, y: y + h / 2 }),
    ];
  },
  equals(x: number, y: number, w: number, h: number): Pt[][] {
    return [
      sampleLine({ x, y: y + h * 0.35 }, { x: x + w, y: y + h * 0.35 }),
      sampleLine({ x, y: y + h * 0.65 }, { x: x + w, y: y + h * 0.65 }),
    ];
  },
  bar(x: number, y: number, w: number): Pt[][] {
    return [sampleLine({ x, y }, { x: x + w, y })];
  },
};

let idCounter = 0;
export function nextShapeId(prefix = "fix"): TLShapeId {
  idCounter += 1;
  return `shape:${prefix}_${idCounter}` as TLShapeId;
}

/** Builds a tldraw draw record from page-space points (shape origin = first point). */
export function drawShapeFromPoints(points: Pt[], id: TLShapeId = nextShapeId()): TLDrawShape {
  const ox = points[0].x;
  const oy = points[0].y;
  return {
    id,
    typeName: "shape",
    type: "draw",
    x: ox,
    y: oy,
    rotation: 0,
    index: "a1" as TLDrawShape["index"],
    parentId: "page:page" as TLDrawShape["parentId"],
    isLocked: false,
    opacity: 1,
    meta: {},
    props: {
      color: "black",
      fill: "none",
      dash: "draw",
      size: "m",
      segments: [{ type: "free", points: points.map((p) => ({ x: p.x - ox, y: p.y - oy, z: 0.5 })) }],
      isComplete: true,
      isClosed: false,
      isPen: false,
      scale: 1,
    },
  };
}

/** Lays glyphs left to right on a baseline; returns one draw shape per stroke. */
export function writeLine(text: string, x: number, y: number, h = 40, gap = 12): TLDrawShape[] {
  const shapes: TLDrawShape[] = [];
  let cx = x;
  for (const ch of text) {
    const w = ch === "1" ? h * 0.35 : ch === "+" || ch === "=" ? h * 0.55 : h * 0.7;
    let strokes: Pt[][] = [];
    switch (ch) {
      case "1":
        strokes = glyphs.one(cx, y, w, h);
        break;
      case "2":
        strokes = glyphs.two(cx, y, w, h);
        break;
      case "3":
        strokes = glyphs.three(cx, y, w, h);
        break;
      case "4":
        strokes = glyphs.four(cx, y, w, h);
        break;
      case "8":
        strokes = glyphs.eight(cx, y, w, h);
        break;
      case "x":
        strokes = glyphs.x(cx, y + h * 0.3, w, h * 0.7);
        break;
      case "+":
        strokes = glyphs.plus(cx, y + h * 0.25, w, h * 0.5);
        break;
      case "=":
        strokes = glyphs.equals(cx, y + h * 0.25, w, h * 0.5);
        break;
      case " ":
        cx += w;
        continue;
      default:
        throw new Error(`fixture glyph missing for '${ch}'`);
    }
    for (const s of strokes) shapes.push(drawShapeFromPoints(s));
    cx += w + gap;
  }
  return shapes;
}

/** `2x+3=11` on one line: 10 strokes. */
export function fixtureSingleLine(): TLDrawShape[] {
  return writeLine("2x+3=11", 100, 200, 40);
}

/** `2x=8` above `x=4`, same column: 2 lines. */
export function fixtureTwoLines(): TLDrawShape[] {
  return [...writeLine("2x=8", 100, 200, 40), ...writeLine("x=4", 100, 290, 40)];
}

/** `\frac{1}{2} + x`: numerator, bar, denominator and a `+ x` on the bar's baseline: 1 line. */
export function fixtureFraction(): TLDrawShape[] {
  const shapes: TLDrawShape[] = [];
  for (const s of glyphs.one(122, 180, 14, 30)) shapes.push(drawShapeFromPoints(s));
  for (const s of glyphs.bar(100, 221, 60)) shapes.push(drawShapeFromPoints(s));
  for (const s of glyphs.two(115, 228, 28, 30)) shapes.push(drawShapeFromPoints(s));
  for (const s of glyphs.plus(180, 210, 20, 20)) shapes.push(drawShapeFromPoints(s));
  for (const s of glyphs.x(215, 208, 25, 26)) shapes.push(drawShapeFromPoints(s));
  return shapes;
}

/** Two columns of work side by side on the same rows. */
export function fixtureTwoColumns(): TLDrawShape[] {
  return [
    ...writeLine("2x=8", 100, 200, 40),
    ...writeLine("x=4", 100, 290, 40),
    ...writeLine("3x=12", 600, 200, 40),
    ...writeLine("x=4", 600, 290, 40),
  ];
}

/** Pure conversion of draw records to InkStroke (identity rotation, page = shape + offset). */
export function toInkStrokes(shapes: TLDrawShape[]): InkStroke[] {
  return shapes.map((s) => {
    const segments = s.props.segments.map((seg) => seg.points.map((p) => ({ x: p.x + s.x, y: p.y + s.y })));
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const seg of segments) {
      for (const p of seg) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
    }
    return { id: s.id, bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY }, segments };
  });
}

export function translateShapes(shapes: TLDrawShape[], dx: number, dy: number): TLDrawShape[] {
  return shapes.map((s) => ({ ...s, x: s.x + dx, y: s.y + dy }));
}

/**
 * An `F` whose top cross-bar is a zero-height stroke 2 px ABOVE the stem's top (no
 * vertical overlap with anything), followed by two small `x`s so the median stroke
 * height is small (16 px) and the centre-distance rule cannot rescue the bar: 1 line, 5 strokes.
 */
export function fixtureDetachedCrossbar(): TLDrawShape[] {
  const shapes: TLDrawShape[] = [];
  // stem: x = 100, y 200..240
  for (const s of glyphs.one(93, 200, 14, 40)) shapes.push(drawShapeFromPoints(s));
  // top bar: y = 198, x 100..128 (detached, above the stem)
  for (const s of glyphs.bar(100, 198, 28)) shapes.push(drawShapeFromPoints(s));
  // middle bar: y = 218, x 100..120
  for (const s of glyphs.bar(100, 218, 20)) shapes.push(drawShapeFromPoints(s));
  // two small lowercase-like glyphs on the baseline
  for (const s of glyphs.x(140, 224, 14, 16)) shapes.push(drawShapeFromPoints(s));
  return shapes;
}

/**
 * `x` with a raised, 60 %-size `2` whose bottom sits 4 px ABOVE the x's top (a real
 * superscript), nothing else on the line: 1 line, 3 strokes.
 */
export function fixtureSuperscript(): TLDrawShape[] {
  const shapes: TLDrawShape[] = [];
  // x: 100..128 wide, y 212..240 (28 tall)
  for (const s of glyphs.x(100, 212, 28, 28)) shapes.push(drawShapeFromPoints(s));
  // 2: 132..145 wide, y 190..208 (18 tall) -> bottom 208 is 4 px above the x's top (212)
  for (const s of glyphs.two(132, 190, 13, 18)) shapes.push(drawShapeFromPoints(s));
  return shapes;
}

/** Same `x`, but the small `2` floats far above (a stray mark): 2 lines. */
export function fixtureFloatingMark(): TLDrawShape[] {
  const shapes: TLDrawShape[] = [];
  for (const s of glyphs.x(100, 212, 28, 28)) shapes.push(drawShapeFromPoints(s));
  for (const s of glyphs.two(132, 150, 13, 18)) shapes.push(drawShapeFromPoints(s));
  return shapes;
}
