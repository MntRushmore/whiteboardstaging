import { logger } from "@/lib/logger";
import { checkRateLimit, clientIp, rateLimitedResponse } from "@/lib/server/rate-limit";
import { reportDeps } from "@/lib/report/server";
import { unsubscribePage, type UnsubscribeOutcome } from "@/lib/report/unsubscribePage";
import { unsubscribeSecret, verifyUnsubscribe } from "@/lib/report/unsubscribe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = logger.child({ module: "report", route: "report/unsubscribe" });

/** Per-IP budget: a person taps it once; this stops a script from walking user ids (it could not sign them anyway). */
const UNSUBSCRIBE_LIMIT = { limit: 20, windowMs: 60_000 } as const;

/**
 * GET /api/report/unsubscribe?u=<user id>&t=<tag> — the Sunday email's one-tap "stop these emails"
 * (src/lib/report/unsubscribe.ts). PUBLIC BY DESIGN, like the cron routes (allow-listed in
 * scripts/lib/routes.mjs): it is opened from a mail app where nobody may be signed in, so the signed
 * link is the auth. `t` must be the HMAC of `u` under CRON_SECRET (constant-time compare); then the
 * service role sets that account's profiles.weekly_report_opt_out and nothing else. It can only turn
 * the email OFF; turning it back on needs the grown-up signed in, on /report.
 *
 * Answers a small HTML page (src/lib/report/unsubscribePage.ts), never JSON, never anything from the
 * request: 200 done, 400 for a link that does not verify, 503 without CRON_SECRET or the service role,
 * 502 when the write failed; 429 past the per-IP budget.
 */
export async function GET(req: Request) {
  const requestId = crypto.randomUUID();
  const rl = checkRateLimit(`ip:${clientIp(req)}:reportUnsubscribe`, UNSUBSCRIBE_LIMIT);
  if (!rl.ok) return rateLimitedResponse(rl.retryAfterMs);

  const page = (outcome: UnsubscribeOutcome, status: number) =>
    new Response(unsubscribePage(outcome), {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        "Referrer-Policy": "no-referrer",
        "X-Robots-Tag": "noindex",
        "X-Request-Id": requestId,
      },
    });

  let secret: string | undefined;
  let store;
  try {
    secret = unsubscribeSecret();
    store = reportDeps.store();
  } catch (err) {
    log.error({ requestId, err: err instanceof Error ? err.message : String(err) }, "report unsubscribe: server env invalid");
    return page("unavailable", 500);
  }
  if (!secret || !store) {
    log.warn({ requestId, secret: Boolean(secret), serviceRole: Boolean(store) }, "report unsubscribe called without CRON_SECRET or the service role");
    return page("unavailable", 503);
  }

  const params = new URL(req.url).searchParams;
  const userId = verifyUnsubscribe(params.get("u"), params.get("t"), secret);
  if (!userId) {
    log.warn({ requestId, ip: clientIp(req) }, "report unsubscribe link did not verify");
    return page("invalid", 400);
  }

  try {
    await store.setOptOut(userId, true);
  } catch (err) {
    log.error({ requestId, userId, err: err instanceof Error ? err.message : String(err) }, "report unsubscribe: opt-out not saved");
    return page("unavailable", 502);
  }
  log.info({ requestId, userId }, "weekly report email turned off from the email's link");
  return page("done", 200);
}
