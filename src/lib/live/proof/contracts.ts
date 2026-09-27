/**
 * POST /api/live/proof — the model's two jobs for two-column proofs, both only on an explicit ask
 * (Help / Solve on a proof) and only when the engine cannot do without them:
 *
 *  - `figure`: read the proof's figure from its crop — every labelled point roughly where it is, and
 *    every straight line through the labelled points on it (`FigureRead`). The engine derives the
 *    rest (vertical angles, alternate interior angles, which points are on which ray). Asked once
 *    per figure (the client caches the read by the drawing's ink and labels).
 *  - `step`: the next row of a proof the engine's planner could not finish — `{ statement, reason }`,
 *    written by the tutor only when the client's checker ticks it.
 *
 * Zod is the source of truth for both sides. Server-safe (zod only).
 */
import { z } from "zod";

const Point = z.string().regex(/^[A-Z]$/);

/** A figure as the tutor reads one: points (x right, y down, any scale) and the drawn lines through them. */
export const FigureReadSchema = z.object({
  points: z.record(Point, z.tuple([z.number(), z.number()])),
  lines: z.array(z.string().regex(/^[A-Z]{2,12}$/)).max(30),
  angles: z.record(z.string().min(1).max(8), z.string().regex(/^[A-Z]{3}$/)).optional(),
});
export type FigureReadWire = z.infer<typeof FigureReadSchema>;

export const ProofRowSchema = z.object({
  statement: z.string().min(1).max(500),
  reason: z.string().min(1).max(200),
});

export const ProofRequestSchema = z
  .object({
    boardId: z.string().min(1).max(64),
    task: z.enum(["figure", "step"]),
    /** the Given line's facts as LaTeX (words allowed there: `M \text{ is the midpoint of } \overline{AB}`) */
    givens: z.array(z.string().max(500)).max(12).default([]),
    prove: z.string().max(500).default(""),
    /** the rows so far, top to bottom (only rows not ringed) */
    rows: z.array(ProofRowSchema).max(30).default([]),
    /** the figure's labels as the recognizer read them */
    labels: z.array(z.string().max(200)).max(40).optional(),
    /** data:image crop of the figure (and its labels): required to read it, optional for a step */
    crop: z.string().startsWith("data:image/").max(280_000).optional(),
    /** the figure as already read, for a step */
    figure: FigureReadSchema.optional(),
  })
  .refine((r) => r.task !== "figure" || Boolean(r.crop), { message: "reading a figure needs its crop", path: ["crop"] })
  .refine((r) => r.task !== "step" || r.prove.trim().length > 0, { message: "a next row needs what is to be proved", path: ["prove"] });
export type ProofRequest = z.input<typeof ProofRequestSchema>;

export const ProofResponseSchema = z.object({
  figure: FigureReadSchema.optional(),
  row: ProofRowSchema.optional(),
  model: z.string(),
  ms: z.number(),
});
export type ProofResponse = z.infer<typeof ProofResponseSchema>;
