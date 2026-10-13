/**
 * Torn paper for the landing page (v4, "warm it up"): the jagged edge where one band of the page
 * meets the next (`TornEdge`), and the torn outline of a scrap of paper (the hero's painting, the
 * "Not a cheat button." collage). Small, irregular tears, the way a sheet tears by hand: a slow wander
 * along the edge, smaller steps on it, a fine fibrous jitter, and now and then a nick.
 *
 * Deterministic: the same seed tears the same edge, on the server and in every test, so the page's
 * HTML never changes between renders. Pure: no React, no DOM.
 */
import { mulberry32 } from "@/lib/hand/path";

/** One point of a tear: `at` px along the edge, `bite` px in from the paper's outermost reach. */
export interface TearPoint {
  at: number;
  bite: number;
}

export interface TearOptions {
  /** the tear's own seed: the same seed, the same tear */
  seed: number;
  /** how deep the tear can bite, in px (the gap between its highest and lowest points) */
  depth: number;
  /** the shortest and longest step between two points along the edge, in px */
  step?: readonly [number, number];
}

/** The wander's layers: how far apart its knots are (px) and how much of the depth each may use. */
const LAYERS = [
  { span: 170, amp: 0.42 },
  { span: 41, amp: 0.2 },
  { span: 9.5, amp: 0.1 },
] as const;

const smooth = (t: number) => t * t * (3 - 2 * t);
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * The tear along an edge `length` px long: points from 0 to `length`, each with how deep it bites
 * (0 to `depth`). Value noise in three layers, a little jitter, and a nick now and then.
 */
export function tear(length: number, { seed, depth, step = [3.5, 8] }: TearOptions): TearPoint[] {
  const rng = mulberry32(seed);
  // each layer's knots, one every `span` px, with a random height in -1..1
  const knots = LAYERS.map(({ span }) => Array.from({ length: Math.ceil(length / span) + 2 }, () => rng() * 2 - 1));
  const wander = (x: number) =>
    LAYERS.reduce((sum, { span, amp }, k) => {
      const i = Math.floor(x / span);
      const a = knots[k][i];
      const b = knots[k][i + 1];
      return sum + amp * (a + (b - a) * smooth(x / span - i));
    }, 0);
  const [min, max] = step;
  const points: TearPoint[] = [];
  let nick = 0;
  for (let x = 0; ; x = Math.min(length, x + min + rng() * (max - min))) {
    let bite = depth * (0.5 + wander(x)) + (rng() - 0.5) * 0.14 * depth;
    // a nick: the paper gives a little more for a step or two
    if (nick > 0) {
      bite += depth * 0.22;
      nick--;
    } else if (rng() < 0.018) {
      nick = 1 + Math.floor(rng() * 2);
    }
    points.push({ at: round1(x), bite: round1(Math.min(depth, Math.max(0, bite))) });
    if (x >= length) break;
  }
  return points;
}

export interface TornEdgeShape {
  /** SVG path data: the paper, torn along its top, flat along its bottom (y = height) */
  d: string;
  /**
   * The torn edge's fibre (or null): a thin band just outside the edge, where a sheet torn by hand
   * shows its pale core, in px of uneven width (0.5 to 2.4).
   */
  fiber: string | null;
  width: number;
  height: number;
}

/** Room above the tear for its fibre, in px. */
const FIBER_ROOM = 2.4;
/** Paper under the deepest bite, in px, so the edge always meets its band with no gap. */
const BASE = 2;

/** A path from points: absolute rounded coordinates, written as relative steps so the path stays short. */
function pathFrom(points: readonly { x: number; y: number }[], bottom: number, width: number): string {
  let d = `M0 ${bottom}V${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const dx = round1(points[i].x - points[i - 1].x);
    const dy = round1(points[i].y - points[i - 1].y);
    d += `l${dx}${dy < 0 ? dy : ` ${dy}`}`;
  }
  // the last point is at x = width: down to the flat bottom, and back along it
  return `${d}L${width} ${bottom}Z`;
}

/**
 * A band's torn top edge, `width` px wide (wider than any screen: the SVG shows its middle at 1:1),
 * for `TornEdge`. With `fiber`, also the pale fibre along the tear.
 */
export function tornEdge({ seed, width = 1920, depth = 10, fiber = false }: { seed: number; width?: number; depth?: number; fiber?: boolean }): TornEdgeShape {
  const room = fiber ? FIBER_ROOM : 0;
  const height = round1(room + depth + BASE);
  const edge = tear(width, { seed, depth }).map((p) => ({ x: p.at, y: round1(room + p.bite) }));
  const d = pathFrom(edge, height, width);
  if (!fiber) return { d, fiber: null, width, height };
  // the fibre's own width wanders along the edge, never quite gone and never more than the room
  const thick = tear(width, { seed: seed + 7919, depth: FIBER_ROOM - 0.5, step: [3.5, 8] });
  let j = 0;
  const outer = edge.map((p) => {
    while (j < thick.length - 1 && thick[j + 1].at <= p.x) j++;
    return { x: p.x, y: round1(Math.max(0, p.y - 0.5 - thick[j].bite)) };
  });
  return { d, fiber: pathFrom(outer, height, width), width, height };
}

/** A nominal scrap of paper and how its four edges tear. */
export interface TornOutlineOptions {
  seed: number;
  /** the paper's size as laid out, in px: the tear is shaped at this size and kept in proportion */
  width: number;
  height: number;
  /** how deep each edge can bite, in px */
  depth?: number;
  step?: readonly [number, number];
}

const pct = (n: number) => `${Math.round(n * 10000) / 100}%`;
const px = (n: number) => (n === 0 ? "0" : `${n}px`);
const inset = (n: number) => (n === 0 ? "100%" : `calc(100% - ${n}px)`);

/**
 * A CSS `clip-path` for a scrap of paper with all four edges torn: positions along each edge in %
 * (so it keeps its shape as the scrap scales), bites in px (so a tear is the same size at every
 * width). Clockwise from the top-left corner.
 */
export function tornOutline({ seed, width, height, depth = 6, step = [6, 14] }: TornOutlineOptions): string {
  const top = tear(width, { seed, depth, step });
  const right = tear(height, { seed: seed + 1, depth, step });
  const bottom = tear(width, { seed: seed + 2, depth, step });
  const left = tear(height, { seed: seed + 3, depth, step });
  const points = [
    ...top.map((p) => `${pct(p.at / width)} ${px(p.bite)}`),
    ...right.map((p) => `${inset(p.bite)} ${pct(p.at / height)}`),
    ...bottom.map((p) => `${pct(1 - p.at / width)} ${inset(p.bite)}`),
    ...left.map((p) => `${px(p.bite)} ${pct(1 - p.at / height)}`),
  ];
  return `polygon(${points.join(",")})`;
}
