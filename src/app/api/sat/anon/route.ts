import { SAT_ANON_LIMITS, SatAnonRequestSchema } from "@/lib/sat/contracts";
import { appClaimOf, appError, appRefusal, verifyAppClaim } from "@/lib/server/appAttest/guard";
import { withRequestId } from "@/lib/server/live-route";
import { checkRateLimit } from "@/lib/server/rate-limit";
import { satAnonDeps } from "@/lib/server/sat/anon";
import { satLogger } from "@/lib/server/sat/http";
import { parseJson, readCapped, visitorIp } from "@/lib/server/try/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/sat/anon — an anonymous session for SAT mode, for the iPad app only (docs/SAT-MODE.md):
 * `{ access_token, refresh_token, expires_at, user_id }`, which the app adopts with setSession.
 *
 * PUBLIC BY DESIGN (no user JWT exists yet; allow-listed in scripts/lib/routes.mjs), and APP ONLY:
 * the App Attest headers are required (src/lib/server/appAttest/guard.ts; the debug uuid off
 * production only). There is no web path. In order: no app headers or incomplete ones -> 403
 * `attest_required` / `attest_invalid`; a body over 1 KB -> 413; the assertion over the body's exact
 * bytes -> 403 `attest_unknown_key` / `attest_invalid` (429 past the per-IP verifications, 503
 * without the key store); not a JSON object -> 400; 20 an hour per IP and 5 a day per attested key
 * (or debug device) -> 429 `rate_limited`; then Supabase Auth's anonymous sign-in with the anon key
 * (503 `unavailable` when anonymous sign-ins are off, or Auth fails). Never cached; one info line,
 * never a key id, a device id, an IP or a token.
 */
export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  const log = satLogger.child({ requestId, route: "sat/anon" });
  const done = (res: Response) => withRequestId(res, requestId);

  const app = appClaimOf(req);
  if (!app) return done(appRefusal("attest_required"));
  if (app.kind === "refused") {
    log.info({ reason: app.reason }, "sat anon refused: the app's headers");
    return done(appRefusal(app.reason));
  }
  const raw = await readCapped(req, SAT_ANON_LIMITS.maxBytes, "bytes");
  if (raw === null) return done(appError(413, "invalid_request"));
  const ip = visitorIp(req);
  const pass = await verifyAppClaim(app, raw, ip);
  if (!pass.ok) return done(pass.response);
  const parsed = SatAnonRequestSchema.safeParse(parseJson(raw.toString("utf8")));
  if (!parsed.success) return done(appError(400, "invalid_request"));

  const byIp = checkRateLimit(`ip:${ip}:satAnon`, SAT_ANON_LIMITS.perIp);
  if (!byIp.ok) return done(appError(429, "rate_limited", { retryAfterMs: byIp.retryAfterMs }));
  const byDevice = checkRateLimit(`${pass.who}:satAnon`, SAT_ANON_LIMITS.perDevice);
  if (!byDevice.ok) return done(appError(429, "rate_limited", { retryAfterMs: byDevice.retryAfterMs }));

  const signed = await satAnonDeps.signIn();
  if (!signed.ok) {
    log.warn({ disabled: signed.disabled, error: signed.message.slice(0, 160) }, "sat anon: Supabase Auth gave no session");
    return done(appError(503, "unavailable"));
  }
  log.info({ path: pass.path }, "sat anon session");
  return done(Response.json(signed.session, { headers: { "Cache-Control": "no-store" } }));
}
