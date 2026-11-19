/**
 * The picture tutor's ONE decision call (src/lib/server/boardDraw/run.ts): does the kid need help,
 * and if so, what exactly should the painter add, and where. This is the wording of the measured
 * run (2026-10-23, the drawing bake-off's fast chain: gemini-3.8-flash then Nano Banana 2 Lite,
 * ~6 s, ~$0.036), kept in this one file on purpose: a parallel eval is testing a spacing fix
 * ("place additions in the empty space, sized like the kid's writing"), and its winning wording is
 * dropped in HERE, nowhere else. Change the text only with an eval behind it.
 *
 * The system prompt is Reed's voice tutor's (`REED_VOICE_INSTRUCTIONS`), and the tool the
 * instructions are written for is his `draw_on_canvas` (`REED_DRAW_TOOL_DESCRIPTION`), verbatim.
 */
import type { ChatMessage } from "@/lib/server/openrouter";
import { REED_DRAW_TOOL_DESCRIPTION, REED_VOICE_INSTRUCTIONS, type ReedMode } from "./reed";

/** What each mode lets the drawing say. */
export const MODE_RULE: Record<ReedMode, string> = {
  // a 21-word note came out tiny and typed (the picture bench, 2026-10-26)
  feedback: "Mode feedback: point out the mistake and where it is in a note of at most 10 words; do not write the corrected answer.",
  suggest: "Mode suggest: give a hint for the next step only; never write the answer.",
  answer: "Mode answer (Solve): write the complete worked solution, every step, ending with the final answer.",
};

/** Solve's plain-arithmetic way out (answer mode only). */
export const SIMPLE_RULE =
  'If the student\'s work is one plain arithmetic expression of numbers only (like 1+1, 47 + 38 or 12 × 4), not yet answered, and nothing on the board asks for a picture or a model, set "simple" to that expression exactly as written without any "=", "wroteEquals" to whether they wrote "=" after it, needsHelp to true and instructions to ""; otherwise leave "simple" out.';

/**
 * Right work is right (v1.0 reliability, 2026-11-19). The 11-13 demo: after the kid accepted the
 * tutor's picture and wrote the answer, Suggest drew another nudge instead of a checkmark (area model,
 * bars, base-ten), and Feedback flagged a slip the kid had already fixed on the line below.
 */
export const RIGHT_WORK_RULES = [
  "Blue ink on the board is the tutor's own earlier help, which the student kept. Judge the student's work together with it: if the student has now written the right final answer, the work is finished — needsHelp false, correct true, instructions \"\" — and never add another hint.",
  "If the student wrote a line and then wrote it again correctly below it (without crossing the first out), the lower line is their answer: judge that one, not the slip above it.",
];

/**
 * K–8 pictures, said exactly (v1.0 reliability). The painter draws counts and shading only as well as
 * the instructions spell them out: the demo's 38 drawn as 2 rods, fraction bars with the wrong parts
 * shaded or none, a pale pizza slice the iPad showed as nothing.
 */
export const PICTURE_RULES = [
  "If the student asks for a picture or a model (an array, equal groups, base-ten blocks, an area model, fraction bars, a circle or pizza, a number line, a tape diagram, a balance, a triangle, a rectangle, or \"draw it\"/\"show me\"), the instructions MUST draw that picture, never words alone (in mode suggest, draw the picture set up without the final answer).",
  "Say every count with a digit and say exactly what to draw: array — R rows of C dots, evenly spaced; equal groups — N circles with exactly M dots in each; base-ten — for EACH number, exactly how many tens rods (tall thin rectangles) and ones (small squares), beside that number, and for regrouping ten ones circled with an arrow to one new rod; area model — one rectangle split into parts labelled by place value (30 and 4) with each product inside; fraction bars — bars of the SAME length, one under another, each cut into exactly N equal parts, with exactly K parts from the left shaded, the fraction written beside each bar; circle or pizza — one circle cut into exactly N equal slices by lines through the centre, exactly K slices side by side shaded; number line — a straight line with evenly spaced ticks, each whole number labelled in order from A to B, a dot at the start, curved hop arrows of the right size and direction, the landing number marked; tape diagram — one tape cut into exactly N equal boxes, which boxes stand for what, the value in each box; balance — a beam on a stand, what is on each pan; right triangle — the right-angle mark and each side's length on its side; rectangle — length and width on its sides.",
  "Shading is close dark diagonal lines inside the part, never a pale fill.",
];

