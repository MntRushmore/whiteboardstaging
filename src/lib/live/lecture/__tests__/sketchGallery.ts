import { polylineToSvgD } from "@/lib/hand";
import type { LectureSketch } from "../chart/sketch";
import type { LectureInk, SketchDrawing, SketchStroke } from "../contracts";
import { sketchDrawing } from "../sketch/ink";
import { sketchPanels, type PanelsSketch } from "../sketch/panels";

/**
 * The free-drawing contact sheet: six drawings as an illustrator might send them (hand-authored
 * here as SVG-ish path data, sampled into `SketchDrawing` polylines the way the route samples the
 * model's SVG), each planned into the desk's picture box; then comics — the frames, captions and
 * title of a strip (`sketchPanels`) with a drawing planned into every frame — exactly as the
 * HandWriter would put them on the board. They exist to be LOOKED AT.
 *
 *   LECTURE_GALLERY=1 npx vitest run src/lib/live/lecture/__tests__/sketchGallery.test.ts
 *
 * writes docs/lecture/sketch.png (via `rsvg-convert`); `LECTURE_GALLERY=debug` also shades every
 * label's ink box and every frame's drawing area.
 */

// ------------------------------------------------------------------ SVG-ish path data → polylines

type P = [number, number];

/** Samples absolute and relative M, L, H, V, C, Q and Z into polylines (one per subpath). */
export function samplePathData(d: string): Array<{ points: P[]; closed: boolean }> {
  const tokens = d.match(/[MLHVCQZmlhvcqz]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  const out: Array<{ points: P[]; closed: boolean }> = [];
  let cur: P[] = [];
  let x = 0;
  let y = 0;
  let cmd = "";
  let i = 0;
  const num = () => Number(tokens[i++]);
  const flush = (closed: boolean) => {
    if (cur.length >= 2) out.push({ points: cur, closed });
    cur = [];
  };
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) cmd = tokens[i++];
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    switch (cmd.toUpperCase()) {
      case "M": {
        flush(false);
        x = ox + num();
        y = oy + num();
        cur = [[x, y]];
        cmd = rel ? "l" : "L";
        break;
      }
      case "L":
        x = ox + num();
        y = oy + num();
        cur.push([x, y]);
        break;
      case "H":
        x = ox + num();
        cur.push([x, y]);
        break;
      case "V":
        y = oy + num();
        cur.push([x, y]);
        break;
      case "C": {
        const c1: P = [ox + num(), oy + num()];
        const c2: P = [ox + num(), oy + num()];
        const e: P = [ox + num(), oy + num()];
        const n = Math.max(6, Math.ceil((dist([x, y], c1) + dist(c1, c2) + dist(c2, e)) / 14));
        for (let k = 1; k <= n; k++) {
          const t = k / n;
          const u = 1 - t;
          cur.push([u * u * u * x + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * e[0], u * u * u * y + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * e[1]]);
        }
        [x, y] = e;
        break;
      }
      case "Q": {
        const c: P = [ox + num(), oy + num()];
        const e: P = [ox + num(), oy + num()];
        const n = Math.max(5, Math.ceil((dist([x, y], c) + dist(c, e)) / 14));
        for (let k = 1; k <= n; k++) {
          const t = k / n;
          const u = 1 - t;
          cur.push([u * u * x + 2 * u * t * c[0] + t * t * e[0], u * u * y + 2 * u * t * c[1] + t * t * e[1]]);
        }
        [x, y] = e;
        break;
      }
      case "Z": {
        const start = cur[0];
        flush(true);
        if (start) [x, y] = start;
        break;
      }
      default:
        i++;
    }
  }
  flush(false);
  return out;
}

function dist(a: P, b: P): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

type Ink = { color?: LectureInk; fill?: boolean };

/** A drawing under construction: strokes in the illustrator's (painter's) order, and labels. */
class Draw {
  readonly strokes: SketchStroke[] = [];
  readonly labels: SketchDrawing["labels"] = [];
  /**
   * `k` scales what is drawn about the box's top middle: a tall figure authored on a tall box is
   * drawn into a box the contract accepts (its coordinates stop at 1050, so a drawing is at most
   * ~1050 tall until y may reach `h`; the route caps it the same way).
   */
  constructor(
    readonly h: number,
    private readonly k = 1,
  ) {}

