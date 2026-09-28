import { z } from "zod";
import type { ProofRequest } from "@/lib/live/proof/contracts";
import { REASON_TEXT } from "@/lib/live/proof/vocab";
import type { ChatMessage } from "@/lib/server/openrouter";

/**
 * Prompts for POST /api/live/proof (two-column geometry proofs). "The model reads, the engine
 * reasons": both replies are checked on the client before anything reaches the board.
 *
 *  - FIGURE: what the proof's figure DRAWS — its labelled points (roughly where) and its straight
 *    lines (the points on each, in order). No judgement about what is congruent or parallel: the
 *    engine derives vertical angles, alternate interior angles and the rays from that
 *    (`src/lib/live/proof/figure.ts`).
 *  - STEP: the next row of a proof the engine's planner could not finish, as `{statement, reason}` —
 *    the statement in maths only, the reason from the board's fixed vocabulary. The client's checker
 *    must tick it or it is never written.
 */
export const PROOF_FIGURE_SYSTEM_PROMPT = [
  "You read the figure of a student's geometry proof and report only what is DRAWN. You never reason about congruence.",
  "",
  "INPUT: an image of the figure; the labels a handwriting reader read on it (they may be misread: the image is the truth); the proof's Given and Prove, for the letters.",
  'OUTPUT: one JSON object and nothing else: {"points": {"A": [x, y], ...}, "lines": ["ADC", ...], "angles": {"1": "ABD", ...}}',
  "",
  "RULES:",
  "1. points: every labelled point (one capital letter) with roughly where it is in the image: x from the left, y from the top, each 0 to 100.",
  "2. lines: every straight line or segment drawn, as the labelled points ON it in order along it: \"ADC\" when D lies on segment AC between A and C. A triangle ABC is three lines: \"AB\", \"BC\", \"AC\". Put a point on a line only when it is drawn on it.",
  "   Where two drawn lines cross at a labelled point, that point is on BOTH: segments AD and BC crossing at E are the lines \"AED\" and \"BEC\". A point where two segments meet is on both of them. Each drawn line once, with ALL its labelled points.",
  "3. angles: only when an angle is marked with a number or a Greek letter: that mark → the angle, three letters with the vertex in the middle (\"1\": \"ABD\"). Otherwise {}.",
  "4. Only letters written on the figure. No words, no explanations.",
].join("\n");

const REASONS = Object.values(REASON_TEXT).filter((r) => r !== "SSA" && r !== "AAA");

export const PROOF_STEP_SYSTEM_PROMPT = [
  "You write the NEXT row of a student's two-column geometry proof: one statement and the reason for it.",
  "",
  "INPUT: the Given, what is to be proved (Prove), the rows written so far (statement | reason), and what the figure shows (its points and straight lines), possibly an image of it.",
  'OUTPUT: one JSON object and nothing else: {"statement": "<LaTeX>", "reason": "<one reason from the list>"}',
  "",
  "RULES:",
  "1. ONE row: the next step a geometry teacher expects, which follows from the Given and the rows above by its reason. Do not repeat a row. When the rows already prove the Prove statement, answer {\"statement\": \"\", \"reason\": \"\"}.",
  "2. statement: maths only, in LaTeX, with the figure's own letters and no words: \\overline{AB} \\cong \\overline{CD}, \\angle ABD \\cong \\angle CDB, \\triangle ABD \\cong \\triangle CDB (the vertex order is the correspondence), \\overline{AB} \\parallel \\overline{CD}, \\overline{BD} \\perp \\overline{AC}, m\\angle ADB = 90^{\\circ}.",
  `3. reason: exactly one of: ${REASONS.join("; ")}.`,
  "4. Every part a postulate (SSS, SAS, ASA, AAS, HL) or CPCTC uses must already be a row or a given: state a shared side (Reflexive), vertical angles, right angles (Def. of ⊥) as rows first.",
  "5. SAS needs the angle between the two sides; SSA and AAA prove nothing.",
].join("\n");

/** The figure reply, leniently: bad entries are dropped by `cleanFigureReply`, not failed. */
export const FigureReplySchema = z.object({
  points: z.record(z.unknown()).catch({}).default({}),
  lines: z.array(z.unknown()).catch([]).default([]),
  angles: z.record(z.unknown()).catch({}).default({}),
});
export type FigureReply = z.infer<typeof FigureReplySchema>;

