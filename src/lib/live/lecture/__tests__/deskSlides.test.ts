import { beforeAll, describe, expect, it } from "vitest";
import type { LiveEngine, Rect } from "../../contracts";
import { FREE_AREA } from "../../chat/layout";
import { getEngine } from "../../engine";
import { HAND_BLOCK_META, type HandPlan } from "../../handwriting";
import { LECTURE_BLOCK_META, LECTURE_ID_META, LECTURE_LIMITS, LECTURE_WHAT_META, type ChartSpec, type LectureAction, type SketchDrawing } from "../contracts";
import { LECTURE_LAYOUT, LECTURE_SLIDE, type LectureRunOptions, type SketchPlanners } from "../desk";
import { writeGallery } from "./gallery";
import { boxPlan, FakeBoard, SCREEN, setup, type Written } from "./deskBoard";
import { buildSlides, slidesSheet } from "./slideGallery";

/**
 * SLIDES: the lecture desk lays each screen out as a slide — the title top left, the bullets down a
 * column on the left (six at most), ONE visual in the area on the right, nothing under the lecture
 * bar — and a full slide goes on on the next screen as "<title> (cont.)" (or under the reply's new
 * title). Fake planners draw each block as its box (`deskBoard.ts`); the slide sheet at the end
 * draws whole slides with the real ones (docs/lecture/slides.png).
 */

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

const S = LECTURE_SLIDE;
/** the body's foot on a 900 px screen: a clearance above the lecture bar */
const BOTTOM = SCREEN.h * LECTURE_LAYOUT.barZone.y0 - FREE_AREA.clearance;
const BAR_ZONE: Rect = {
  x: SCREEN.w * LECTURE_LAYOUT.barZone.x0,
  y: SCREEN.h * LECTURE_LAYOUT.barZone.y0,
  w: SCREEN.w * (LECTURE_LAYOUT.barZone.x1 - LECTURE_LAYOUT.barZone.x0),
  h: SCREEN.h * (1 - LECTURE_LAYOUT.barZone.y0),
};
const COLUMN = { x: S.bullets.x, right: S.bullets.x + S.bullets.w };
const AREA = { x: S.visual.x, right: SCREEN.w - FREE_AREA.margin };

const chart = (title: string, values: Array<number | null> = [7.6, 4.1, 0.1]): LectureAction => ({
  type: "chart",
  chart: { kind: "bar", title, labels: ["2021", "2022", "2023"].slice(0, values.length), series: [{ values }], unit: "%" },
});
const note = (text: string): LectureAction => ({ type: "note", text });
const heading = (text: string): LectureAction => ({ type: "heading", text });

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function inside(r: Rect, x0: number, x1: number, y0: number, y1: number): boolean {
  return r.x >= x0 - 0.01 && r.x + r.w <= x1 + 0.01 && r.y >= y0 - 0.01 && r.y + r.h <= y1 + 0.01;
}

const kind = (w: Written) => String(w.meta[LECTURE_BLOCK_META] ?? "");
const onPage = (board: FakeBoard, page: string) => board.writes.filter((w) => w.page === page);

