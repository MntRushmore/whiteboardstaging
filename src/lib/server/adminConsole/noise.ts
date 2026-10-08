/**
 * Which app events are noise: a browser's or an extension's own script, not ours (`isNoise`,
 * src/lib/clientErrors.ts, the same rules the browser applies before it reports). Shared by the
 * console (users, boards, issues), the overview's error counts (src/lib/server/adminOverview.ts)
 * and the error-spike alert (src/lib/server/health/alerts.ts), so the three agree.
 *
 * Only a browser crash (`source: "client"`) can be noise. Every other source's message is our own
 * words (an error card a student saw, a route that failed, a check that failed) and may be empty,
 * which isNoise would otherwise read as noise.
 */
import { isNoise } from "@/lib/clientErrors";

/** What an event needs to be judged: its source, its message and the top of its stack (`meta.stack`). */
export interface NoiseInput {
  source: string | null | undefined;
  message: string | null | undefined;
  /** `meta->>stack` when read as a column */
  stack?: string | null;
  /** or the whole meta */
  meta?: Record<string, unknown> | null;
}

export function eventIsNoise(e: NoiseInput): boolean {
  if (e.source !== "client") return false;
  const stack = typeof e.stack === "string" ? e.stack : typeof e.meta?.stack === "string" ? e.meta.stack : "";
  return isNoise(e.message ?? "", stack);
}

/** One line of a bug report's log (`{level, time, args: string[]}`): noise by its words, joined. */
export function logLineIsNoise(text: string): boolean {
  return isNoise(text);
}
