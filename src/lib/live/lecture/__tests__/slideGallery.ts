import type { LiveEngine, Rect } from "../../contracts";
import type { LectureAction, SketchDrawing } from "../contracts";
import { LECTURE_LAYOUT, LECTURE_SLIDE, LectureDesk, type LecturePlanners, type LectureRunOptions } from "../desk";
import { LECTURE_BOXES, planChart, planDiagram, planHeading, planNote } from "../plan";
import { planPanels, planSketch } from "../sketch/plan";
import { ChatDesk } from "../../chat/desk";
import { FakeBoard, SCREEN, type Written } from "./deskBoard";
import { plantCell, sketchInkSvg } from "./sketchGallery";

/**
 * The slide sheet (docs/lecture/slides.png): whole slides as the desk lays them out — the real
 * planners, the real desk, a fake board — drawn stroke for stroke as the board would ink them. It
 * exists to be LOOKED AT: a bullet too close to the chart, a column that runs under the lecture bar
 * or a lopsided slide is obvious in a picture and invisible to a bounding-box assertion.
 *
 *   LECTURE_GALLERY=1 npx vitest run src/lib/live/lecture/__tests__/deskSlides.test.ts
 *
 * `LECTURE_GALLERY=debug` also shades the slide's regions (the title band, the bullets' column, the
 * visual area) and the lecture bar's zone.
 */

export const REAL_PLANNERS: LecturePlanners = {
  boxes: LECTURE_BOXES,
  chart: planChart,
  diagram: planDiagram,
  heading: planHeading,
  note: planNote,
  sketches: { panels: planPanels, sketch: planSketch },
};

/** Slide one: a title, five bullets and a bar chart, as a lecture on the UK's electricity would build it. */
export const ELECTRICITY: readonly LectureAction[] = [
  { type: "heading", text: "Where UK electricity comes from" },
  { type: "note", text: "Gas and wind make over half of it" },
  {
    type: "chart",
    chart: {
      kind: "bar",
      title: "Share of UK electricity, 2023",
      labels: ["Gas", "Wind", "Nuclear", "Biomass", "Solar"],
      series: [{ values: [32, 29, 14, 11, 5] }],
      unit: "%",
    },
  },
  { type: "note", text: "Wind has grown fast since 2010" },
  { type: "note", text: "Nuclear gives a steady base load" },
  { type: "note", text: "Solar peaks in summer and is near zero in winter" },
  { type: "note", text: "Coal has all but gone from the grid" },
];

/** Slide two: a new topic, three bullets and one picture (framed at once; the drawing fills it when it comes). */
export const PLANT_CELLS: readonly LectureAction[] = [
  { type: "heading", text: "Plant cells" },
  { type: "note", text: "A rigid cell wall holds the cell's shape" },
  { type: "sketch", panels: [{ prompt: "a plant cell with its wall, vacuole, nucleus and chloroplasts, labelled", caption: "A plant cell" }] },
  { type: "note", text: "Chloroplasts turn light into sugar" },
  { type: "note", text: "A large vacuole stores water and keeps the cell firm" },
];

/** Slide three: a maths topic — two bullets, a graph (the chat desk's, placed as the slide's visual) and a formula down the column. */
export const PARABOLAS: readonly LectureAction[] = [
  { type: "heading", text: "Parabolas" },
  { type: "note", text: "A quadratic's graph is a parabola" },
  { type: "graph", relations: ["y = x^{2} - 4"] },
  { type: "note", text: "It crosses the x-axis at its roots" },
  { type: "write_lines", lines: ["x^{2} - 4 = 0", "x = \\pm 2"] },
];

export interface SlideShot {
  title: string;
  writes: Written[];
}

/**
 * The lecture, run through the desk: slide one whole; slide two while its picture is still coming
 * (the frame and caption up, the bullets going on), and once the drawing has filled the frame.
 */