describe("slides — where things go", () => {
  it("a slide: the title top left, the bullets down the left column, the chart in the visual area as large as it holds; nothing under the lecture bar", async () => {
    const { board, desk } = setup();
    const report = await desk.run([heading("The economy"), note("Growth slowed after 2021"), chart("GDP growth"), note("Prices rose fastest in 2022")]);
    expect(report.outcomes.map((o) => o.ok)).toEqual([true, true, true, true]);
    expect(report.screensAdded).toBe(0);
    const [title, b1, visual, b2] = board.writes;
    expect(title.plan.bounds).toMatchObject({ x: S.title.x, y: S.title.y });
    // the bullets: at the column's edge, from the body's top, one under the other
    expect(b1.plan.bounds).toMatchObject({ x: COLUMN.x, y: S.bodyTop });
    expect(b2.plan.bounds).toMatchObject({ x: COLUMN.x, y: b1.plan.bounds.y + b1.plan.bounds.h + S.bulletGap });
    // the visual: the whole area, level with the first bullet
    expect(visual.plan.bounds).toEqual({ x: AREA.x, y: S.bodyTop, w: AREA.right - AREA.x, h: BOTTOM - S.bodyTop });
    expect(board.page.meta.visuals?.[visual.meta[LECTURE_ID_META] as string]?.box).toEqual({ w: AREA.right - AREA.x, h: BOTTOM - S.bodyTop });
    for (const w of board.writes) expect(overlaps(w.plan.bounds, BAR_ZONE), kind(w)).toBe(false);
    for (const w of [b1, b2]) expect(inside(w.plan.bounds, COLUMN.x, COLUMN.right, S.bodyTop, BOTTOM)).toBe(true);
    // the body's foot sits a clearance above the lecture bar
    expect(visual.plan.bounds.y + visual.plan.bounds.h + FREE_AREA.clearance).toBeLessThanOrEqual(BAR_ZONE.y);
  });

  it("a bullet is planned as a slide's bullet, at the column's width", async () => {
    const asked: Array<{ maxW: number; slide?: boolean }> = [];
    const { desk } = setup({ note: (text, o) => (asked.push({ maxW: o.maxW, slide: o.slide }), boxPlan(text.length * 12, 36, text)) });
    await desk.run([heading("Cells"), note("Mitochondria make ATP")]);
    expect(asked).toEqual([{ maxW: S.bullets.w, slide: true }]);
  });

  it("a title that runs to two lines pushes the body down; the visual's box shrinks to the room left", async () => {
    const { board, desk } = setup({ heading: (text, { maxW }) => boxPlan(Math.min(text.length * 20, maxW), 120, text) });
    await desk.run([heading("A very long title"), note("one"), chart("GDP")]);
    const [title, b1, visual] = board.writes.map((w) => w.plan.bounds);
    const top = title.y + title.h + S.titleGap;
    expect(b1.y).toBe(top);
    expect(visual).toEqual({ x: AREA.x, y: top, w: AREA.right - AREA.x, h: BOTTOM - top });
  });

  it("a slide with no title (the lecture began without one): its body starts under the board's bar", async () => {
    const { board, desk } = setup();
    await desk.run([note("one"), chart("GDP")]);
    const [b1, visual] = board.writes.map((w) => w.plan.bounds);
    expect(b1).toMatchObject({ x: COLUMN.x, y: FREE_AREA.top });
    expect(visual).toMatchObject({ x: AREA.x, y: FREE_AREA.top, h: BOTTOM - FREE_AREA.top });
  });

  it("bullets are written quickly (~1–1.5 s each), and faster still while the lecture is ahead", async () => {
    // a slow planned bullet: 9 s at its natural pace
    const slow = (text: string): HandPlan => ({ ...boxPlan(text.length * 12, 36, text), totalMs: 9000, pace: 2 });
    const { board, desk } = setup({ note: slow });
    await desk.run([heading("Cells"), note("Mitochondria make ATP")]);
    const b = board.writes[1].plan;
    const wall = b.totalMs / (b.pace ?? 1);
    expect(wall).toBeGreaterThanOrEqual(S.bulletWallMs.min);
    expect(wall).toBeLessThanOrEqual(S.bulletWallMs.max);
    await desk.run([note("The nucleus holds the DNA")], { behind: () => true });
    const fast = board.writes[2].plan;
    expect(fast.totalMs / (fast.pace ?? 1)).toBeCloseTo(wall / LECTURE_LAYOUT.catchUpPace, 5);
    // the title keeps its own pace: it is written first, and the bullets after it
    expect(board.writes[0].plan.pace ?? 1).toBe(1);
  });
});

