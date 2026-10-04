/**
 * What the tutor knows about the student when it answers, sent with a check or a chat request:
 * their weakest skills and the mistakes they keep making. Kept tiny and import-light (zod only),
 * because `src/lib/live/contracts.ts` imports it into the board's first load.
 *
 * The board computes it from the student's own learning record (`summary.ts` → `learnerHint`) and
 * sends it; the server never reads the record for a check or a chat. A student can only send their
 * own, so there is nothing to trust or distrust in it beyond its shape.
 */
import { z } from "zod";

/**
 * The kinds of mistake the learning record counts. The check model's annotation kinds
 * (`arithmetic`, `sign`, `algebra`, `units`, `concept`) are a subset; the rest come from the local
 * classifier (`mistakes.ts`), which compares a ringed line with the line above it.
 */
export const MISTAKE_KINDS = [
  "sign",
  "arithmetic",
  "distribution",
  "both_sides",
  "combining_terms",
  "inverse_operation",
  "fractions",
  "exponents",
  "algebra",
  "units",
  "concept",
] as const;
export type MistakeKind = (typeof MISTAKE_KINDS)[number];
export const MistakeKindSchema = z.enum(MISTAKE_KINDS);

const skillRef = z.object({
  /** a skill id from `SKILLS` (`contracts.ts`) */
  id: z.string().regex(/^[a-z0-9_]{1,40}$/),
  /** its kid-friendly name, so the prompt never needs the list */
  name: z.string().trim().min(1).max(60),
});

export const LearnerHintSchema = z.object({
  /** up to 3 skills the student is weakest at (worked on, not yet mastered), weakest first */
  weakSkills: z.array(skillRef).max(3).default([]),
  /** up to 3 skills the student has mastered, most recent first */
  strongSkills: z.array(skillRef).max(3).default([]),
  /** up to 3 mistakes the student keeps making (counted over the last 30 days), most frequent first */
  recurringMistakes: z.array(z.object({ kind: MistakeKindSchema, count: z.number().int().min(1).max(9999) })).max(3).default([]),
});
export type LearnerHint = z.infer<typeof LearnerHintSchema>;