  private at(p: P): P {
    const k = this.k;
    return [Math.round((500 + (p[0] - 500) * k) * 10) / 10, Math.round(p[1] * k * 10) / 10];
  }

  path(d: string, ink: Ink = {}): this {
    for (const sub of samplePathData(d)) this.strokes.push({ points: sub.points.map((p) => this.at(p)), closed: sub.closed || !!ink.fill, fill: !!ink.fill, ...(ink.color ? { color: ink.color } : {}) });
    return this;
  }

  line(points: P[], ink: Ink = {}): this {
    this.strokes.push({ points: points.map((p) => this.at(p)), closed: false, fill: false, ...(ink.color ? { color: ink.color } : {}) });
    return this;
  }

  /** An ellipse, turned by `rot` radians, as a closed polyline. */
  ellipse(cx: number, cy: number, rx: number, ry: number, ink: Ink = {}, rot = 0): this {
    const n = Math.max(20, Math.min(72, Math.ceil((Math.PI * (rx + ry)) / 10)));
    const pts: P[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const ex = rx * Math.cos(a);
      const ey = ry * Math.sin(a);
      pts.push([cx + ex * Math.cos(rot) - ey * Math.sin(rot), cy + ex * Math.sin(rot) + ey * Math.cos(rot)]);
    }
    this.strokes.push({ points: pts.map((p) => this.at(p)), closed: true, fill: !!ink.fill, ...(ink.color ? { color: ink.color } : {}) });
    return this;
  }

  circle(cx: number, cy: number, r: number, ink: Ink = {}): this {
    return this.ellipse(cx, cy, r, r, ink);
  }

  rect(x: number, y: number, w: number, h: number, ink: Ink = {}, radius = 0): this {
    if (radius <= 0) return this.path(`M ${x} ${y} H ${x + w} V ${y + h} H ${x} Z`, ink);
    const r = radius;
    return this.path(`M ${x + r} ${y} H ${x + w - r} Q ${x + w} ${y} ${x + w} ${y + r} V ${y + h - r} Q ${x + w} ${y + h} ${x + w - r} ${y + h} H ${x + r} Q ${x} ${y + h} ${x} ${y + h - r} V ${y + r} Q ${x} ${y} ${x + r} ${y} Z`, ink);
  }

  /** A five-pointed star. */
  star(cx: number, cy: number, r: number, ink: Ink = {}): this {
    const pts: string[] = [];
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 === 0 ? r : r * 0.45;
      pts.push(`${i === 0 ? "M" : "L"} ${(cx + rr * Math.cos(a)).toFixed(1)} ${(cy + rr * Math.sin(a)).toFixed(1)}`);
    }
    return this.path(`${pts.join(" ")} Z`, ink);
  }

  /** A twinkle: a small plus. */
  twinkle(cx: number, cy: number, r: number, color: LectureInk = "yellow"): this {
    this.line([[cx - r, cy], [cx + r, cy]], { color });
    return this.line([[cx, cy - r], [cx, cy + r]], { color });
  }

  label(text: string, x: number, y: number, size?: number): this {
    const [lx, ly] = this.at([x, y]);
    this.labels.push({ text, x: lx, y: ly, ...(size ? { size: size * this.k } : {}) });
    return this;
  }

  done(): SketchDrawing {
    return { w: 1000, h: this.h, strokes: this.strokes, labels: this.labels };
  }
}

// ------------------------------------------------------------------ the drawings

