import { satAnonTutorPerDay, satFreeTutorPerDay } from "@/lib/env";
import { logger } from "@/lib/logger";
import { SAT_LIMITS } from "@/lib/sat/contracts";

/** Shared bits of the /api/sat/* routes. */

export const satLogger = logger.child({ module: "sat" });

/** No caching (a student's own practice), and the request id for log correlation. */
export function satHeaders(requestId: string): Record<string, string> {
  return { "Cache-Control": "no-store", "X-Request-Id": requestId };
}

/**
 * The free tutor's daily cap for this caller (owner, 2026-10-22): no account (an anonymous session)
 * SAT_ANON_TUTOR_PER_DAY (5), a signed-in account SAT_FREE_TUTOR_PER_DAY (20). Unlimited has no cap
 * (sat_take_tutor_pass decides that in the database).
 */
export function satTutorCap(user: { anonymous?: boolean }): number {
  return user.anonymous ? satAnonTutorPerDay(SAT_LIMITS.anonTutorPerDay) : satFreeTutorPerDay(SAT_LIMITS.freeTutorPerDay);
}
