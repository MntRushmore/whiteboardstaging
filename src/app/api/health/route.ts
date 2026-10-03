import { logger } from "@/lib/logger";
import { RELEASE } from "@/lib/release";
import { probeDatabase } from "@/lib/server/health";
import { checkRateLimit, clientIp, rateLimitedResponse } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

/** Per-IP budget: an uptime monitor checks every minute or so; 30/min leaves room for a few. */
const HEALTH_LIMIT = { limit: 30, windowMs: 60_000 } as const;

const log = logger.child({ module: "health" });

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * GET /api/health — for an uptime monitor (docs/RUNBOOK-ops.md). 200 `{ ok: true, db: "up",
 * release }` when the database answers a trivial query within 3 s (`probeDatabase`), else 503
 * `{ ok: false, db: "down", release }` and a warn line with the reason; `Cache-Control: no-store`
 * either way. Catches the free Supabase project pausing.
 *
 * PUBLIC BY DESIGN (allow-listed in scripts/lib/routes.mjs): a monitor has no user. It answers
 * those three fields only, and is rate limited per IP.
 */
export async function GET(req: Request) {
  const rl = checkRateLimit(`ip:${clientIp(req)}:health`, HEALTH_LIMIT);
  if (!rl.ok) return rateLimitedResponse(rl.retryAfterMs);

  const db = await probeDatabase();
  if (db.up) return Response.json({ ok: true, db: "up", release: RELEASE }, { headers: NO_STORE });
  log.warn({ reason: db.reason, ms: db.ms, release: RELEASE }, "health: database down");
  return Response.json({ ok: false, db: "down", release: RELEASE }, { status: 503, headers: NO_STORE });
}
