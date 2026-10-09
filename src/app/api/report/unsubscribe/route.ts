import { logger } from "@/lib/logger";
import { checkRateLimit, clientIp, rateLimitedResponse } from "@/lib/server/rate-limit";
import { reportDeps } from "@/lib/report/server";
import { unsubscribePage, type UnsubscribeOutcome } from "@/lib/report/unsubscribePage";
import { reportLinkSecrets, unsubscribePath, verifyUnsubscribe } from "@/lib/report/unsubscribe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = logger.child({ module: "report", route: "report/unsubscribe" });

/** Per-IP budget: a person taps it once; this stops a script from walking user ids (it could not sign them anyway). */
const UNSUBSCRIBE_LIMIT = { limit: 20, windowMs: 60_000 } as const;

/**
 * /api/report/unsubscribe?u=<user id>&t=<tag> — the Sunday email's "stop these emails"
 * (src/lib/report/unsubscribe.ts). PUBLIC BY DESIGN, like the cron routes (allow-listed in
 * scripts/lib/routes.mjs): it is opened from a mail app where nobody may be signed in, so the signed
 * link is the auth. `t` must be the HMAC of `u` under REPORT_LINK_SECRET (else CRON_SECRET), or under
 * REPORT_LINK_SECRET_PREVIOUS (constant-time compare). It can only turn the email OFF; turning it
 * back on needs the grown-up signed in, on /report.
 *
 *   GET   checks the link and ASKS: a page whose one button posts back to the same link. It changes
 *         nothing, so a mail scanner that opens every link in a message (Safe Links, Mimecast,
 *         Proofpoint) never turns anyone's email off.
 *   POST  checks the link and turns the email off (the service role sets that account's
 *         profiles.weekly_report_opt_out and nothing else). This is the confirm page's button and
 *         also RFC 8058 one-click: the email's `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
 *         header has a mail app POST that body here; the body is never read.
 *
 * Answers a small HTML page (src/lib/report/unsubscribePage.ts), never JSON: 200 confirm (GET) or
 * done (POST), 400 for a link that does not verify, 503 without a signing secret or the service role,
 * 502 when the write failed; 429 past the per-IP budget (both methods share it).
 */
export async function GET(req: Request) {
  return handle(req, "confirm");
}

export async function POST(req: Request) {
  return handle(req, "stop");
}

async function handle(req: Request, mode: "confirm" | "stop"): Promise<Response> {
  const requestId = crypto.randomUUID();
  const rl = checkRateLimit(`ip:${clientIp(req)}:reportUnsubscribe`, UNSUBSCRIBE_LIMIT);
  if (!rl.ok) return rateLimitedResponse(rl.retryAfterMs);

  const page = (outcome: UnsubscribeOutcome, status: number, action?: string) =>
    new Response(unsubscribePage(outcome, action), {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        // the confirm page's form posts to this same route; nothing else is allowed
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
        "Referrer-Policy": "no-referrer",
        "X-Robots-Tag": "noindex",
        "X-Request-Id": requestId,
      },
    });

  let secrets;
  let store;
  try {
    secrets = reportLinkSecrets();
    store = reportDeps.store();
  } catch (err) {
    log.error({ requestId, err: err instanceof Error ? err.message : String(err) }, "report unsubscribe: server env invalid");
    return page("unavailable", 500);
  }
  if (!secrets || !store) {
    log.warn({ requestId, secret: Boolean(secrets), serviceRole: Boolean(store) }, "report unsubscribe called without REPORT_LINK_SECRET/CRON_SECRET or the service role");
    return page("unavailable", 503);
  }

  const params = new URL(req.url).searchParams;
  const tag = params.get("t");
  const userId = verifyUnsubscribe(params.get("u"), tag, secrets.accept);
  if (!userId || !tag) {
    log.warn({ requestId, ip: clientIp(req), method: req.method }, "report unsubscribe link did not verify");
    return page("invalid", 400);
  }

  // Opening the link only asks: the button posts back to it.
  if (mode === "confirm") return page("confirm", 200, unsubscribePath(userId, tag));

  try {
    await store.setOptOut(userId, true);
  } catch (err) {
    log.error({ requestId, userId, err: err instanceof Error ? err.message : String(err) }, "report unsubscribe: opt-out not saved");
    return page("unavailable", 502);
  }
  log.info({ requestId, userId }, "weekly report email turned off from the email's link");
  return page("done", 200);
}