describe("slides — a full slide goes on as '<title> (cont.)'", () => {
  it("the seventh bullet: a new slide headed '<title> (cont.)', carrying the topic; the bullets go on there from the top of its body", async () => {
    const { board, desk } = setup();
    const bullets = Array.from({ length: LECTURE_LIMITS.slideBullets + 1 }, (_, i) => note(`point ${i + 1}`));
    const report = await desk.run([heading("Photosynthesis"), ...bullets.slice(0, 3)]);
    const more = await desk.run(bullets.slice(3));
    expect(report.screensAdded + more.screensAdded).toBe(1);
    expect([...report.outcomes, ...more.outcomes].every((o) => o.ok)).toBe(true);
    const first = onPage(board, "p1");
    expect(first.map(kind)).toEqual(["heading", ...Array(LECTURE_LIMITS.slideBullets).fill("note")]);
    const second = onPage(board, "p2");
    expect(second.map((w) => w.lead[LECTURE_WHAT_META])).toEqual(["heading: Photosynthesis (cont.)", "note: point 7"]);
    expect(second[0].plan.bounds).toMatchObject({ x: S.title.x, y: S.title.y });
    expect(second[0].plan.bounds.h).toBeCloseTo(44 * LECTURE_LAYOUT.contScale, 5);
    expect(second[1].plan.bounds).toMatchObject({ x: COLUMN.x, y: S.bodyTop });
    expect(board.pages[1].meta.topic).toBe("Photosynthesis");
    // and on: its own sixth bullet is followed by "(cont.)" again — of the topic, not "(cont.) (cont.)"
    await desk.run(Array.from({ length: LECTURE_LIMITS.slideBullets }, (_, i) => note(`more ${i}`)));
    expect(onPage(board, "p3")[0].lead[LECTURE_WHAT_META]).toBe("heading: Photosynthesis (cont.)");
  });

  it("bullets too tall for the room left: the one that would reach the lecture bar goes on the next slide", async () => {
    const { board, desk } = setup({ note: (text) => boxPlan(300, 100, text) });
    await desk.run([heading("Cells"), note("a"), note("b"), note("c"), note("d")]);
    expect(onPage(board, "p1").map(kind)).toEqual(["heading", "note", "note", "note"]);
    expect(onPage(board, "p2").map((w) => w.plan.lines[0].latex)).toEqual(["Cells (cont.)", "d"]);
    for (const w of board.writes) expect(w.plan.bounds.y + w.plan.bounds.h).toBeLessThanOrEqual(BOTTOM);
  });

  it("a second chart: the slide has its visual, so the chart goes on the next slide ('<title> (cont.)'), in its visual area", async () => {
    const { board, desk } = setup();
    await desk.run([heading("The economy"), note("Growth slowed"), chart("GDP growth")]);
    const report = await desk.run([chart("Inflation")]);
    expect(report).toMatchObject({ screensAdded: 1, outcomes: [{ type: "chart", ok: true, what: "bar chart: Inflation" }] });
    expect(onPage(board, "p2").map((w) => [kind(w), w.lead[LECTURE_WHAT_META] ?? ""])).toEqual([
      ["heading", "heading: The economy (cont.)"],
      ["chart", ""],
    ]);
    expect(onPage(board, "p2")[1].plan.bounds).toMatchObject({ x: AREA.x, y: S.bodyTop });
    expect(board.pages[1].meta.topic).toBe("The economy");
    // a diagram is a visual too
    const d = await desk.run([{ type: "diagram", diagram: { kind: "flow", steps: ["a", "b"] } }]);
    expect(d.screensAdded).toBe(1);
  });

  it("a heading and a chart in one reply: a new slide with both", async () => {
    const { board, desk } = setup();
    await desk.run([heading("The economy"), chart("GDP growth")]);
    const report = await desk.run([heading("Inflation"), chart("Prices")]);
    expect(report.screensAdded).toBe(1);
    expect(onPage(board, "p2").map((w) => w.plan.lines[0].latex)).toEqual(["Inflation", "chart"]);
    expect(onPage(board, "p2")[1].plan.bounds).toMatchObject({ x: AREA.x, y: S.bodyTop });
  });

  it("…and the chart first, the heading after it: the new title is written first, and heads the chart's slide (no '(cont.)' slide in between)", async () => {
    const { board, desk } = setup();
    await desk.run([heading("The economy"), chart("GDP growth")]);
    const report = await desk.run([chart("Prices"), heading("Inflation"), note("Prices rose fastest in 2022")]);
    expect(report.screensAdded).toBe(1);
    // the outcomes in the reply's order
    expect(report.outcomes.map((o) => [o.type, o.ok])).toEqual([
      ["chart", true],
      ["heading", true],
      ["note", true],
    ]);
    expect(report.outcomes[1].what).toBe("heading: Inflation");
    expect(onPage(board, "p2").map((w) => w.plan.lines[0].latex)).toEqual(["Inflation", "chart", "Prices rose fastest in 2022"]);
    expect(board.pages[1].meta.topic).toBe("Inflation");
    expect(board.pages).toHaveLength(2);
  });

  it("updates stay in place: a live chart updated after bullets were added is rewritten where it is, on its slide", async () => {
    const { board, desk } = setup();
    const r = await desk.run([heading("Sales"), chart("Sales", [12, null])]);
    const id = r.outcomes[1].id!;
    const entry = board.page.meta.visuals![id];
    await desk.run([note("Q1 was 12 million"), note("Q2 is still to come")]);
    const report = await desk.run([{ type: "update_chart", target: id, chart: (chart("Sales", [12, 15]) as { chart: ChartSpec }).chart }]);
    expect(report).toEqual({ outcomes: [{ type: "update_chart", ok: true, id, what: "bar chart: Sales" }], screensAdded: 0 });
    const after = board.page.meta.visuals![id];
    expect({ at: after.at, box: after.box }).toEqual({ at: entry.at, box: entry.box });
    expect(board.pages).toHaveLength(1);
  });
});