/** The tutor's text, after the board image (lines joined with "\n"). */
/** `room`: where the board has space (./room.ts roomLine), when it is not mostly empty. */
export function tutorText(mode: ReedMode, room?: string | null): string {
  return [
    `The picture is the student's whiteboard. The board's assistance mode is "${mode}".`,
    "First decide whether the student needs help: a mistake, unfinished work, a question, or being stuck. Finished correct work, doodles and a word still being written do not need help.",
    ...RIGHT_WORK_RULES,
    // 50 words left no room to spell out the counts of a K–8 picture (v1.0 reliability)
    `If they need help, write the instructions for your tool draw_on_canvas (${REED_DRAW_TOOL_DESCRIPTION}) with mode "${mode}": exactly what to add to the board and where — the words, numbers, marks and arrows, each next to the part of the student's work it is about. Be exactly right about the maths. Under 50 words, or under 90 for a picture.`,
    ...PICTURE_RULES,
    // The fast-chain check (eval/drawing-bakeoff e8a13957, "S1a"): Solve boards right, roomy and
    // clean 5 of 6 with this line against 1 of 6 without it.
    "Put additions in the empty space beside the work, at the same size as the student's writing; if there is not room for everything, write less.",
    // Told to circle the kid's 25, Lite wrote a second 25 and circled that (4 of 4 feedback boards);
    // with this line, 3 of 4 pointed at the kid's own writing and copied nothing (2026-10-23).
    "Never ask to circle, ring, box or rewrite any of the student's writing; point at it with an arrow from your note instead.",
    // the picture bench, 2026-10-26: "below 204" on a zoomed-in page with nothing below it
    ...(room ? [room] : []),
    MODE_RULE[mode],
    // Solve on plain arithmetic is the regular tutor's (the owner, 2026-10-26: "for simple math like
    // 1+1 ... can we have the rgeular tutor"): the server works the answer out and the iPad writes it
    ...(mode === "answer" ? [SIMPLE_RULE] : []),
    // the owner, 2026-10-26: "i just want checkmarks for correct, even if its 1 checkmark"
    '"correct" is true only when the board has finished maths work and every step of it is right (then needsHelp is false); false for doodles, words, unfinished or wrong work.',
    // the check before show (./verify.ts) holds the painted picture to these
    '"checks": when the instructions draw a picture or write numbers, one short fact a person could check by looking for each count, shading, label and number it must show (like "exactly 3 tens rods beside 38", "the second bar has 6 equal parts with exactly 2 shaded", "85 is written after ="), at most 6; otherwise [].',
    '"answer": the problem\'s final answer, short (like "85", "5/6", "x = 5"), or "" when there is none.',
    'Reply with only this JSON, nothing before or after it: {"needsHelp": true or false, "correct": true or false, "instructions": "...", "checks": ["..."], "answer": "..."}',
  ].join("\n");
}

/** The tutor call's messages: Reed's voice-tutor instructions as the system, then the board, then the text. */
export function tutorMessages(mode: ReedMode, imageDataUrl: string, room?: string | null): ChatMessage[] {
  return [
    { role: "system", content: REED_VOICE_INSTRUCTIONS },
    {
      role: "user",
      content: [
        { type: "image_url", image_url: { url: imageDataUrl } },
        { type: "text", text: tutorText(mode, room) },
      ],
    },
  ];
}

/** `correct`: finished maths, all of it right (a checkmark on the board). `simple`: Solve on one plain
 * arithmetic expression (the server works it out), and whether the student wrote "=" after it. */
export type TutorDecision = {
  needsHelp: boolean;
  instructions: string;
  correct?: boolean;
  simple?: string;
  wroteEquals?: boolean;
  /** what the painted picture must show, one checkable fact each (./verify.ts) */
  checks?: string[];
  /** the problem's final answer, short: Solve's written fallback when its picture can't be got right */
  answer?: string;
};

/** At most this many checks are kept, each at most CHECK_CHARS. */
export const MAX_CHECKS = 6;
export const CHECK_CHARS = 160;

/**
 * The tutor's reply, read from the first "{" to the last "}". Null when that is not JSON with a
 * boolean `needsHelp` (the caller answers a retryable error). `instructions` is trimmed and capped.
 */
export function parseTutorReply(text: string, maxInstructions: number): TutorDecision | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const d = parsed as { needsHelp?: unknown; instructions?: unknown; correct?: unknown; simple?: unknown; wroteEquals?: unknown; checks?: unknown; answer?: unknown };
  if (typeof d.needsHelp !== "boolean") return null;
  const instructions = typeof d.instructions === "string" ? d.instructions.trim().slice(0, maxInstructions) : "";
  // right work needs no help: a reply that says both is not believed
  const simple = typeof d.simple === "string" && d.simple.trim() ? d.simple.trim().slice(0, 80) : undefined;
  const checks = Array.isArray(d.checks)
    ? d.checks.filter((c): c is string => typeof c === "string" && c.trim() !== "").map((c) => c.trim().slice(0, CHECK_CHARS)).slice(0, MAX_CHECKS)
    : [];
  const answer = typeof d.answer === "string" && d.answer.trim() ? d.answer.trim().slice(0, 40) : undefined;
  return {
    needsHelp: d.needsHelp,
    instructions,
    ...(d.correct === true && !d.needsHelp ? { correct: true } : {}),
    ...(simple ? { simple, wroteEquals: d.wroteEquals === true } : {}),
    // checks and the answer matter only when something is drawn
    ...(d.needsHelp && checks.length ? { checks } : {}),
    ...(d.needsHelp && answer ? { answer } : {}),
  };
}
