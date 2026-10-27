/**
 * The tutor's words on the Keys page (docs/KEYS.md, Phase 2): the contract of `POST /api/keys/say`
 * and the page's call to it.
 *
 * The page always knows what to say: the fixed line from `copy.ts` (`copy`), worked out from the
 * item, the named bug and the rung of the help ladder. The route only says it another way, in a
 * coach's voice for the kid's grade; it never decides anything. A reply that changes a number, says
 * a word the tutor never says, or comes later than SAY_WAIT_MS is dropped for the fixed line.
 */
import { z } from "zod";
import { leadOf, SAY_MAX_CHARS, SAY_MOMENTS, SAY_WAIT_MS, sayable, tidyLine, type SayMoment } from "./copy";
import type { ProblemState } from "./session";

const plain = (max: number) => z.string().trim().max(max);

export const SayRequestSchema = z.object({
  moment: z.enum(SAY_MOMENTS),
  /** the bug rule that names the slip (`bugs/`), null when none does */
  bug: z
    .string()
    .regex(/^[a-z0-9_]{1,40}$/)
    .nullable(),
  /** the problem as the tutor wrote it: `26 + ?6 = 92` */
  problem: plain(80).min(1),
  /** the smaller problem (the sub-step), when there is one: `1 + 2 + ? = 9` */
  step: plain(80).nullable().default(null),
  /** the rung of the help ladder: 1 nudge, 2 smaller, 3 worked (0 for a Look again or a cheer) */
  level: z.number().int().min(0).max(3),
  /** the kid's grade, 0 (Kindergarten) to 8; null when unknown */
  grade: z.number().int().min(0).max(8).nullable().default(null),
  /** the fixed line: what the tutor says, in the page's own words */
  copy: plain(SAY_MAX_CHARS).min(1),
});
export type SayRequest = z.infer<typeof SayRequestSchema>;

export const SayResponseSchema = z.object({
  line: z.string().min(1).max(SAY_MAX_CHARS + 1),
  /** `model`: the tutor's own words; `copy`: the fixed line (no model, a slow one, or a reply refused) */
  source: z.enum(["model", "copy"]),
  ms: z.number().int().nonnegative(),
});
export type SayResponse = z.infer<typeof SayResponseSchema>;

/** What the page needs to ask for a line. */
export type SayInput = Omit<SayRequest, "moment"> & { moment: SayMoment };

export type SayFetch = (body: SayRequest, signal: AbortSignal) => Promise<unknown>;

/**
 * The line to show: the route's when it answers in time with a line `sayable` as the copy, else
 * the copy. Never throws, never waits longer than `waitMs`.
 */
export async function sayLine(input: SayInput, fetchLine: SayFetch, waitMs: number = SAY_WAIT_MS): Promise<{ line: string; source: "model" | "copy" }> {
  const fallback = { line: tidyLine(input.copy), source: "copy" as const };
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      ctrl.abort();
      resolve(null);
    }, waitMs);
  });
  try {
    const raw = await Promise.race([fetchLine(input, ctrl.signal).catch(() => null), late]);
    const parsed = SayResponseSchema.safeParse(raw);
    if (!parsed.success || parsed.data.source !== "model") return fallback;
    const line = tidyLine(parsed.data.line);
    return sayable(line, input.copy) ? { line, source: "model" } : fallback;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * What the tutor is saying on the page now, as a request for its own words: the worked step, the
 * smaller problem's lead, or a nudge about a named bug. Null when the page says nothing new, and for
 * a nudge about a slip no rule names: the check endpoint words that one (`hint.ts`).
 */
export function sayInputFor(p: ProblemState, grade: number | null): SayInput | null {
  const base = { bug: p.bug, problem: p.item.text, grade };
  const help = p.help;
  if (help?.kind === "worked") return { ...base, moment: "worked", step: null, level: 3, copy: help.text };
  if (help?.kind === "smaller") {
    const t = p.stack[p.stack.length - 1];
    if (!t?.step) return null;
    return { ...base, moment: "smaller", step: t.step.item.text, level: 2, copy: leadOf(t.step) };
  }
  if (help?.kind === "nudge" && p.bug) return { ...base, moment: "nudge", step: null, level: 1, copy: help.text };
  return null;
}
