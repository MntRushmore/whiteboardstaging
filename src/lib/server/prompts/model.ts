/**
 * How Ask asks for a K–8 visual model (`draw_model`, docs/ASK-V2.md "Drawing"), in the prompt's
 * own words, and the one repair round-trip for a model the board's spec check refuses
 * (`modelProblems`): the action's line, the models' format with when to use each kind, and the
 * repair prompt the route's gate sends back (`chatGate.ts`), next to the figure's.
 */
import { z } from "zod";
import { VisualModelSchema, type VisualModel } from "@/lib/live/chat/contracts";
import type { ChatMessage } from "@/lib/server/openrouter";

/** The action, as the prompt lists it (its format is `MODEL_FORMAT`). */
export const DRAW_MODEL_ACTION =
  '{"type": "draw_model", "model": {...}, "near": 2} — a K–8 picture of the maths (a number line, fraction bars or circles, an array, equal groups, an area model, base-ten blocks, a place-value chart, a bar model, a ten frame, a clock), drawn neatly and to scale; the board works out every number in it (format below).';

/** The models' format and when to use each kind: the ask prompt's section, and the repair's. */
export const MODEL_FORMAT = [
  "VISUAL MODELS (draw_model.model): say WHAT to draw; the board lays it out and does all its maths (a jump's size, the shaded parts, partial products and their sum, the digits), so leave a label out to let the board write it, and every label you do give must be true.",
  '- number_line {"kind": "number_line", "from": 0, "to": 20, "step": 1, "marks": [{"at": 15}], "jumps": [{"from": 15, "to": 10}, {"from": 10, "to": 8}]}: adding and taking away as hops, counting on or back, skip counting, where a fraction or a decimal sits (step 0.25 for fourths), negatives. At most 40 ticks; marks and jumps on the line; a mark\'s label a name ("A") or its number.',
  '- fraction_bars {"kind": "fraction_bars", "bars": [{"parts": 4, "shaded": 3}, {"parts": 8, "shaded": 5}]}: comparing fractions, equivalent fractions, a fraction of a whole (1–4 bars, each the same whole). shaded ≤ parts.',
  '- fraction_circles {"kind": "fraction_circles", "circles": [{"parts": 3, "shaded": 1}]}: a fraction as slices of a pie (1–4 circles, up to 16 parts).',
  '- array {"kind": "array", "rows": 4, "cols": 6}: a times fact as rows of dots ("draw 4 × 6"), up to 12 × 12.',
  '- equal_groups {"kind": "equal_groups", "groups": 3, "each": 4}: "3 groups of 4", a times word problem, sharing (each 0: empty plates to share into), up to 10 groups of 12.',
  '- area_model {"kind": "area_model", "a": 23, "b": 14}: multiplying bigger numbers by place value ("show 23 × 14"), up to 9 parts (2-digit × 2-digit, 3-digit × 3-digit, 4-digit × 2-digit).',
  '- base_ten {"kind": "base_ten", "value": 345}: a number as hundreds, tens and ones blocks (1 to 999).',
  '- place_value {"kind": "place_value", "value": 3405.27}: a place-value chart for a number (up to 7 digits and 3 decimals).',
  '- tape {"kind": "tape", "rows": [{"label": "Sam", "segments": [{"units": 1, "label": "8"}, {"units": 1, "label": "8"}, {"units": 1, "label": "8"}]}], "total": "?"}: a bar model for a word problem. 1–2 rows (two to compare: "Sam", "Ann"); each segment\'s units are its length, in proportion to its number; "?" or a letter for the unknown; "total" is everything together, and must match the segments when they are all numbers.',
  '- ten_frame {"kind": "ten_frame", "filled": 13}: counting, making ten, numbers to 20.',
  '- clock {"kind": "clock", "hour": 3, "minute": 45}: telling time (the board puts the hour hand between the hours).',
  'Labels: a number, a fraction (3/4), "?", a letter, or a word or two ("Sam", "apples"); no $.',
  '"near": the number of a problem on THIS screen the picture is for ("show #2 on a number line", "draw it" about the problem being helped with): it is drawn beside that problem on this screen. Leave it out when the picture is about no listed problem. "near" works the same on graph and draw_figure.',
].join("\n");

/**
 * A `draw_model` as a model may write it, made readable before the schema judges it: the model's
 * fields beside `type` instead of inside `model` (`{"type": "draw_model", "kind": "clock", …}`), and
 * `near` as `null`, `"2"` or `"#2"`. Anything else is left for the schema to refuse.
 */
export function lenientModelAction(obj: Record<string, unknown>): Record<string, unknown> {
  const { type, near, model, ...rest } = obj;
  const out: Record<string, unknown> = { type };
  out.model = model === undefined && typeof rest.kind === "string" ? rest : model;
  const n = typeof near === "string" && /^\s*#?\d{1,3}\s*$/.test(near) ? Number.parseInt(near.replace("#", ""), 10) : near;
  if (n !== null && n !== undefined) out.near = n;
  return out;
}

// ------------------------------------------------------------------ one repair round-trip for a model

export const MODEL_REPAIR_PROMPT = [
  "You fix a visual model spec (a K–8 maths picture) so the board can draw it true to what it says. You are given the request, the spec and the problems the board found.",
  'OUTPUT: one JSON object and nothing else: {"model": { ...the corrected spec... }}',
  "Keep the kind and what the request asked for; change only what the problems need. A label that is wrong is better left out: the board writes the right one.",
  "",
  MODEL_FORMAT,
].join("\n");

export function buildModelRepairMessages(request: string, model: VisualModel, problems: readonly string[]): ChatMessage[] {
  return [
    { role: "system", content: MODEL_REPAIR_PROMPT },
    {
      role: "user",
      content: [`REQUEST: ${request.trim()}`, "", "SPEC:", JSON.stringify(model), "", "PROBLEMS:", ...problems.map((p) => `- ${p}`), "", "JSON only."].join("\n"),
    },
  ];
}

export const ModelRepairReplySchema = z.object({ model: VisualModelSchema });