/** Officer Vega: tall, visor helmet, long coat, a light baton — standing on the ground. */
export function officer(): SketchDrawing {
  const d = new Draw(1050, 0.84);
  d.ellipse(500, 1196, 235, 20, { color: "grey" });
  // legs, boots
  d.path("M 432 890 L 428 1140 L 484 1140 L 494 890 Z", { color: "blue", fill: true });
  d.path("M 506 890 L 516 1140 L 572 1140 L 568 890 Z", { color: "blue", fill: true });
  d.path("M 420 1134 L 488 1134 L 492 1186 L 396 1188 Q 394 1156 420 1134 Z", { color: "black", fill: true });
  d.path("M 512 1134 L 580 1134 Q 606 1156 604 1188 L 508 1186 Z", { color: "black", fill: true });
  // the long coat, split at the back
  d.path("M 392 372 Q 500 348 608 372 L 640 560 L 690 930 Q 600 952 506 928 L 500 720 L 494 928 Q 400 952 310 930 L 360 560 Z", { color: "violet", fill: true });
  d.line([[500, 392], [500, 640]], { color: "violet" });
  d.path("M 438 362 L 500 426 L 562 362", { color: "violet" });
  d.line([[402, 770], [456, 770]], { color: "violet" });
  d.line([[544, 770], [598, 770]], { color: "violet" });
  // belt and buckle
  d.path("M 372 640 L 628 640 L 632 670 L 368 670 Z", { color: "black", fill: true });
  d.rect(484, 634, 32, 42, { color: "yellow", fill: true }, 4);
  // sleeves, gloves, the baton
  d.path("M 394 374 Q 342 392 332 462 L 300 702 Q 318 716 342 708 L 376 522 Z", { color: "violet", fill: true });
  d.path("M 606 374 Q 658 392 668 462 L 700 692 Q 682 706 658 698 L 624 522 Z", { color: "violet", fill: true });
  d.path("M 672 704 L 772 588 L 790 604 L 692 720 Z", { color: "orange", fill: true });
  d.circle(320, 728, 27, { color: "black", fill: true });
  d.circle(680, 716, 27, { color: "black", fill: true });
  d.line([[792, 566], [812, 540]], { color: "yellow" });
  d.line([[806, 590], [836, 584]], { color: "yellow" });
  d.line([[770, 560], [772, 530]], { color: "yellow" });
  // shoulder plates
  d.path("M 382 370 Q 350 376 338 414 Q 366 402 404 404 Z", { color: "light-blue", fill: true });
  d.path("M 618 370 Q 650 376 662 414 Q 634 402 596 404 Z", { color: "light-blue", fill: true });
  // neck, helmet, visor
  d.line([[468, 322], [470, 362]]);
  d.line([[532, 322], [530, 362]]);
  d.path("M 398 252 Q 398 134 500 128 Q 602 134 602 252 L 602 300 Q 562 332 500 334 Q 438 332 398 300 Z", { color: "blue", fill: true });
  d.path("M 410 208 Q 500 186 590 208 L 586 264 Q 500 284 414 264 Z", { color: "light-blue", fill: true });
  d.line([[428, 222], [470, 212]]);
  d.path("M 480 304 Q 500 316 520 304");
  d.line([[500, 130], [500, 188]], { color: "orange" });
  d.circle(604, 250, 13, { color: "grey", fill: true });
  d.line([[590, 164], [628, 98]]);
  d.circle(631, 90, 10, { color: "orange", fill: true });
  // the badge, the buttons
  d.star(566, 474, 28, { color: "yellow", fill: true });
  for (const y of [470, 530, 590]) d.circle(482, y, 6, { color: "black", fill: true });
  return d.done();
}

