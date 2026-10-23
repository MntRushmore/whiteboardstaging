/**
 * The bank's plan: one slot per question to write, with its domain, skill, difficulty, format,
 * the figure it should carry (if any), a context to set it in, and its id. Deterministic, so a
 * rerun plans the same slots with the same ids (and hits the same cached model replies).
 *
 * The mix (docs/SAT-MODE.md): domains about 35/35/15/15, difficulty about a third each, about 25%
 * grid-ins. Grid-ins go where a single number is the natural answer: skills about reading a claim
 * or a study's design (evaluating statistical claims, inference) are mostly multiple choice, and the
 * numeric skills take more grid-ins so the whole bank still lands near 25%. Figures follow the
 * skill (scatterplots for two-variable data, shapes for geometry, tables for probability).
 *
 * Slot ids are `<domain>-<skill slug>-<nnnn>` with nnnn from 0101 up (0001-0099 are hand-written:
 * docs/sat/sample-20.json).
 */
import { SAT_DOMAINS, SAT_SKILLS, type SatDomain } from "../../src/lib/sat/contracts";

export type FigureHint = "table" | "plot" | "shape" | null;

export type Slot = {
  id: string;
  domain: SatDomain;
  skill: string;
  slug: string;
  difficulty: 1 | 2 | 3;
  format: "mcq" | "spr";
  figure: FigureHint;
  /** a setting to write it in (word problems), so the bank does not repeat itself */
  context: string;
};

/** Questions per skill (sums to 640: 224 / 224 / 96 / 96, so about 600 survive the checks). */
export const SKILL_QUOTA: Record<string, number> = {
  "linear equations in one variable": 45,
  "linear equations in two variables": 42,
  "linear functions": 48,
  "systems of two linear equations": 48,
  "linear inequalities": 41,
  "equivalent expressions": 72,
  "nonlinear equations and systems": 78,
  "nonlinear functions": 74,
  "ratios, rates, proportions, units": 18,
  percentages: 18,
  "one-variable data (distributions, centre, spread)": 15,
  "two-variable data (models, scatterplots)": 15,
  probability: 12,
  "inference from samples and margin of error": 9,
  "evaluating statistical claims": 9,
  "area and volume": 26,
  "lines, angles, triangles": 24,
  "right triangles and trigonometry": 24,
  circles: 22,
};

/** Share of a skill's questions that are grid-ins. */
const SPR_SHARE: Record<string, number> = {
  "linear equations in one variable": 0.4,
  "linear equations in two variables": 0.25,
  "linear functions": 0.25,
  "systems of two linear equations": 0.4,
  "linear inequalities": 0.2,
  "equivalent expressions": 0.15,
  "nonlinear equations and systems": 0.35,
  "nonlinear functions": 0.25,
  "ratios, rates, proportions, units": 0.4,
  percentages: 0.4,
  "one-variable data (distributions, centre, spread)": 0.25,
  "two-variable data (models, scatterplots)": 0.1,
  probability: 0.35,
  "inference from samples and margin of error": 0,
  "evaluating statistical claims": 0,
  "area and volume": 0.35,
  "lines, angles, triangles": 0.35,
  "right triangles and trigonometry": 0.25,
  circles: 0.3,
};

/** Share of a skill's questions with each figure kind (the rest have none). */
const FIGURE_SHARE: Record<string, Partial<Record<"table" | "plot" | "shape", number>>> = {
  "linear equations in two variables": { plot: 0.15, table: 0.1 },
  "linear functions": { plot: 0.3, table: 0.2 },
  "systems of two linear equations": { plot: 0.15 },
  "linear inequalities": { plot: 0.1 },
  "nonlinear equations and systems": { plot: 0.1 },
  "nonlinear functions": { plot: 0.3, table: 0.15 },
  "ratios, rates, proportions, units": { table: 0.15 },
  percentages: { table: 0.1 },
  "one-variable data (distributions, centre, spread)": { plot: 0.35, table: 0.25 },
  "two-variable data (models, scatterplots)": { plot: 0.65, table: 0.1 },
  probability: { table: 0.5 },
  "inference from samples and margin of error": { table: 0.1 },
  "evaluating statistical claims": {},
  "area and volume": { shape: 0.5 },
  "lines, angles, triangles": { shape: 0.65 },
  "right triangles and trigonometry": { shape: 0.6 },
  circles: { shape: 0.5, plot: 0.05 },
};

