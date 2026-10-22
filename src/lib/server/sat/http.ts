import { logger } from "@/lib/logger";

/** Shared bits of the /api/sat/* routes. */

export const satLogger = logger.child({ module: "sat" });

/** No caching (a student's own practice), and the request id for log correlation. */
export function satHeaders(requestId: string): Record<string, string> {
  return { "Cache-Control": "no-store", "X-Request-Id": requestId };
}
