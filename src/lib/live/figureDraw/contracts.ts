import { z } from "zod";
import type { HandPlan } from "../handwriting";

/**
 * A geometry figure the tutor draws by hand when asked (the board chat's `draw_figure`; later the
 * voice tutor): named points in figure units — any scale, y up, as a maths drawing is — and what
 * joins and marks them. `planFigure` fits it to a box true to scale and writes it in the tutor's
 * hand: sides, lines and rays, circles, angle arcs and right-angle marks, equal-side ticks,
 * parallel arrows, labels. No words: every label is maths (`A`, `3`, `x`, `70^{\circ}`, `2x + 10`).
 *
 * The shared contract of the chat build (which asks a model for a spec and draws it) and the
 * figure-drawer build (which draws it): both code against this file.
 */

/** A point's name: `A`, `B'`, `P1`, `O`. */
export const FigureNameSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9']{0,3}$/);

/** A label: short maths, written in the hand (LaTeX). */
export const FigureLabelSchema = z.string().trim().min(1).max(24);

export const FigurePointSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  /** write the point's name beside it (default true) */
  label: z.boolean().optional(),
  /** a dot at the point (default: only for a point on no segment, line or circle) */
  dot: z.boolean().optional(),
});

export const FigureSegmentSchema = z.object({
  from: FigureNameSchema,
  to: FigureNameSchema,
  /** a length or a name, written beside the middle, outside the figure: `3`, `x`, `2x + 1` */
  label: FigureLabelSchema.optional(),
  /** equal-length ticks across the middle */
  ticks: z.number().int().min(1).max(3).optional(),
  /** parallel arrows on the middle, pointing from → to */
  arrows: z.number().int().min(1).max(3).optional(),
  dashed: z.boolean().optional(),
});

/** A line through two points, run on past them: both ways (a line) or past `to` only (a ray). */
export const FigureLineSchema = z.object({
  through: z.tuple([FigureNameSchema, FigureNameSchema]),
  extend: z.enum(["both", "ray"]).optional(),
  label: FigureLabelSchema.optional(),
  arrows: z.number().int().min(1).max(3).optional(),
});

export const FigureCircleSchema = z
  .object({
    center: FigureNameSchema,
    /** in figure units; or give `through`, a point on the circle */
    radius: z.number().positive().finite().optional(),
    through: FigureNameSchema.optional(),
    dashed: z.boolean().optional(),
  })
  .refine((c) => c.radius !== undefined || c.through !== undefined, { message: "a circle needs a radius or a point it goes through" });

/** The angle at `at` from ray at→from to ray at→to (the smaller one): an arc (or a right-angle square). */
export const FigureAngleSchema = z.object({
  at: FigureNameSchema,
  from: FigureNameSchema,
  to: FigureNameSchema,
  label: FigureLabelSchema.optional(),
  right: z.boolean().optional(),
  /** equal angles: 1–3 arcs */
  arcs: z.number().int().min(1).max(3).optional(),
});

/** A closed shape: its sides, in order (a convenience: the drawer expands it to segments). */
export const FigurePolygonSchema = z.object({
  vertices: z.array(FigureNameSchema).min(3).max(12),
});

export const FigureSpecSchema = z.object({
  points: z.record(FigureNameSchema, FigurePointSchema),
  segments: z.array(FigureSegmentSchema).max(40).optional(),
  lines: z.array(FigureLineSchema).max(12).optional(),
  circles: z.array(FigureCircleSchema).max(6).optional(),
  angles: z.array(FigureAngleSchema).max(16).optional(),
  polygons: z.array(FigurePolygonSchema).max(6).optional(),
});

export type FigureSpec = z.infer<typeof FigureSpecSchema>;

export interface FigurePlanOptions {
  seed: number;
  /** the box (px) the figure is fitted into, labels included; the plan's px start at 0, 0 */
  box: { w: number; h: number };
}

export interface FigurePlanResult {
  /** the drawing, in the box's px: place it with `placeHandPlan` */
  plan: HandPlan;
  /** where each named point landed (px, in the plan's box), for work placed beside the figure */
  points: Record<string, { x: number; y: number }>;
}