describe("slides — pictures and comics", () => {
  const FRAME_INSET = 10;
  /** Sketch planners that frame what they are asked to frame: the frame as a box, the drawing area inside it. */
  function framing(seen: boolean[]): SketchPlanners {
    return {
      panels: ({ count, captions, framed }, { box }) => {
        seen.push(framed);
        const w = (box.w - 20 * (count - 1)) / count;
        const band = captions.some(Boolean) ? 40 : 0;
        const frames = Array.from({ length: count }, (_, i) => ({ x: i * (w + 20) + FRAME_INSET, y: FRAME_INSET, w: w - 2 * FRAME_INSET, h: box.h - band - 2 * FRAME_INSET }));
        return { plan: boxPlan(box.w, box.h, framed ? "frame" : "caption"), frames };
      },
      sketch: (_d, { box }) => boxPlan(box.w * 0.9, box.h * 0.9, "drawing"),
    };
  }
  const drawing: SketchDrawing = { w: 1000, h: 800, strokes: [{ points: [[0, 0], [100, 100]], closed: false, fill: false }], labels: [] };
  const PICTURE: LectureAction = { type: "sketch", panels: [{ prompt: "a plant cell", caption: "A plant cell" }] };
  const COMIC: LectureAction = { type: "sketch", panels: [1, 2, 3].map((i) => ({ prompt: `scene ${i}`, caption: `Scene ${i}` })) };

  async function settle(): Promise<void> {
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
  }

  function illustrated() {
    const answers: Array<(d: SketchDrawing) => void> = [];
    const asked: number[] = [];
    const opts: LectureRunOptions = {
      requestSketch: (req) =>
        new Promise<SketchDrawing>((resolve) => {
          asked.push(req.aspect);
          answers.push(resolve);
        }),
    };
    return { answers, asked, opts };
  }

  it("a picture: its frame and caption at once, centred in the visual area; the drawing fills the frame when it comes", async () => {
    const seen: boolean[] = [];
    const { board, desk } = setup({ sketches: framing(seen) });
    const { answers, asked, opts } = illustrated();
    await desk.run([heading("Plant cells"), note("A rigid wall holds the shape")]);
    const report = await desk.run([PICTURE], opts);
    expect(report.outcomes).toEqual([{ type: "sketch", ok: true, id: expect.stringMatching(/^lv_/), what: "sketch: a plant cell" }]);
    // framed on a slide: the frame goes on the board with the run, before any drawing
    expect(seen[0]).toBe(true);
    const frame = board.writes[2];
    expect(frame.plan.lines[0].latex).toBe("frame");
    const w = Math.min(S.pictureMaxW, AREA.right - AREA.x);
    expect(frame.plan.bounds).toMatchObject({ x: AREA.x + (AREA.right - AREA.x - w) / 2, y: S.bodyTop, w });
    expect(frame.plan.bounds.y + frame.plan.bounds.h).toBeLessThanOrEqual(BOTTOM);
    expect(asked).toHaveLength(1);
    // the lecture goes on while it loads: a bullet, never in the frame
    await desk.run([note("Chloroplasts turn light into sugar")]);
    expect(overlaps(board.writes[3].plan.bounds, frame.plan.bounds)).toBe(false);
    answers[0](drawing);
    await settle();
    const fill = board.writes[4];
    expect(fill.plan.lines[0].latex).toBe("drawing");
    expect(inside(fill.plan.bounds, frame.plan.bounds.x, frame.plan.bounds.x + frame.plan.bounds.w, frame.plan.bounds.y, frame.plan.bounds.y + frame.plan.bounds.h)).toBe(true);
    expect(fill.meta[LECTURE_ID_META]).toBe(report.outcomes[0].id);
  });

  it("a formula while the picture loads: written under the bullets at once, without waiting for the drawing", async () => {
    const { board, desk } = setup({ sketches: framing([]) });
    board.engine = async () => engine;
    const { answers, opts } = illustrated();
    await desk.run([heading("Energy"), note("Mass and energy are one")], opts);
    await desk.run([PICTURE], opts);
    let waited = 0;
    board.onDelay = () => waited++;
    const report = await desk.run([{ type: "write_lines", lines: ["E = mc^{2}"] }]);
    expect(report.outcomes).toEqual([{ type: "write_lines", ok: true, what: "formula: E = mc^{2}" }]);
    expect(waited).toBe(0);
    expect(desk.sketching).toBe(1);
    const [, bullet, , formula] = board.writes;
    expect(formula.meta).toMatchObject({ chatBlock: "lines" });
    expect(inside(formula.plan.bounds, COLUMN.x, COLUMN.right, bullet.plan.bounds.y + bullet.plan.bounds.h, BOTTOM)).toBe(true);
    answers[0](drawing);
    await settle();
    expect(desk.sketching).toBe(0);
  });

  it("a picture on a slide that has its visual: the next slide", async () => {
    const { board, desk } = setup({ sketches: framing([]) });
    const { opts } = illustrated();
    await desk.run([heading("Plant cells"), chart("Sizes")]);
    const report = await desk.run([PICTURE], opts);
    expect(report.screensAdded).toBe(1);
    expect(onPage(board, "p2").map((w) => w.plan.lines[0].latex)).toEqual(["Plant cells (cont.)", "frame"]);
  });

  it("a comic takes a slide's whole body: on a slide with bullets, it goes on the next, in a band centred across it", async () => {
    const seen: boolean[] = [];
    const { board, desk } = setup({ sketches: framing(seen) });
    const { opts } = illustrated();
    await desk.run([heading("Future cops"), note("Cops of 2090")]);
    const report = await desk.run([COMIC], opts);
    expect(report.screensAdded).toBe(1);
    const band = onPage(board, "p2")[1].plan.bounds;
    expect(band.x).toBeCloseTo((SCREEN.w - band.w) / 2, 5);
    expect(band.y).toBe(S.bodyTop);
    expect(band.y + band.h).toBeLessThanOrEqual(BOTTOM);
    expect(seen.at(-1)).toBe(true);
  });
});