/** A city at night: towers, lit windows, the moon, a flying car. `h` sets how tall the picture is. */
export function skyline(tall = 600): SketchDrawing {
  const h = Math.max(300, Math.min(1050, tall));
  const d = new Draw(h);
  const ground = h - 60;
  const up = (k: number) => ground - (ground - 90) * k;
  d.circle(840, Math.min(120, h * 0.16), 56, { color: "yellow", fill: true });
  d.circle(822, Math.min(120, h * 0.16) - 14, 10, { color: "yellow" });
  d.circle(856, Math.min(120, h * 0.16) + 18, 7, { color: "yellow" });
  for (const [x, y] of [
    [110, 0.12],
    [260, 0.07],
    [420, 0.17],
    [650, 0.09],
    [730, 0.24],
    [955, 0.3],
  ] as const)
    d.twinkle(x, h * y, 9);
  // towers, back to front
  const towers: Array<{ x: number; w: number; k: number; color: LectureInk }> = [
    { x: 150, w: 110, k: 0.62, color: "violet" },
    { x: 296, w: 96, k: 0.42, color: "light-blue" },
    { x: 430, w: 112, k: 0.8, color: "blue" },
    { x: 580, w: 122, k: 0.5, color: "violet" },
    { x: 738, w: 92, k: 0.66, color: "light-blue" },
    { x: 862, w: 100, k: 0.36, color: "blue" },
  ];
  for (const t of towers) {
    const top = up(t.k);
    d.rect(t.x, top, t.w, ground - top, { color: t.color, fill: true });
    // lit windows: a grid, a few dark
    const cols = t.w > 105 ? 3 : 2;
    const gap = (t.w - cols * 16) / (cols + 1);
    for (let y = top + 26, r = 0; y < ground - 40; y += 44, r++) {
      for (let c = 0; c < cols; c++) {
        if ((r * 7 + c * 3 + t.x) % 5 === 0) continue;
        d.rect(t.x + gap + c * (16 + gap), y, 16, 20, { color: "yellow", fill: true });
      }
    }
  }
  // a spire, an antenna with its light
  d.path(`M 150 ${up(0.62)} L 205 ${up(0.62) - 60} L 260 ${up(0.62)} Z`, { color: "violet", fill: true });
  d.line([[784, up(0.66)], [784, up(0.66) - 64]]);
  d.circle(784, up(0.66) - 70, 7, { color: "orange", fill: true });
  // the ground and the road
  d.line([[0, ground], [1000, ground]]);
  for (let x = 30; x < 1000; x += 90) d.line([[x, ground + 32], [x + 46, ground + 32]], { color: "grey" });
  // a flying car, going left
  const cy = Math.min(190, h * 0.3);
  d.path(`M 300 ${cy} Q 300 ${cy - 22} 330 ${cy - 22} L 420 ${cy - 22} Q 446 ${cy - 22} 446 ${cy} Q 446 ${cy + 18} 420 ${cy + 18} L 326 ${cy + 18} Q 300 ${cy + 18} 300 ${cy} Z`, { color: "orange", fill: true });
  d.path(`M 340 ${cy - 22} Q 350 ${cy - 52} 378 ${cy - 52} Q 404 ${cy - 52} 412 ${cy - 22} Z`, { color: "light-blue", fill: true });
  d.line([[462, cy - 8], [520, cy - 8]], { color: "grey" });
  d.line([[470, cy + 8], [548, cy + 8]], { color: "grey" });
  return d.done();
}

/** A plant cell, labelled the way a textbook does: leader lines out to the names either side. */
export function plantCell(): SketchDrawing {
  const d = new Draw(760);
  d.rect(270, 90, 460, 560, { color: "green" }, 64);
  d.rect(292, 112, 416, 516, { color: "green", fill: true }, 48);
  d.path("M 430 300 C 470 226 650 232 668 330 C 684 420 612 506 520 494 C 430 482 388 384 430 300 Z", { color: "light-blue", fill: true });
  d.circle(372, 486, 60, { color: "violet", fill: true });
  d.circle(384, 474, 18, { color: "violet", fill: true });
  const chloro = (x: number, y: number, rot: number) => {
    d.ellipse(x, y, 36, 18, { color: "green", fill: true }, rot);
    for (const t of [-14, 0, 14]) {
      const c = Math.cos(rot);
      const s = Math.sin(rot);
      d.line(
        [
          [x + t * c - 8 * s, y + t * s + 8 * c],
          [x + t * c + 8 * s, y + t * s - 8 * c],
        ],
        { color: "green" },
      );
    }
  };
  chloro(356, 196, -0.35);
  chloro(652, 214, 0.9);
  chloro(340, 346, 1.4);
  chloro(470, 584, -0.1);
  chloro(664, 560, 0.5);
  d.ellipse(560, 176, 40, 17, { color: "orange", fill: true }, 0.12);
  d.path("M 530 176 L 540 166 L 550 186 L 560 166 L 570 186 L 580 166 L 590 178", { color: "orange" });
  // leader lines and names
  d.line([[190, 128], [284, 150]]);
  d.label("Cell wall", 116, 124);
  d.line([[190, 300], [300, 300]]);
  d.label("Membrane", 110, 300);
  d.line([[190, 520], [318, 500]]);
  d.label("Nucleus", 116, 524);
  d.line([[812, 190], [690, 220]]);
  d.label("Chloroplast", 890, 184);
  d.line([[812, 380], [668, 370]]);
  d.label("Vacuole", 890, 384);
  d.line([[812, 110], [598, 170]]);
  d.label("Mitochondrion", 876, 96);
  return d.done();
}

