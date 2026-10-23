/**
 * The live tutor's problem context on an SAT page (docs/SAT-V2.md "The tutor on an SAT page"): the
 * bank question behind a Live call's `sat_question_id`, as the block the model reads
 * (src/lib/sat/tutorContext.ts). Read as the student (RLS: live questions only) and kept for five
 * minutes per instance, because one question's page makes many Live calls.
 *
 * A question that is not in the live bank, or a read that fails, gives no block: the call goes on
 * exactly as on an ordinary board (enforceInk has already decided whether it may run at all).
 */
import type pino from "pino";
import type { SatQuestion } from "@/lib/sat/contracts";
import { satContextBlock, withSatContext } from "@/lib/sat/tutorContext";
import { readQuestions, satStoreDeps } from "@/lib/server/sat/store";

const TTL_MS = 5 * 60_000;
const MAX_ENTRIES = 500;
const cache = new Map<string, { at: number; q: SatQuestion | null }>();

/** Tests only. */
export function resetSatContextCache(): void {
  cache.clear();
}

/** The live bank question, or null (not live, or the read failed: logged). */
export async function satQuestionFor(token: string, id: string, log?: pino.Logger): Promise<SatQuestion | null> {
  const now = satStoreDeps.now();
  const hit = cache.get(id);
  if (hit && now - hit.at < TTL_MS) return hit.q;
  try {
    const [q] = await readQuestions(token, [id]);
    if (cache.size >= MAX_ENTRIES) cache.clear();
    cache.set(id, { at: now, q: q ?? null });
    if (!q) log?.warn({ satQuestionId: id }, "sat_question_id is not a live bank question: no SAT context");
    return q ?? null;
  } catch (err) {
    log?.warn({ satQuestionId: id, error: err instanceof Error ? err.message : String(err) }, "SAT question could not be read: no SAT context");
    return null;
  }
}

/** The block for a Live call (null on an ordinary board, or when the question is not found). */
export async function satPromptBlock(ctx: { token: string; satQuestionId: string | null; satFigureMarks: string | null; log?: pino.Logger }): Promise<string | null> {
  if (!ctx.satQuestionId) return null;
  const q = await satQuestionFor(ctx.token, ctx.satQuestionId, ctx.log);
  return q ? satContextBlock(q, ctx.satFigureMarks) : null;
}

export { withSatContext };
