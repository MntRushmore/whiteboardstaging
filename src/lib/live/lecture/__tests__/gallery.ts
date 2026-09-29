import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { polylineToSvgD } from "@/lib/hand";
import type { ChartSpec, DiagramSpec } from "../contracts";
import { sketchChart } from "../chart";
import type { LectureSketch } from "../chart/sketch";
import { sketchDiagram } from "../diagram";
import { LECTURE_BOXES } from "../plan";
import { sketchHeading, sketchNote } from "../text";

/**
 * Contact sheets of lecture mode's sketches: every chart, diagram, heading and note below planned
 * at the desk's largest box and drawn stroke for stroke, exactly as the HandWriter would put it on
 * the board. They exist to be LOOKED AT — a label on a line, a cramped box or a wobbly outline is
 * obvious in a picture and invisible to a bounding-box assertion.
 *
 *   LECTURE_GALLERY=1 npx vitest run src/lib/live/lecture/__tests__/gallery.test.ts
 *
 * writes docs/lecture/charts.png, docs/lecture/diagrams.png and docs/lecture/words.png (via
 * `rsvg-convert`); `LECTURE_GALLERY=debug` also outlines every piece of writing's ink box. Every
 * ordinary test run builds the same sheets in memory (`gallery.test.ts`).
 */

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const CHART_GALLERY: ReadonlyArray<{ title: string; spec: ChartSpec }> = [
  {
    title: "bar: one series, a unit",
    spec: { kind: "bar", title: "Rainfall in London", labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"], series: [{ values: [55, 41, 42, 44, 49, 45] }], unit: "mm" },
  },
  {
    title: "bar: two series, a key",
    spec: {
      kind: "bar",
      title: "Sales by quarter",
      labels: ["Q1", "Q2", "Q3", "Q4"],
      series: [
        { name: "2023", values: [120, 135, 150, 180] },
        { name: "2024", values: [140, 160, 155, 210] },
      ],
      unit: "$",
      yLabel: "Sales (thousands)",
    },
  },
  {
    title: "bar: three series, negatives",
    spec: {
      kind: "bar",
      title: "Change in temperature",
      labels: ["Winter", "Spring", "Summer", "Autumn"],
      series: [
        { name: "Oslo", values: [-4, 3, 8, 1] },
        { name: "Rome", values: [2, 5, 9, 4] },
        { name: "Cairo", values: [1, -2, 3, 2] },
      ],
      unit: "°C",
    },
  },
  {
    title: "bar: 12 categories",
    spec: { kind: "bar", title: "Hours of sunshine", labels: months, series: [{ values: [62, 78, 115, 168, 199, 204, 212, 205, 149, 117, 72, 52] }] },
  },
  {
    title: "bar: long labels, a percentage",
    spec: {
      kind: "bar",
      title: "Greenhouse gas emissions",
      labels: ["Carbon dioxide", "Methane", "Nitrous oxide", "Fluorinated gases"],
      series: [{ values: [79, 11, 7, 3] }],
      unit: "%",
      xLabel: "Gas",
    },
  },
  {
    title: "bar: all equal",
    spec: { kind: "bar", labels: ["Red", "Green", "Blue"], series: [{ values: [5, 5, 5] }], yLabel: "Votes" },
  },
  {
    title: "line: one series",
    spec: {
      kind: "line",
      title: "UK population",
      labels: ["1950", "1960", "1970", "1980", "1990", "2000", "2010", "2020"],
      series: [{ values: [50.1, 52.4, 55.6, 56.3, 57.2, 58.9, 62.8, 67.1] }],
      yLabel: "Millions",
    },
  },
  {
    title: "line: three series",
    spec: {
      kind: "line",
      title: "Average test scores",
      labels: ["Week 1", "Week 2", "Week 3", "Week 4", "Week 5"],
      series: [
        { name: "Class A", values: [62, 66, 71, 75, 80] },
        { name: "Class B", values: [58, 57, 63, 64, 70] },
        { name: "Class C", values: [70, 72, 69, 74, 73] },
      ],
      unit: "%",
    },
  },
  {
    title: "pie: five slices",
    spec: {
      kind: "pie",
      title: "UK electricity by source",
      slices: [
        { label: "Wind", value: 29 },
        { label: "Gas", value: 32 },
        { label: "Nuclear", value: 14 },
        { label: "Biomass", value: 11 },
        { label: "Solar", value: 5 },
      ],
      unit: "%",
    },
  },
  {
    title: "pie: one tiny slice",
    spec: {
      kind: "pie",
      title: "Air",
      slices: [
        { label: "Nitrogen", value: 78 },
        { label: "Oxygen", value: 21 },
        { label: "Argon", value: 0.9 },
      ],
    },
  },
  {
    title: "scatter: with a trend line",
    spec: {
      kind: "scatter",
      title: "Revision and results",
      points: [
        { x: 1, y: 42 },
        { x: 2, y: 48 },
        { x: 2.5, y: 55 },
        { x: 3, y: 51 },
        { x: 4, y: 60 },
        { x: 4.5, y: 66 },
        { x: 5, y: 63 },
        { x: 6, y: 72 },
        { x: 7, y: 75 },
        { x: 8, y: 83 },
      ],
      xLabel: "Hours of revision",
      yLabel: "Test score",
      trend: true,
    },
  },
  {
    title: "table: 3 x 4",
    spec: {
      kind: "table",
      title: "States of matter",
      columns: ["State", "Shape", "Volume"],
      rows: [
        ["Solid", "Fixed", "Fixed"],
        ["Liquid", "Takes its container's shape", "Fixed"],
        ["Gas", "Fills its container", "Changes"],
      ],
    },
  },
  {
    title: "bar: long names lie down",
    spec: {
      kind: "bar",
      title: "Causes of deforestation",
      labels: ["Cattle ranching", "Small-scale farming", "Commercial agriculture", "Logging", "Mining and roads"],
      series: [{ values: [41, 21, 16, 12, 10] }],
      unit: "%",
    },
  },
  {
    title: "pie: eight slices, slivers merged",
    spec: {
      kind: "pie",
      title: "Where the money goes",
      slices: [
        { label: "Health", value: 40 },
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
  {
    title: "table: 4 x 6, long cells",
    spec: {
      kind: "table",
      title: "The planets",
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

export const DIAGRAM_GALLERY: ReadonlyArray<{ title: string; spec: DiagramSpec }> = [
  {
    title: "flow: four steps, labelled arrows",
    spec: { kind: "flow", title: "How a bill becomes law", steps: ["Bill drafted", "Commons debate", "Lords review", "Royal Assent"], arrows: ["vote", "", "passed"] },
  },
  {
    title: "flow: seven steps",
    spec: {
      kind: "flow",
      title: "The scientific method",
      steps: ["Ask a question", "Research", "Form a hypothesis", "Experiment", "Analyse the data", "Draw a conclusion", "Share results"],
    },
  },
  {
    title: "cycle: four steps",
    spec: { kind: "cycle", title: "The water cycle", steps: ["Evaporation", "Condensation", "Precipitation", "Collection"] },
  },
  {
    title: "cycle: eight steps",
    spec: {
      kind: "cycle",
      title: "The Krebs cycle",
      steps: ["Citrate", "Isocitrate", "Alpha-ketoglutarate", "Succinyl-CoA", "Succinate", "Fumarate", "Malate", "Oxaloacetate"],
    },
  },
  {
    title: "timeline: five events",
    spec: {
      kind: "timeline",
      title: "World War II",
      events: [
        { when: "1939", what: "Germany invades Poland" },
        { when: "1940", what: "Battle of Britain" },
        { when: "1941", what: "Pearl Harbor" },
        { when: "1944", what: "D-Day landings" },
        { when: "1945", what: "War ends in Europe" },
      ],
    },
  },
  {
    title: "timeline: eight events",
    spec: {
      kind: "timeline",
      events: [
        { when: "1903", what: "First powered flight" },
        { when: "1927", what: "Lindbergh crosses the Atlantic" },
        { when: "1947", what: "Sound barrier broken" },
        { when: "1957", what: "Sputnik" },
        { when: "1961", what: "Gagarin in orbit" },
        { when: "1969", what: "Moon landing" },
        { when: "1981", what: "First Space Shuttle" },
        { when: "1998", what: "Space station begun" },
      ],
    },
  },
  {
    title: "hub: five spokes",
    spec: { kind: "hub", title: "Causes of WWI", center: "World War I", spokes: ["Militarism", "Alliances", "Imperialism", "Nationalism", "Assassination of Franz Ferdinand"] },
  },
  {
    title: "hub: eight spokes",
    spec: { kind: "hub", center: "Renewable energy", spokes: ["Solar", "Wind", "Hydro", "Tidal", "Geothermal", "Biomass", "Wave power", "Hydrogen"] },
  },
  {
    title: "tree: two levels",
    spec: {
      kind: "tree",
      title: "Types of rock",
      root: "Rocks",
      children: [
        { text: "Igneous", children: ["Granite", "Basalt"] },
        { text: "Sedimentary", children: ["Limestone", "Sandstone"] },
        { text: "Metamorphic", children: ["Marble", "Slate"] },
      ],
    },
  },
  {
    title: "tree: twelve leaves",
    spec: {
      kind: "tree",
      title: "Vertebrates",
      root: "Vertebrates",
      children: [
        { text: "Mammals", children: ["Whale", "Bat", "Human"] },
        { text: "Birds", children: ["Eagle", "Penguin"] },
        { text: "Reptiles", children: ["Snake", "Lizard", "Turtle"] },
        { text: "Fish", children: ["Shark", "Salmon"] },
        { text: "Amphibians", children: ["Frog", "Newt"] },
      ],
    },
  },
  {
    title: "venn: a few items",
    spec: { kind: "venn", title: "Plant and animal cells", left: "Plant cell", right: "Animal cell", leftOnly: ["Cell wall", "Chloroplasts"], both: ["Nucleus", "Membrane"], rightOnly: ["Centrioles"] },
  },
  {
    title: "venn: four per region",
    spec: {
      kind: "venn",
      left: "Mitosis",
      right: "Meiosis",
      leftOnly: ["Two cells", "Identical", "Growth", "Repair"],
      both: ["Cell division", "DNA copied", "Has a nucleus", "Spindle forms"],
      rightOnly: ["Four cells", "Varied", "Gametes", "Crossing over"],
    },
  },
  {
    title: "flow: every arrow labelled",
    spec: { kind: "flow", title: "The rock cycle", steps: ["Magma", "Igneous rock", "Sediment", "Sedimentary rock", "Metamorphic rock"], arrows: ["cools", "weathering", "pressure", "heat and pressure"] },
  },
  {
    title: "hub: long spokes (a director's)",
    spec: {
      kind: "hub",
      title: "Why the Roman Republic fell",
      center: "Fall of the Republic",
      spokes: ["Power struggles between rival generals", "Growing gap between rich and poor", "Armies loyal to generals, not Rome", "Corruption in the Senate and courts", "Julius Caesar crossing the Rubicon"],
    },
  },
  {
    title: "cycle: a slash (a director's)",
    spec: { kind: "cycle", title: "The water cycle", steps: ["Evaporation", "Condensation", "Precipitation", "Runoff/Infiltration"] },
  },
];

export const WORDS_GALLERY: ReadonlyArray<{ title: string; kind: "heading" | "note"; text: string }> = [
  { title: "heading", kind: "heading", text: "Photosynthesis" },
  { title: "heading: long", kind: "heading", text: "The causes of the First World War, 1900-1914" },
  { title: "note", kind: "note", text: "Mitochondria make ATP, the energy currency of the cell." },
  { title: "note: punctuation", kind: "note", text: "Water boils at 100°C (212°F) at sea level; it's 71% of Earth's surface - roughly!" },
  { title: "note: long", kind: "note", text: "Newton's second law: the net force on an object equals its mass times its acceleration, F = ma." },
  { title: "note: accents and quotes", kind: "note", text: "Café, naïve, “résumé” and São Paulo — written plainly & clearly: $5 for #1?" },
  { title: "heading: continued", kind: "heading", text: "Photosynthesis (cont.)" },
];

/**
 * What is wrong with a sketch, as sentences (none on a good one): a point that is not a number,
 * a stroke too long for the HandWriter (`HAND_WRITE.maxPointsPerStroke`), bounds that do not match
 * the ink or leave the box, two pieces of writing that touch, a line of the pen through writing.
 */
export function problemsOf(sk: LectureSketch, box?: { w: number; h: number }): string[] {
  const out: string[] = [];
  const { plan, texts } = sk;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const rules: Array<{ x: number; y: number }> = [];
  for (const line of plan.lines) {
    for (const s of line.strokes) {
      if (s.points.length > 400) out.push(`a stroke of ${s.points.length} points`);
      if (s.points.length < 2) out.push("a stroke of one point");
      for (const p of s.points) {
        const x = line.x + p.x;
        const y = line.y + p.y;
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(p.z)) {
          out.push("a point that is not a number");
          continue;
        }
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        if (s.kind === "rule") rules.push({ x, y });
      }
    }
  }
  const b = plan.bounds;
  // the bounds start at (0, 0) and reach the ink's far edge; the ink starts at most a few px in
  if (Math.abs(b.x) > 1e-6 || Math.abs(b.y) > 1e-6) out.push("the bounds do not start at (0, 0)");
  if (minX < -0.5 || minY < -0.5 || Math.abs(maxX - (b.x + b.w)) > 0.5 || Math.abs(maxY - (b.y + b.h)) > 0.5) out.push(`bounds ${JSON.stringify(b)} do not hold the ink to its far edge`);
  if (box && (b.w > box.w + 0.5 || b.h > box.h + 0.5)) out.push(`${Math.round(b.w)}×${Math.round(b.h)} is bigger than the box ${box.w}×${box.h}`);
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const p = texts[i].rect;
      const q = texts[j].rect;
      if (p.x < q.x + q.w && p.x + p.w > q.x && p.y < q.y + q.h && p.y + p.h > q.y) out.push(`"${texts[i].text}" touches "${texts[j].text}"`);
    }
  }
  for (const t of texts) {
    const r = t.rect;
    if (rules.some((p) => p.x > r.x + 0.5 && p.x < r.x + r.w - 0.5 && p.y > r.y + 0.5 && p.y < r.y + r.h - 0.5)) out.push(`a line runs through "${t.text}"`);
  }
  let t = 0;
  const parts = new Set<string>();
  for (const line of plan.lines) {
    if (line.startMs < t - 1e-6) out.push("a line starts before the one before it");
    t = line.startMs;
    if (!line.part) out.push(`a line with no part name ("${line.latex}")`);
    else if (parts.has(line.part) || line.part.includes("~")) out.push(`the part name "${line.part}" is not unique`);
    else parts.add(line.part);
    if (line.style?.closed && line.strokes.length !== 1) out.push(`the closed part "${line.part}" is ${line.strokes.length} strokes`);
  }
  return out;
}

/**
 * What a live update writes: the parts of `after` that are new or whose ink moved or changed since
 * `before` (a part is the same when its line sits at the same place with the same strokes), and
 * the parts that went.
 */
export function partDiff(before: LectureSketch["plan"], after: LectureSketch["plan"]): { changed: string[]; added: string[]; removed: string[]; same: string[] } {
  const was = new Map(before.lines.map((l) => [l.part ?? "", l]));
  const now = new Map(after.lines.map((l) => [l.part ?? "", l]));
  const changed: string[] = [];
  const added: string[] = [];
  const same: string[] = [];
  for (const [part, l] of now) {
    const old = was.get(part);
    if (!old) added.push(part);
    else if (Math.abs(old.x - l.x) > 1e-6 || Math.abs(old.y - l.y) > 1e-6 || JSON.stringify(old.strokes) !== JSON.stringify(l.strokes) || JSON.stringify(old.style) !== JSON.stringify(l.style)) changed.push(part);
    else same.push(part);
  }
  const removed = [...was.keys()].filter((p) => !now.has(p));
  return { changed, added, removed, same };
}

/** Wall time of a sketch (ms). */
export function wallMs(sk: LectureSketch): number {
  return sk.plan.totalMs / (sk.plan.pace ?? 1);
}

/** tldraw's light theme: each colour's ink, and the pale tint its `solid` fill paints (`semi` paints off-white). */
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

/** A plan as the board would ink it: each line in its colour, a closed stroke filled once whole — in drawing order (later on top). */
export function inkSvg(plan: LectureSketch["plan"], dx: number, dy: number): string {
  const out: string[] = [];
  for (const line of plan.lines) {
    const c = TLDRAW[line.style?.color ?? "blue"] ?? TLDRAW.blue;
    const fill = line.style?.closed && line.style.fill && line.style.fill !== "none" ? (line.style.fill === "semi" ? "#fcfffe" : line.style.fill === "fill" ? c.ink : c.tint) : "none";
    for (const st of line.strokes) {
      const d = polylineToSvgD(st.points.map((p) => ({ x: +(p.x + line.x + dx).toFixed(2), y: +(p.y + line.y + dy).toFixed(2) }))) + (line.style?.closed ? " Z" : "");
      out.push(`<path d="${d}" fill="${fill}" stroke="${c.ink}"/>`);
    }
  }
  return `<g stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">${out.join("")}</g>`;
}

const PAD = 24;
const HEAD = 30;

export interface GalleryCell {
  title: string;
  drawn: boolean;
  strokes: number;
  wallMs: number;
  bounds: { x: number; y: number; w: number; h: number } | null;
  sketch: LectureSketch | null;
}

function cellSvg(ox: number, oy: number, cw: number, ch: number, title: string, box: { w: number; h: number }, sk: LectureSketch | null, debug: boolean, centre = true): { svg: string; paths: number } {
  const parts: string[] = [];
  parts.push(`<rect x="${ox}" y="${oy}" width="${cw}" height="${ch}" rx="10" fill="#ffffff" stroke="#e4e4de"/>`);
  parts.push(`<text x="${ox + 14}" y="${oy + 20}" fill="#8a9099">${esc(title)}${sk ? "" : "  [nothing drawn]"}</text>`);
  const bx = ox + (cw - box.w) / 2;
  const by = oy + HEAD;
  parts.push(`<rect x="${bx}" y="${by}" width="${box.w}" height="${Number.isFinite(box.h) ? box.h : ch - HEAD - 20}" fill="none" stroke="#eceae2" stroke-dasharray="4 4"/>`);
  let paths = 0;
  if (sk) {
    const plan = sk.plan;
    // the desk puts a sketch in the middle of the box it chose
    const dx = bx + (Number.isFinite(box.h) && centre ? (box.w - plan.bounds.w) / 2 : 0);
    const dy = by + (Number.isFinite(box.h) && centre ? (box.h - plan.bounds.h) / 2 : 0);
    if (debug) for (const t of sk.texts) parts.push(`<rect x="${(t.rect.x + dx).toFixed(1)}" y="${(t.rect.y + dy).toFixed(1)}" width="${t.rect.w.toFixed(1)}" height="${t.rect.h.toFixed(1)}" fill="#ffd9d9" fill-opacity="0.5" stroke="none"/>`);
    parts.push(inkSvg(plan, dx, dy));
    paths = plan.lines.reduce((n, l) => n + l.strokes.length, 0);
    const wall = plan.totalMs / (plan.pace ?? 1);
    parts.push(`<text x="${ox + cw - 14}" y="${oy + ch - 8}" text-anchor="end" fill="#b0b4ba">${paths} strokes · ${(wall / 1000).toFixed(1)} s · ${Math.round(plan.bounds.w)}×${Math.round(plan.bounds.h)}</text>`);
  }
  return { svg: parts.join("\n"), paths };
}

function sheet(cells: string[], cols: number, cw: number, ch: number, rows: number): string {
  const width = PAD + cols * (cw + PAD);
  const height = PAD + rows * (ch + PAD);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="100%" height="100%" fill="#f4f4ef"/>
${cells.join("\n")}
</svg>`.replace(/<text /g, '<text font-family="Menlo, monospace" font-size="12" ');
}

function cellOf(title: string, sk: LectureSketch | null): GalleryCell {
  return {
    title,
    drawn: sk !== null,
    strokes: sk ? sk.plan.lines.reduce((n, l) => n + l.strokes.length, 0) : 0,
    wallMs: sk ? sk.plan.totalMs / (sk.plan.pace ?? 1) : 0,
    bounds: sk?.plan.bounds ?? null,
    sketch: sk,
  };
}

/** The live sheet's stories: a spec as the lecturer says more, frame by frame. */
export const LIVE_STORIES: ReadonlyArray<{ title: string; frames: ReadonlyArray<{ caption: string; spec: ChartSpec | DiagramSpec }> }> = [
  {
    title: "a sales chart, as each quarter is said",
    frames: [
      [12, null, null, null, "Q1 was 12"],
      [12, 15, null, null, "Q2 was up to 15"],
      [12, 15, 9, null, "Q3 fell to 9"],
      [12, 16, 9, null, "correction: Q2 was 16"],
      [12, 16, 9, 22, "Q4: 22, past the top"],
    ].map(([a, b, c, d, caption]) => ({
      caption: caption as string,
      spec: { kind: "bar", title: "Sales this year", labels: ["Q1", "Q2", "Q3", "Q4"], series: [{ values: [a, b, c, d] as Array<number | null> }], unit: "$", yLabel: "Millions" } as ChartSpec,
    })),
  },
  {
    title: "a flow, as each step is said",
    frames: [3, 4, 5, 6, 7].map((n) => ({
      caption: `${n} steps`,
      spec: { kind: "flow", title: "The scientific method", steps: ["Ask a question", "Research", "Form a hypothesis", "Experiment", "Analyse the data", "Draw a conclusion", "Share results"].slice(0, n) } as DiagramSpec,
    })),
  },
];

/** The live sheet: each story's frames side by side, what each update writes lit up in yellow. */
export function buildLiveSheet(): { svg: string; frames: Array<{ story: string; caption: string; written: string[]; sketch: LectureSketch | null }> } {
  const box = LECTURE_BOXES.visual[0];
  const cw = box.w + 2 * PAD;
  const ch = box.h + HEAD + 26;
  const cols = 5;
  const parts: string[] = [];
  const frames: Array<{ story: string; caption: string; written: string[]; sketch: LectureSketch | null }> = [];
  let y = PAD;
  for (const story of LIVE_STORIES) {
    parts.push(`<text x="${PAD}" y="${y + 14}" fill="#5a5f66">${esc(story.title)}</text>`);
    y += 26;
    let before: LectureSketch | null = null;
    story.frames.forEach((f, i) => {
      const sk = "labels" in f.spec || "slices" in f.spec || "points" in f.spec || "columns" in f.spec ? sketchChart(f.spec as ChartSpec, { seed: 777, box }) : sketchDiagram(f.spec as DiagramSpec, { seed: 777, box });
      const d = sk && before ? partDiff(before.plan, sk.plan) : null;
      const written = sk ? (d ? [...d.added, ...d.changed] : sk.plan.lines.map((l) => l.part ?? "")) : [];
      frames.push({ story: story.title, caption: f.caption, written, sketch: sk });
      const ox = PAD + i * (cw + PAD);
      parts.push(`<rect x="${ox}" y="${y}" width="${cw}" height="${ch}" rx="10" fill="#ffffff" stroke="#e4e4de"/>`);
      parts.push(`<text x="${ox + 14}" y="${y + 20}" fill="#8a9099">${esc(f.caption)} — ${d ? `writes ${written.length} part${written.length === 1 ? "" : "s"}` : "first drawing"}</text>`);
      if (sk) {
        const dx = ox + PAD;
        const dy = y + HEAD;
        // what this update writes, lit up under the ink
        if (d) {
          for (const line of sk.plan.lines) {
            if (!written.includes(line.part ?? "")) continue;
            for (const st of line.strokes) parts.push(`<path d="${polylineToSvgD(st.points.map((p) => ({ x: +(p.x + line.x + dx).toFixed(2), y: +(p.y + line.y + dy).toFixed(2) })))}" fill="none" stroke="#ffe066" stroke-opacity="0.8" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>`);
          }
        }
        parts.push(inkSvg(sk.plan, dx, dy));
      }
      before = sk;
    });
    y += ch + PAD;
  }
  const width = PAD + cols * (cw + PAD);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${y}" viewBox="0 0 ${width} ${y}">
<rect width="100%" height="100%" fill="#f4f4ef"/>
${parts.join("\n")}
</svg>`.replace(/<text /g, '<text font-family="Menlo, monospace" font-size="12" ');
  return { svg, frames };
}

export function buildGallery(debug = false): { sheets: Record<"charts" | "diagrams" | "words" | "live", string>; cells: GalleryCell[] } {
  const box = LECTURE_BOXES.visual[0];
  const cw = box.w + 2 * PAD;
  const ch = box.h + HEAD + 26;
  const cols = 3;
  const cells: GalleryCell[] = [];
  const build = (items: ReadonlyArray<{ title: string; sk: LectureSketch | null }>) => {
    const svgs: string[] = [];
    items.forEach((it, i) => {
      const ox = PAD + (i % cols) * (cw + PAD);
      const oy = PAD + Math.floor(i / cols) * (ch + PAD);
      svgs.push(cellSvg(ox, oy, cw, ch, it.title, box, it.sk, debug).svg);
      cells.push(cellOf(it.title, it.sk));
    });
    return sheet(svgs, cols, cw, ch, Math.ceil(items.length / cols));
  };
  const charts = build(CHART_GALLERY.map((c, i) => ({ title: c.title, sk: sketchChart(c.spec, { seed: 11 + i * 97, box }) })));
  const diagrams = build(DIAGRAM_GALLERY.map((d, i) => ({ title: d.title, sk: sketchDiagram(d.spec, { seed: 23 + i * 89, box }) })));

  // the words: one per row, at the desk's widths
  const ww = LECTURE_BOXES.heading.maxW + 2 * PAD;
  const wsvgs: string[] = [];
  let y = PAD;
  WORDS_GALLERY.forEach((w, i) => {
    const maxW = w.kind === "heading" ? LECTURE_BOXES.heading.maxW : LECTURE_BOXES.note.maxW;
    const sk = w.kind === "heading" ? sketchHeading(w.text, { seed: 5 + i * 31, maxW }) : sketchNote(w.text, { seed: 5 + i * 31, maxW });
    const h = (sk?.plan.bounds.h ?? 60) + HEAD + 34;
    wsvgs.push(cellSvg(PAD, y, ww, h, `${w.title}: ${w.text}`, { w: maxW, h: (sk?.plan.bounds.h ?? 60) + 4 }, sk, debug, false).svg);
    cells.push(cellOf(w.title, sk));
    y += h + PAD;
  });
  const words = `<svg xmlns="http://www.w3.org/2000/svg" width="${ww + 2 * PAD}" height="${y}" viewBox="0 0 ${ww + 2 * PAD} ${y}">
<rect width="100%" height="100%" fill="#f4f4ef"/>
${wsvgs.join("\n")}
</svg>`.replace(/<text /g, '<text font-family="Menlo, monospace" font-size="12" ');
  return { sheets: { charts, diagrams, words, live: buildLiveSheet().svg }, cells };
}

function esc(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Writes the sheets to docs/lecture/*.png through `rsvg-convert` (the SVG when it is missing); returns the paths. */
export function writeGallery(root: string, sheets: Record<string, string>): string[] {
  const dir = join(root, "docs", "lecture");
  mkdirSync(dir, { recursive: true });
  const out: string[] = [];
  for (const [name, svg] of Object.entries(sheets)) {
    const tmp = join(tmpdir(), `lecture-gallery-${name}-${process.pid}.svg`);
    writeFileSync(tmp, svg);
    let done = false;
    for (const bin of ["rsvg-convert", "/opt/homebrew/bin/rsvg-convert"]) {
      try {
        execFileSync(bin, ["-o", join(dir, `${name}.png`), tmp]);
        out.push(join(dir, `${name}.png`));
        done = true;
        break;
      } catch {
        // try the next location
      }
    }
    if (!done) {
      writeFileSync(join(dir, `${name}.svg`), svg);
      out.push(join(dir, `${name}.svg`));
    }
  }
  return out;
}