describe("slides — the chat's graphs, figures and formulas", () => {
  /** A figure the size of the box it is fitted into. */
  function figures(board: FakeBoard): void {
    board.planFigure = ((_spec: unknown, { box }: { box: { w: number; h: number } }) => ({ plan: boxPlan(box.w, box.h, "figure"), points: {} })) as unknown as FakeBoard["planFigure"];
  }
  const FIGURE = { type: "draw_figure", figure: { points: {} } } as unknown as LectureAction;

  it("a figure is the slide's visual: drawn by the chat desk in the visual area, never beside the title or over the bullets", async () => {
    const { board, desk } = setup();
    figures(board);
    await desk.run([heading("Triangles"), note("Angles add up to 180")]);
    const report = await desk.run([FIGURE]);
    expect(report.outcomes).toEqual([{ type: "draw_figure", ok: true, what: expect.stringMatching(/^figure/) }]);
    const fig = board.writes[2];
    expect(fig.meta).toMatchObject({ chatBlock: "figure" });
    expect(inside(fig.plan.bounds, AREA.x, AREA.right, S.bodyTop, BOTTOM)).toBe(true);
    expect(fig.plan.bounds).toMatchObject({ x: AREA.x, y: S.bodyTop });
  });

  it("a figure on a slide that has its visual: the next slide first, then the figure in its visual area", async () => {
    const { board, desk } = setup();
    figures(board);
    await desk.run([heading("Triangles"), chart("Angles")]);
    const report = await desk.run([FIGURE]);
    expect(report.screensAdded).toBe(1);
    const p2 = onPage(board, "p2");
    expect(p2.map((w) => w.plan.lines[0].latex)).toEqual(["Triangles (cont.)", "figure"]);
    expect(p2[1].plan.bounds).toMatchObject({ x: AREA.x, y: S.bodyTop });
  });

  it("no room in the visual area (the student's own ink there): the chat desk's new screen is the next slide, titled '<title> (cont.)'", async () => {
    const { board, desk } = setup();
    figures(board);
    await desk.run([heading("Triangles")]);
    board.put({ x: 800, y: 250, w: 700, h: 300 });
    const report = await desk.run([FIGURE, note("Angles add up to 180")]);
    expect(report.screensAdded).toBe(1);
    expect(report.outcomes.map((o) => o.ok)).toEqual([true, true]);
    const p2 = onPage(board, "p2");
    expect(p2.map((w) => w.plan.lines[0].latex)).toEqual(["figure", "Triangles (cont.)", "Angles add up to 180"]);
    expect(p2[0].plan.bounds).toMatchObject({ x: AREA.x, y: S.bodyTop });
    expect(p2[1].plan.bounds).toMatchObject({ x: S.title.x, y: S.title.y });
    expect(p2[2].plan.bounds).toMatchObject({ x: COLUMN.x, y: S.bodyTop });
    expect(board.pages[1].meta.topic).toBe("Triangles");
  });

  it("a graph through the real engine lands in the visual area; a formula goes down the bullets' column, under the last bullet", async () => {
    const { board, desk } = setup();
    board.engine = async () => engine;
    // the chat desk's own planners (the graph's and the formula's) draw them; the lecture's are fakes
    const report = await desk.run([heading("Parabolas"), note("A quadratic's graph is a parabola"), { type: "graph", relations: ["y = x^{2} - 4"] }, { type: "write_lines", lines: ["x^{2} - 4 = 0"] }]);
    expect(report.outcomes.map((o) => [o.type, o.ok])).toEqual([
      ["heading", true],
      ["note", true],
      ["graph", true],
      ["write_lines", true],
    ]);
    const [, b1, graph, lines] = board.writes;
    expect(graph.meta).toMatchObject({ chatBlock: "graph" });
    expect(inside(graph.plan.bounds, AREA.x - 1, AREA.right, S.bodyTop - 1, BOTTOM)).toBe(true);
    expect(lines.meta).toMatchObject({ chatBlock: "lines" });
    expect(inside(lines.plan.bounds, COLUMN.x - 1, COLUMN.right, b1.plan.bounds.y + b1.plan.bounds.h, BOTTOM)).toBe(true);
    // a graph is the slide's visual: a chart after it goes on the next slide
    expect((await desk.run([chart("Roots")])).screensAdded).toBe(1);
  });
});