export const StepReplySchema = z.object({
  statement: z.string().max(500).catch("").default(""),
  reason: z.string().max(200).catch("").default(""),
});
export type StepReply = z.infer<typeof StepReplySchema>;

/** The figure as the board receives it: capital points with two finite numbers, lines of known points, angle marks of three distinct points. */
export function cleanFigureReply(reply: FigureReply): { points: Record<string, [number, number]>; lines: string[]; angles: Record<string, string> } {
  const points: Record<string, [number, number]> = {};
  for (const [k, v] of Object.entries(reply.points ?? {})) {
    const name = k.trim();
    if (!/^[A-Z]$/.test(name) || !Array.isArray(v) || v.length < 2) continue;
    const [x, y] = [Number(v[0]), Number(v[1])];
    if (Number.isFinite(x) && Number.isFinite(y)) points[name] = [x, y];
  }
  const lines = (Array.isArray(reply.lines) ? reply.lines : [])
    .filter((l): l is string => typeof l === "string")
    .map((l) => [...new Set(l.replace(/[^A-Z]/g, ""))].join(""))
    .filter((l) => l.length >= 2 && l.length <= 12 && [...l].every((p) => p in points))
    .slice(0, 30);
  const angles: Record<string, string> = {};
  for (const [k, v] of Object.entries(reply.angles ?? {})) {
    const mark = k.replace(/[\\{}\s$]/g, "").slice(0, 8);
    const name = typeof v === "string" ? v.replace(/[^A-Z]/g, "") : "";
    if (mark && name.length === 3 && new Set(name).size === 3) angles[mark] = name;
  }
  return { points, lines, angles };
}

/** The step as the board receives it: `$` off, trimmed; null when empty. */
export function cleanStepReply(reply: StepReply): { statement: string; reason: string } | null {
  const statement = String(reply.statement ?? "").replace(/^\s*\$+|\$+\s*$/g, "").trim();
  const reason = String(reply.reason ?? "").replace(/^\s*\$+|\$+\s*$/g, "").trim();
  return statement && reason ? { statement, reason } : null;
}

function proofText(req: Pick<ProofRequest, "givens" | "prove" | "rows">): string[] {
  const givens = (req.givens ?? []).map((g) => g.trim()).filter(Boolean);
  const rows = (req.rows ?? []).map((r, i) => `${i + 1}. ${r.statement.trim()} | ${r.reason.trim()}`);
  return [
    `Given: ${givens.length > 0 ? givens.join(", ") : "(none written)"}`,
    `Prove: ${(req.prove ?? "").trim() || "(none written)"}`,
    rows.length > 0 ? `Rows so far:\n${rows.join("\n")}` : "No rows yet.",
  ];
}

/** Messages for reading a proof's figure (image first, as the reread route sends it). */
export function buildProofFigureMessages(req: Pick<ProofRequest, "givens" | "prove" | "labels" | "crop">): ChatMessage[] {
  const labels = (req.labels ?? []).map((l) => l.trim()).filter(Boolean);
  const text = [labels.length > 0 ? `Labels read on the figure: ${labels.join(", ")}` : "Labels read on the figure: none", ...proofText({ givens: req.givens, prove: req.prove, rows: [] }).slice(0, 2), "JSON only."].join("\n");
  return [
    { role: "system", content: PROOF_FIGURE_SYSTEM_PROMPT },
    { role: "user", content: [{ type: "image_url", image_url: { url: req.crop ?? "" } }, { type: "text", text }] },
  ];
}

/** Messages for the next row: the proof as text, the figure read, and its image when there is one. */
export function buildProofStepMessages(req: Pick<ProofRequest, "givens" | "prove" | "rows" | "figure" | "crop">): ChatMessage[] {
  const fig = req.figure;
  const figure = fig
    ? `The figure: points ${Object.keys(fig.points).sort().join(", ")}; straight lines ${fig.lines.join(", ")}${fig.angles && Object.keys(fig.angles).length > 0 ? `; marked angles ${Object.entries(fig.angles).map(([k, v]) => `\\angle ${k} = \\angle ${v}`).join(", ")}` : ""}.`
    : "No figure read.";
  const text = [...proofText(req), figure, "JSON only."].join("\n");
  return [
    { role: "system", content: PROOF_STEP_SYSTEM_PROMPT },
    { role: "user", content: req.crop ? [{ type: "image_url", image_url: { url: req.crop } }, { type: "text", text }] : text },
  ];
}
