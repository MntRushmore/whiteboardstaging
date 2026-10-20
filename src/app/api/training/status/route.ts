import { logger } from "@/lib/logger";
import { requireAdmin } from "@/lib/server/admin";
import { checkRateLimit, LIMITS, rateLimitKey, rateLimitedResponse } from "@/lib/server/rate-limit";
import { trainingStatus } from "@/lib/server/training";

export const dynamic = "force-dynamic";

const log = logger.child({ module: "training", route: "training/status" });

/**
 * GET /api/training/status: does this server take Training Center calls? The iPad asks before a
 * bench. `{ training: true, routes, limits }` here means a Live call on one of `routes` with
 * `"training": true` spends no ink, within `limits` (per admin); a 404 from a server without this
 * route means it would charge the admin's ink like any call, and the app warns before it starts
 * (src/lib/server/training.ts).
 *
 * `requireAdmin` first: requireUser(req) (401 signed out), then the admins table (404 for everyone
 * else: the route does not exist for them, as on an old server), 503 when that could not be checked.
 * Then the admin console's bucket (`adminConsole`). Nothing is read from the database beyond that.
 */
export async function GET(req: Request) {
  const requestId = crypto.randomUUID();
  const gate = await requireAdmin(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  const limited = checkRateLimit(rateLimitKey(user.id, "adminConsole"), LIMITS.adminConsole);
  if (!limited.ok) return rateLimitedResponse(limited.retryAfterMs, "memory");

  log.info({ requestId, userId: user.id }, "training status");
  return Response.json(trainingStatus(), { headers: { "Cache-Control": "no-store", "X-Request-Id": requestId } });
}