describe("slides — screens that are not slides", () => {
  it("the student's own work on the screen: blocks go where there is room, as before — two charts side by side, notes past six", async () => {
    const { board, desk } = setup();
    board.put({ x: 1500, y: 820, w: 40, h: 30 });
    const report = await desk.run([note("one"), chart("A"), chart("B"), ...Array.from({ length: 7 }, (_, i) => note(`more ${i}`))]);
    expect(report.screensAdded).toBe(0);
    expect(report.outcomes.every((o) => o.ok)).toBe(true);
    const charts = board.writes.filter((w) => kind(w) === "chart");
    expect(charts.map((c) => c.plan.bounds.w)).toEqual([520, 520]);
    expect(board.writes.filter((w) => kind(w) === "note")).toHaveLength(8);
  });

  it("an old board's lecture screen (titled, laid out before slides) keeps working: the next bullet goes under its last note", async () => {
    const { board, desk } = setup();
    board.page.meta.topic = "Cells";
    board.put({ x: 56, y: 80, w: 200, h: 44 }, { [LECTURE_BLOCK_META]: "heading", [HAND_BLOCK_META]: "h1" });
    board.put({ x: 56, y: 150, w: 400, h: 36 }, { [LECTURE_BLOCK_META]: "note", [HAND_BLOCK_META]: "n1", createdAt: 1 });
    const report = await desk.run([note("two")]);
    expect(report.outcomes[0].ok).toBe(true);
    expect(board.writes[0].plan.bounds).toMatchObject({ x: COLUMN.x, y: Math.max(S.bodyTop, 150 + 36 + S.bulletGap) });
  });
});