/** Settings for word problems, cycled through so contexts vary across the bank. */
export const CONTEXTS = [
  "a community garden", "a bike-share program", "a school robotics club", "a food truck", "a city bus route",
  "a recycling drive", "a marine biology survey", "a farmers market stall", "a rock-climbing gym", "a podcast's listeners",
  "a bakery's orders", "a solar panel installation", "a hiking trail", "a library's book loans", "a theater's ticket sales",
  "a phone data plan", "a fish tank", "a summer job", "a track team's practice", "a pottery studio",
  "a weather station", "a car-wash fundraiser", "a coffee roaster", "a ferry crossing", "a skate park",
  "a science fair experiment", "a band's merchandise", "a water reservoir", "a delivery drone", "an animal shelter",
  "a vending machine", "a ski resort", "a 3D printer", "a plant nursery", "an online store",
  "a cross-country road trip", "a museum's visitors", "a swimming pool", "a lemonade stand", "a city's tree census",
  "a music streaming app", "a fitness tracker", "a carpentry shop", "a snow-plough route", "a beekeeper's hives",
  "a soccer league", "a print shop", "a train timetable", "a chemistry lab solution", "a wildlife reserve",
  "a cooking class", "a parking garage", "an orchard", "a video game tournament", "an aquarium",
  "a student council election", "a hot-air balloon", "a tutoring centre", "a dog-walking business", "a paint mixing job",
];

function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Spread `n` items over categories by share (largest remainder), as a shuffled list. */
function spread<T>(n: number, shares: Array<[T, number]>, random: () => number): T[] {
  const raw = shares.map(([k, s]) => ({ k, x: n * s }));
  const counts = raw.map((r) => Math.floor(r.x));
  let left = n - counts.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, f: r.x - Math.floor(r.x) })).sort((a, b) => b.f - a.f);
  for (const o of order) {
    if (left <= 0) break;
    counts[o.i]++;
    left--;
  }
  const out: T[] = [];
  raw.forEach((r, i) => {
    for (let j = 0; j < counts[i]; j++) out.push(r.k);
  });
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function buildPlan(seed = 20261022): Slot[] {
  const random = seededRandom(seed);
  const slots: Slot[] = [];
  let ctx = 0;
  for (const domain of SAT_DOMAINS) {
    for (const { name, slug } of SAT_SKILLS[domain]) {
      const n = SKILL_QUOTA[name];
      const difficulties = spread<1 | 2 | 3>(n, [[1, 1 / 3], [2, 1 / 3], [3, 1 / 3]], random).sort();
      const formats = spread<"mcq" | "spr">(n, [["spr", SPR_SHARE[name]], ["mcq", 1 - SPR_SHARE[name]]], random);
      const fig = FIGURE_SHARE[name] ?? {};
      const none = 1 - Object.values(fig).reduce((a, b) => a + (b ?? 0), 0);
      const figures = spread<FigureHint>(n, [...(Object.entries(fig) as Array<[FigureHint, number]>), [null, none]], random);
      for (let i = 0; i < n; i++) {
        slots.push({
          id: `${domain}-${slug}-${String(101 + i).padStart(4, "0")}`,
          domain,
          skill: name,
          slug,
          difficulty: difficulties[i],
          format: formats[i],
          figure: figures[i],
          context: CONTEXTS[ctx++ % CONTEXTS.length],
        });
      }
    }
  }
  return slots;
}

/** Slots grouped for one generation call each: same skill and difficulty, at most `size` per call. */
export function batches(slots: readonly Slot[], size = 5): Slot[][] {
  const groups = new Map<string, Slot[]>();
  for (const s of slots) {
    const k = `${s.skill}|${s.difficulty}`;
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }
  const out: Slot[][] = [];
  for (const g of groups.values()) for (let i = 0; i < g.length; i += size) out.push(g.slice(i, i + size));
  return out;
}
