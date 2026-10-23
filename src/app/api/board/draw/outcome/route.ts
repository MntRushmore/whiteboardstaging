import { logger } from "@/lib/logger";
import { requireAdmin } from "@/lib/server/admin";
import { BoardDrawOutcomeSchema } from "@/lib/server/boardDraw/contracts";
import { recordBoardDrawOutcome } from "@/lib/server/boardDraw/events";
import { withRequestId } from "@/lib/server/live-route";
import { checkRateLimit, LIMITS, rateLimitKey, rateLimitedResponse } from "@/lib/server/rate-limit";
import { parseJsonBody } from "@/lib/server/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

const log = logger.child({ module: "board", route: "draw/outcome" });

/**
 * POST /api/board/draw/outcome `{ runId, outcome: "accepted" | "rejected" | "cancelled" | "shown" }`
 * → 204: what the kid did with a picture-tutor drawing, as the app event `board_draw_outcome`
 * (src/lib/server/boardDraw/events.ts). Admin only, like the run itself: requireAdmin
 * (requireUser(req) — 401 signed out — then 404 for anyone not in admins), then the per-user
 * bucket `boardDrawOutcome` (429), then the body (400).
 */
export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  const gate = await requireAdmin(req);
  if ("response" in gate) return withRequestId(gate.response, requestId);
  const { user } = gate;

  const limited = checkRateLimit(rateLimitKey(user.id, "boardDrawOutcome"), LIMITS.boardDrawOutcome);
  if (!limited.ok) return withRequestId(rateLimitedResponse(limited.retryAfterMs, "memory"), requestId);

  const parsed = await parseJsonBody(req, BoardDrawOutcomeSchema);
  if ("response" in parsed) return withRequestId(parsed.response, requestId);

  recordBoardDrawOutcome({ userId: user.id, requestId, ...parsed.data });
  log.info({ requestId, userId: user.id, runId: parsed.data.runId, outcome: parsed.data.outcome }, "board draw outcome");
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store", "X-Request-Id": requestId } });
}