describe("the slide sheet (docs/lecture/slides.png)", () => {
  it("draws whole slides through the desk with the real planners: every block inside the screen's margins, nothing under the lecture bar, bullets in their column, visuals in their area", async () => {
    const flag = process.env.LECTURE_GALLERY;
    const { shots } = await buildSlides(engine);
    const svg = slidesSheet(shots, flag === "debug");
    if (flag) console.log(`wrote ${writeGallery(process.cwd(), { slides: svg }).join(", ")}`);
    expect(svg).not.toContain("NaN");
    expect(shots.map((s) => s.writes.map(kind).filter(Boolean))).toEqual([
      ["heading", "note", "chart", "note", "note", "note", "note"],
      ["heading", "note", "sketch", "note", "note"],
      ["heading", "note", "sketch", "note", "note", "sketch"],
      ["heading", "note", "note"],
    ]);
    for (const shot of shots) {
      for (const w of shot.writes) {
        const b = w.plan.bounds;
        expect(overlaps(b, BAR_ZONE), `${shot.title}: ${kind(w)}`).toBe(false);
        expect(inside(b, FREE_AREA.margin - 8, SCREEN.w - FREE_AREA.margin + 8, S.title.y - 1, BOTTOM + 0.5), `${shot.title}: ${kind(w)}`).toBe(true);
        if (kind(w) === "note") expect(inside(b, COLUMN.x, COLUMN.right, S.bodyTop, BOTTOM)).toBe(true);
        if (kind(w) === "chart" || kind(w) === "sketch") expect(inside(b, AREA.x - 8, AREA.right + 8, S.bodyTop, BOTTOM + 0.5), kind(w)).toBe(true);
      }
    }
    // each bullet written in about a second
    for (const w of shots[0].writes.filter((x) => kind(x) === "note")) expect(w.plan.totalMs / (w.plan.pace ?? 1)).toBeLessThanOrEqual(S.bulletWallMs.max);
  });
});
