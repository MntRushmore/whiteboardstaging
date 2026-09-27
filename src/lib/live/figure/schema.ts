import { z } from "zod";

/**
 * "The model perceives, the engine reasons": what a vision model says it SEES in a hand-drawn
 * figure — which label is which angle or side, and the relationships the drawing shows (tick marks,
 * arrow marks, a right-angle box, a straight line, a circle) — and nothing it worked out. The
 * equations come from `planFigure` (./plan.ts), deterministically.
 *
 * Validated leniently where a model's slip costs nothing (a synonym for a fact's name, an empty
 * label, a number written as a string) and strictly where it matters (every fact names quantities
 * of the right kind, the right number of them). A fact that does not validate is dropped and
 * counted; `planFigure` then decides whether what is left still makes sense.
 */

export const ANGLE_FACTS = [
  "triangle",
  "straight_line",
  "around_point",
  "right_angle_parts",
  "vertical",
  "corresponding",
  "alternate_interior",
  "alternate_exterior",
  "co_interior",
  "exterior_angle",
  "isosceles",
  "right_angle",
  "polygon",
  "regular_polygon",
  "exterior_angles",
  "inscribed_central",
  "same_arc",
  "tangent_radius",
  "semicircle",
  "cyclic_opposite",
] as const;
export const LENGTH_FACTS = ["right_triangle", "similar", "midsegment"] as const;
/** facts about angles or sides (the same kind throughout) */
export const EITHER_FACTS = ["equal", "equilateral"] as const;
export const FACT_TYPES = [...ANGLE_FACTS, ...LENGTH_FACTS, ...EITHER_FACTS] as const;
export type FactType = (typeof FACT_TYPES)[number];

/** Names models use for the same thing. */
const FACT_SYNONYMS: Record<string, FactType> = {
  triangle_angles: "triangle",
  angle_sum: "triangle",
  angles_in_triangle: "triangle",
  linear_pair: "straight_line",
  angles_on_a_line: "straight_line",
  angles_on_line: "straight_line",
  angles_on_a_straight_line: "straight_line",
  supplementary: "straight_line",
  angles_at_a_point: "around_point",
  angles_around_a_point: "around_point",
  full_turn: "around_point",
  complementary: "right_angle_parts",
  vertically_opposite: "vertical",
  vertical_angles: "vertical",
  alternate: "alternate_interior",
  alternate_angles: "alternate_interior",
  corresponding_angles: "corresponding",
  same_side_interior: "co_interior",
  consecutive_interior: "co_interior",
  cointerior: "co_interior",
  allied: "co_interior",
  exterior: "exterior_angle",
  exterior_angle_theorem: "exterior_angle",
  isosceles_triangle: "isosceles",
  equal_angles: "equal",
  equal_sides: "equal",
  congruent: "equal",
  equilateral_triangle: "equilateral",
  right: "right_angle",
  perpendicular: "right_angle",
  pythagoras: "right_triangle",
  pythagorean: "right_triangle",
  polygon_angles: "polygon",
  interior_angles: "polygon",
  polygon_exterior_angles: "exterior_angles",
  inscribed_and_central: "inscribed_central",
  central_inscribed: "inscribed_central",
  inscribed_same_arc: "same_arc",
  tangent: "tangent_radius",
  angle_in_semicircle: "semicircle",
  thales: "semicircle",
  cyclic_quadrilateral: "cyclic_opposite",
  similar_triangles: "similar",
  midline: "midsegment",
};

const factName = z.preprocess((v) => {
  if (typeof v !== "string") return v;
  const k = v.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return FACT_SYNONYMS[k] ?? k;
}, z.enum(FACT_TYPES));

const id = z.preprocess((v) => (typeof v === "number" ? String(v) : v), z.string().trim().min(1).max(24));
const ids = (min: number, max: number) => z.array(id).min(min).max(max);
const count = z.preprocess((v) => (typeof v === "string" ? Number(v) : v), z.number().int().min(3).max(20));

const itemsFor: Record<FactType, z.ZodTypeAny> = {
  triangle: ids(3, 3),
  straight_line: ids(2, 6),
  around_point: ids(2, 8),
  right_angle_parts: ids(2, 4),
  vertical: ids(2, 2),
  corresponding: ids(2, 2),
  alternate_interior: ids(2, 2),
  alternate_exterior: ids(2, 2),
  co_interior: ids(2, 2),
  exterior_angle: ids(3, 3),
  isosceles: ids(3, 3),
  right_angle: ids(1, 1),
  polygon: ids(3, 20),
  regular_polygon: ids(1, 1),
  exterior_angles: ids(3, 20),
  inscribed_central: ids(2, 2),
  same_arc: ids(2, 4),
  tangent_radius: ids(1, 1),
  semicircle: ids(1, 1),
  cyclic_opposite: ids(2, 2),
  right_triangle: ids(3, 3),
  similar: z.array(ids(2, 2)).min(2).max(3),
  midsegment: ids(2, 2),
  equal: ids(2, 4),
  equilateral: ids(1, 6),
};