/** A rocket lifting off: body, nose cone, porthole, fins, flame and smoke. */
export function rocket(): SketchDrawing {
  const d = new Draw(1050, 0.95);
  for (const [x, y] of [
    [160, 120],
    [820, 90],
    [260, 420],
    [780, 380],
    [130, 700],
    [880, 640],
  ] as const)
    d.twinkle(x, y, 10);
  d.line([[350, 170], [350, 290]], { color: "grey" });
  d.line([[650, 210], [650, 330]], { color: "grey" });
  d.line([[310, 330], [310, 400]], { color: "grey" });
  d.path("M 420 300 Q 420 176 500 88 Q 580 176 580 300 L 580 720 L 420 720 Z", { color: "blue", fill: true });
  d.path("M 436 232 Q 456 158 500 88 Q 544 158 564 232 Q 500 248 436 232 Z", { color: "orange", fill: true });
  d.circle(500, 360, 46, { color: "blue" });
  d.circle(500, 360, 33, { color: "light-blue", fill: true });
  d.path("M 480 342 Q 488 334 498 332", {});
  d.line([[420, 610], [580, 610]]);
  for (const x of [440, 470, 530, 560]) d.circle(x, 640, 3.5, { color: "black", fill: true });
  d.path("M 420 556 L 336 700 L 342 764 L 420 720 Z", { color: "orange", fill: true });
  d.path("M 580 556 L 664 700 L 658 764 L 580 720 Z", { color: "orange", fill: true });
  d.path("M 450 720 L 550 720 L 566 762 L 434 762 Z", { color: "grey", fill: true });
  d.path("M 440 766 Q 466 880 500 968 Q 534 880 560 766 Z", { color: "orange", fill: true });
  d.path("M 466 766 Q 484 842 500 906 Q 516 842 534 766 Z", { color: "yellow", fill: true });
  d.path("M 488 580 L 512 580 L 514 772 L 486 772 Z", { color: "orange", fill: true });
  for (const [x, y, r] of [
    [392, 912, 52],
    [318, 968, 60],
    [606, 918, 56],
    [684, 976, 58],
    [500, 1030, 48],
    [236, 1030, 44],
    [770, 1036, 44],
  ] as const)
    d.circle(x, y, r, { color: "grey" });
  return d.done();
}

/** A heart with a highlight, little hearts and sparkles round it, and a word on it. */
export function heart(): SketchDrawing {
  const d = new Draw(900);
  const small = (x: number, y: number, k: number, color: LectureInk) =>
    d.path(
      `M ${x} ${y - 25 * k} C ${x} ${y - 60 * k} ${x - 60 * k} ${y - 70 * k} ${x - 75 * k} ${y - 35 * k} C ${x - 90 * k} ${y} ${x - 45 * k} ${y + 40 * k} ${x} ${y + 80 * k} C ${x + 45 * k} ${y + 40 * k} ${x + 90 * k} ${y} ${x + 75 * k} ${y - 35 * k} C ${x + 60 * k} ${y - 70 * k} ${x} ${y - 60 * k} ${x} ${y - 25 * k} Z`,
      { color, fill: true },
    );
  d.path("M 500 250 C 500 120 300 80 230 200 C 160 320 250 470 500 720 C 750 470 840 320 770 200 C 700 80 500 120 500 250 Z", { color: "orange", fill: true });
  d.path("M 282 226 Q 256 270 270 330", { color: "orange" });
  d.path("M 300 196 Q 312 186 326 182", { color: "orange" });
  small(170, 640, 0.9, "violet");
  small(830, 660, 0.7, "light-blue");
  small(846, 130, 0.6, "violet");
  d.twinkle(150, 160, 16);
  d.twinkle(890, 400, 14);
  d.twinkle(120, 430, 12);
  d.twinkle(640, 800, 12);
  d.label("THANK YOU", 500, 380, 70);
  return d.done();
}