export async function buildSlides(engine?: LiveEngine): Promise<{ shots: SlideShot[]; board: FakeBoard }> {
  const board = new FakeBoard();
  if (engine) board.engine = async () => engine;
  const desk = new LectureDesk(board, new ChatDesk(board), REAL_PLANNERS);
  let answer: (d: SketchDrawing) => void = () => undefined;
  const opts: LectureRunOptions = { requestSketch: () => new Promise<SketchDrawing>((resolve) => (answer = resolve)) };
  // a reply at a time, as the director sends them: a title and a point, the chart, more points
  await desk.run(ELECTRICITY.slice(0, 2), opts);
  await desk.run(ELECTRICITY.slice(2, 3), opts);
  await desk.run(ELECTRICITY.slice(3), opts);
  await desk.run(PLANT_CELLS.slice(0, 3), opts);
  await desk.run(PLANT_CELLS.slice(3), opts);
  const onPage = (id: string) => board.writes.filter((w) => w.page === id);
  const loading = onPage("p2");
  answer(plantCell());
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
  const shots: SlideShot[] = [
    { title: "slide 1: a title, five bullets and a bar chart", writes: onPage("p1") },
    { title: "slide 2: the picture's frame and caption at once, the bullets going on while it loads", writes: loading },
    { title: "slide 2: the drawing has filled its frame", writes: onPage("p2") },
  ];
  if (engine) {
    await desk.run(PARABOLAS, opts);
    shots.push({ title: "slide 3: the chat desk's graph as the slide's visual, a formula down the column", writes: onPage("p3") });
  }
  return { board, shots };
}

const PAD = 28;
const HEAD = 26;

function esc(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function rect(r: Rect, style: string): string {
  return `<rect x="${r.x.toFixed(1)}" y="${r.y.toFixed(1)}" width="${r.w.toFixed(1)}" height="${r.h.toFixed(1)}" ${style}/>`;
}

/** One slide: the 16:9 screen, the two bars floating over it, and every write on it. */
function slideSvg(shot: SlideShot, ox: number, oy: number, debug: boolean): string {
  const S = SCREEN;
  const parts: string[] = [];
  parts.push(`<text x="${ox}" y="${oy - 8}" fill="#5a5f66">${esc(shot.title)}</text>`);
  parts.push(rect({ x: ox, y: oy, w: S.w, h: S.h }, `rx="6" fill="#ffffff" stroke="#d9d9d2"`));
  // the board's own bar (top centre) and the lecture bar (bottom centre), as they float over the screen
  parts.push(rect({ x: ox + S.w / 2 - 260, y: oy + 14, w: 520, h: 44 }, `rx="22" fill="#f1f1ee" stroke="#e2e2dc"`));
  const Z = LECTURE_LAYOUT.barZone;
  const bar = { x: ox + S.w * Z.x0, y: oy + S.h * Z.y0, w: S.w * (Z.x1 - Z.x0), h: S.h * (1 - Z.y0) };
  parts.push(rect({ x: bar.x + 30, y: bar.y + 40, w: bar.w - 60, h: 64 }, `rx="32" fill="#f1f1ee" stroke="#e2e2dc"`));
  if (debug) {
    const top = oy + LECTURE_SLIDE.bodyTop;
    const bottom = oy + S.h * Z.y0 - 18;
    parts.push(rect(bar, `fill="#ffe3e3" fill-opacity="0.5" stroke="none"`));
    parts.push(rect({ x: ox + LECTURE_SLIDE.bullets.x, y: top, w: LECTURE_SLIDE.bullets.w, h: bottom - top }, `fill="#e3f0ff" fill-opacity="0.5" stroke="none"`));
    parts.push(rect({ x: ox + LECTURE_SLIDE.visual.x, y: top, w: S.w - 56 - LECTURE_SLIDE.visual.x, h: bottom - top }, `fill="#e6f7e6" fill-opacity="0.5" stroke="none"`));
  }
  for (const w of shot.writes) parts.push(sketchInkSvg(w.plan, ox, oy));
  return parts.join("\n");
}

/** The sheet: the slides one under the other, at the screen's own size. */
export function slidesSheet(shots: readonly SlideShot[], debug = false): string {
  const width = SCREEN.w + 2 * PAD;
  const height = PAD + shots.length * (SCREEN.h + HEAD + PAD);
  const body = shots.map((s, i) => slideSvg(s, PAD, PAD + HEAD + i * (SCREEN.h + HEAD + PAD), debug)).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="100%" height="100%" fill="#f4f4ef"/>
${body}
</svg>`.replace(/<text /g, '<text font-family="Menlo, monospace" font-size="15" ');
}