/** One quantity the figure shows: an angle or a side, with its label as written (null: unlabelled). */
export const FigureQuantitySchema = z.object({
  id,
  what: z.preprocess((v) => {
    if (typeof v !== "string") return v;
    const k = v.trim().toLowerCase();
    return /^(side|segment|length|edge|radius|diameter|chord|line)/.test(k) ? "length" : /^angle|^arc/.test(k) ? "angle" : k;
  }, z.enum(["angle", "length"])),
  label: z.preprocess((v) => {
    if (v === undefined || v === null) return null;
    if (typeof v === "number") return String(v);
    if (typeof v !== "string") return v;
    const t = v.trim();
    return t === "" || /^(none|null|unlabell?ed|-)$/i.test(t) ? null : t;
  }, z.string().max(60).nullable()),
  /** where it is, in a few words (for the model's own bookkeeping and the dev panel) */
  at: z.string().max(120).optional().catch(undefined),
});
export type FigureQuantity = z.infer<typeof FigureQuantitySchema>;

export interface FigureFact {
  type: FactType;
  /** the quantities it relates (`similar`: pairs [side, the matching side in the other figure]) */
  items: string[] | string[][];
  /** `polygon` / `regular_polygon`: how many sides */
  sides?: number;
  /** `regular_polygon`: which angle the item is */
  angle?: "interior" | "exterior";
}

/** One fact, checked against the shape its type needs; null when it does not fit. */
export function parseFact(raw: unknown): FigureFact | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const type = factName.safeParse(r.type ?? r.fact ?? r.kind);
  if (!type.success) return null;
  const items = itemsFor[type.data].safeParse(r.items ?? r.angles ?? r.sides_ids ?? r.pairs);
  if (!items.success) return null;
  const fact: FigureFact = { type: type.data, items: items.data as string[] | string[][] };
  if (type.data === "polygon" || type.data === "regular_polygon") {
    const n = count.safeParse(r.sides ?? r.n ?? (type.data === "polygon" ? (items.data as string[]).length : undefined));
    if (!n.success) return null;
    fact.sides = n.data;
  }
  if (type.data === "regular_polygon") {
    const a = typeof r.angle === "string" ? r.angle.trim().toLowerCase() : "interior";
    if (a !== "interior" && a !== "exterior") return null;
    fact.angle = a;
  }
  return fact;
}

/**
 * The model's whole reply for a figure. `quantities` and `facts` are the structured read; `lines` is
 * its own free-form setup (the old reply), kept as the fallback when the read does not hold up;
 * `unknown` names what is asked. Lenient at this level — each part is checked on its own, so a
 * broken read still leaves the lines, and broken lines still leave the read.
 */
export const FigureReplySchema = z.object({
  unknown: z.preprocess((v) => (typeof v === "string" ? v : ""), z.string().max(40)).default(""),
  quantities: z.array(z.unknown()).max(40).catch([]).default([]),
  facts: z.array(z.unknown()).max(30).catch([]).default([]),
  lines: z.array(z.unknown()).catch([]).default([]),
});
export type FigureReply = z.infer<typeof FigureReplySchema>;

export interface FigureRead {
  quantities: FigureQuantity[];
  facts: FigureFact[];
  /** facts the model wrote that did not validate (dropped) */
  dropped: number;
  /** quantities that did not validate (dropped) */
  droppedQuantities: number;
}

/** The structured read out of a reply: every quantity and fact that validates. */
export function readFromReply(reply: Pick<FigureReply, "quantities" | "facts">): FigureRead {
  const quantities: FigureQuantity[] = [];
  let droppedQuantities = 0;
  const seen = new Set<string>();
  for (const q of reply.quantities) {
    const parsed = FigureQuantitySchema.safeParse(q);
    if (!parsed.success || seen.has(parsed.data.id)) {
      droppedQuantities++;
      continue;
    }
    seen.add(parsed.data.id);
    quantities.push(parsed.data);
  }
  const facts: FigureFact[] = [];
  let dropped = 0;
  for (const f of reply.facts) {
    const parsed = parseFact(f);
    if (parsed) facts.push(parsed);
    else dropped++;
  }
  return { quantities, facts, dropped, droppedQuantities };
}