/** A simple series circuit: a battery, a bulb, a switch and a resistor, labelled, with the current. */
export function circuit(): SketchDrawing {
  const d = new Draw(700);
  d.line([[200, 320], [200, 160], [440, 160]]);
  d.line([[560, 160], [800, 160], [800, 310]]);
  d.line([[800, 310], [846, 384]]);
  d.circle(800, 310, 6, { fill: true });
  d.circle(800, 410, 6, { fill: true });
  d.line([[800, 410], [800, 560], [596, 560]]);
  d.line([[596, 560], [584, 536], [560, 584], [536, 536], [512, 584], [488, 536], [464, 584], [440, 536], [416, 560], [404, 560]]);
  d.line([[404, 560], [200, 560], [200, 396]]);
  d.line([[160, 320], [240, 320]]);
  d.line([[180, 346], [220, 346]]);
  d.line([[160, 372], [240, 372]]);
  d.line([[180, 396], [220, 396]]);
  d.circle(500, 160, 60, { color: "yellow", fill: true });
  d.path("M 466 176 L 478 136 L 490 176 L 502 136 L 514 176 L 526 136 L 534 176", { color: "orange" });
  d.line([[500, 80], [500, 52]], { color: "yellow" });
  d.line([[446, 104], [424, 82]], { color: "yellow" });
  d.line([[554, 104], [576, 82]], { color: "yellow" });
  d.line([[290, 136], [370, 136]], { color: "orange" });
  d.path("M 354 124 L 372 136 L 354 148", { color: "orange" });
  d.label("current", 330, 100);
  d.label("Battery", 80, 358);
  d.label("+", 262, 312, 44);
  d.label("-", 262, 392, 44);
  d.label("Bulb", 500, 262);
  d.label("Switch", 914, 360);
  d.label("Resistor", 500, 636);
  return d.done();
}

export const SKETCH_GALLERY: ReadonlyArray<{ title: string; drawing: SketchDrawing }> = [
  { title: "a futuristic police officer", drawing: officer() },
  { title: "a city skyline at night", drawing: skyline() },
  { title: "a plant cell, labelled", drawing: plantCell() },
  { title: "a rocket lifting off", drawing: rocket() },
  { title: "a heart, with a word on it", drawing: heart() },
  { title: "a simple circuit, labelled", drawing: circuit() },
];

/** The desk's box for a single picture, and for a comic strip across most of a 1600 × 900 screen. */
export const PICTURE_BOX = { w: 520, h: 420 } as const;
export const STRIP_BOX = { w: 1400, h: 520 } as const;

export interface Comic {
  title: string;
  box: { w: number; h: number };
  input: { count: number; captions: string[]; title?: string; framed: boolean };
  /** the drawing of each panel, made for its frame's aspect */
  draw: ReadonlyArray<(aspect: number) => SketchDrawing>;
}

export const COMICS: readonly Comic[] = [
  {
    title: "a four-panel comic, a strip across the screen",
    box: STRIP_BOX,
    input: {
      count: 4,
      title: "Officer Vega saves Neo City",
      captions: ["Neo City, 2099. The night shift begins.", "Officer Vega hears a call for help.", "She blasts off across the sky!", "Saved! The whole city says thank you."],
      framed: true,
    },
    draw: [(a) => skyline(Math.round(1000 / a)), () => officer(), () => rocket(), () => heart()],
  },
  {
    title: "three panels in a square box: two by two",
    box: { w: 760, h: 700 },
    input: { count: 3, title: "A rocket's day", captions: ["Ready on the pad", "Lift off!", "Home among the stars"], framed: true },
    draw: [() => rocket(), (a) => skyline(Math.round(1000 / a)), () => heart()],
  },
  {
    title: "one picture, no frame, a caption",
    box: PICTURE_BOX,
    input: { count: 1, title: "A plant cell", captions: ["Only plant cells have a wall and chloroplasts."], framed: false },
    draw: [() => plantCell()],
  },
];

// ------------------------------------------------------------------ drawing the sheet

/** tldraw's light theme: each colour's ink, and the pale tint its `solid` fill paints. */
const TLDRAW: Record<string, { ink: string; tint: string }> = {
  blue: { ink: "#4465e9", tint: "#dce1f8" },
  orange: { ink: "#e16919", tint: "#f8e2d4" },
  green: { ink: "#099268", tint: "#d3e9e3" },
  violet: { ink: "#ae3ec9", tint: "#ecdcf2" },
  "light-blue": { ink: "#4ba1f1", tint: "#ddedfa" },
  yellow: { ink: "#f1ac4b", tint: "#f9f0e6" },
  black: { ink: "#1d1d1d", tint: "#e8e8e8" },
  grey: { ink: "#9fa8b2", tint: "#eceef0" },
};

/**
 * A plan as the board inks it: each line in its colour, a closed stroke filled once whole, later on
 * top; each stroke as wide as tldraw draws a pen stroke at its weight (`1 + 2.4 × weight` px of
 * freehand at size "s", scaled so the tutor's full pen is the other sheets' 2.6 px).
 */
export function sketchInkSvg(plan: LectureSketch["plan"], dx: number, dy: number): string {
  const out: string[] = [];
  for (const line of plan.lines) {
    const c = TLDRAW[line.style?.color ?? "blue"] ?? TLDRAW.blue;
    const fill = line.style?.closed && line.style.fill && line.style.fill !== "none" ? c.tint : "none";
    for (const st of line.strokes) {
      const d = polylineToSvgD(st.points.map((p) => ({ x: +(p.x + line.x + dx).toFixed(2), y: +(p.y + line.y + dy).toFixed(2) }))) + (line.style?.closed ? " Z" : "");
      const width = 0.765 * (1 + 2.4 * (st.weight ?? 1));
      out.push(`<path d="${d}" fill="${fill}" stroke="${c.ink}" stroke-width="${width.toFixed(2)}"/>`);
    }
  }
  return `<g stroke-linecap="round" stroke-linejoin="round">${out.join("")}</g>`;
}

const PAD = 24;
const HEAD = 30;
const FOOT = 26;

export interface SketchGalleryCell {
  title: string;
  sketch: LectureSketch | null;
  box: { w: number; h: number };
}

export interface ComicCell {
  title: string;
  panels: PanelsSketch | null;
  drawings: Array<LectureSketch | null>;
  box: { w: number; h: number };
}

function esc(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function stats(sketches: ReadonlyArray<LectureSketch | null>): string {
  const ok = sketches.filter((s): s is LectureSketch => s !== null);
  const strokes = ok.reduce((n, s) => n + s.plan.lines.reduce((m, l) => m + l.strokes.length, 0), 0);
  const wall = ok.map((s) => s.plan.totalMs / (s.plan.pace ?? 1) / 1000);
  return `${strokes} strokes · ${wall.map((w) => w.toFixed(1)).join(" + ")} s`;
}

function cellFrame(ox: number, oy: number, cw: number, ch: number, title: string, box: { w: number; h: number }, drawn: boolean, note: string): { parts: string[]; bx: number; by: number } {
  const bx = ox + (cw - box.w) / 2;
  const by = oy + HEAD;
  return {
    bx,
    by,
    parts: [
      `<rect x="${ox}" y="${oy}" width="${cw}" height="${ch}" rx="10" fill="#ffffff" stroke="#e4e4de"/>`,
      `<text x="${ox + 14}" y="${oy + 20}" fill="#8a9099">${esc(title)}${drawn ? "" : "  [nothing drawn]"}</text>`,
      `<rect x="${bx}" y="${by}" width="${box.w}" height="${box.h}" fill="none" stroke="#eceae2" stroke-dasharray="4 4"/>`,
      `<text x="${ox + cw - 14}" y="${oy + ch - 8}" text-anchor="end" fill="#b0b4ba">${esc(note)}</text>`,
    ],
  };
}

function debugTexts(sk: LectureSketch, dx: number, dy: number): string {
  return sk.texts.map((t) => `<rect x="${(t.rect.x + dx).toFixed(1)}" y="${(t.rect.y + dy).toFixed(1)}" width="${t.rect.w.toFixed(1)}" height="${t.rect.h.toFixed(1)}" fill="#ffd9d9" fill-opacity="0.5" stroke="none"/>`).join("");
}

/** Plans a comic: its frames, then each panel's drawing made for its frame and planned into it. */
export function planComic(c: Comic, seed: number): ComicCell {
  const panels = sketchPanels(c.input, { seed, box: c.box });
  const drawings = panels
    ? panels.frames.map((f, i) => {
        const make = c.draw[i];
        return make ? sketchDrawing(make(f.w / f.h), { seed: seed + 101 * (i + 1), box: { w: f.w, h: f.h } }) : null;
      })
    : [];
  return { title: c.title, panels, drawings, box: c.box };
}

export function buildSketchGallery(debug = false): { svg: string; cells: SketchGalleryCell[]; comics: ComicCell[] } {
  const parts: string[] = [];
  const cols = 3;
  const cw = PICTURE_BOX.w + 2 * PAD;
  const ch = PICTURE_BOX.h + HEAD + FOOT;
  const width = PAD + cols * (cw + PAD);
  const cells: SketchGalleryCell[] = [];
  SKETCH_GALLERY.forEach((g, i) => {
    const sk = sketchDrawing(g.drawing, { seed: 41 + i * 53, box: PICTURE_BOX });
    cells.push({ title: g.title, sketch: sk, box: PICTURE_BOX });
    const ox = PAD + (i % cols) * (cw + PAD);
    const oy = PAD + Math.floor(i / cols) * (ch + PAD);
    const f = cellFrame(ox, oy, cw, ch, g.title, PICTURE_BOX, sk !== null, sk ? `${stats([sk])} · ${Math.round(sk.plan.bounds.w)}×${Math.round(sk.plan.bounds.h)}` : "");
    parts.push(...f.parts);
    if (sk) {
      if (debug) parts.push(debugTexts(sk, f.bx, f.by));
      parts.push(sketchInkSvg(sk.plan, f.bx, f.by));
    }
  });
  let y = PAD + Math.ceil(SKETCH_GALLERY.length / cols) * (ch + PAD);

  // the comics: the strip across the sheet, then the others side by side
  const comics = COMICS.map((c, i) => planComic(c, 900 + i * 77));
  const drawComic = (cc: ComicCell, ox: number, oy: number, cwid: number) => {
    const chh = cc.box.h + HEAD + FOOT;
    const all = cc.panels ? [cc.panels.sketch, ...cc.drawings] : [];
    const f = cellFrame(ox, oy, cwid, chh, cc.title, cc.box, cc.panels !== null, cc.panels ? `${stats(all)} · ${cc.panels.cols}×${cc.panels.rows} · captions ${cc.panels.captionSize} px` : "");
    parts.push(...f.parts);
    if (!cc.panels) return chh;
    if (debug) for (const r of cc.panels.frames) parts.push(`<rect x="${(r.x + f.bx).toFixed(1)}" y="${(r.y + f.by).toFixed(1)}" width="${r.w.toFixed(1)}" height="${r.h.toFixed(1)}" fill="#fff4c2" fill-opacity="0.6" stroke="none"/>`);
    if (debug) parts.push(debugTexts(cc.panels.sketch, f.bx, f.by));
    parts.push(sketchInkSvg(cc.panels.sketch.plan, f.bx, f.by));
    cc.panels.frames.forEach((r, i) => {
      const sk = cc.drawings[i];
      if (sk) parts.push(sketchInkSvg(sk.plan, f.bx + r.x, f.by + r.y));
    });
    return chh;
  };
  y += drawComic(comics[0], PAD, y, width - 2 * PAD) + PAD;
  let x = PAD;
  let rowH = 0;
  for (const cc of comics.slice(1)) {
    const cwid = cc.box.w + 2 * PAD;
    rowH = Math.max(rowH, drawComic(cc, x, y, cwid));
    x += cwid + PAD;
  }
  y += rowH + PAD;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${y}" viewBox="0 0 ${width} ${y}">
<rect width="100%" height="100%" fill="#f4f4ef"/>
${parts.join("\n")}
</svg>`.replace(/<text /g, '<text font-family="Menlo, monospace" font-size="12" ');
  return { svg, cells, comics };
}
