import { appError } from "@/lib/server/appAttest/guard";
import { APP_ATTEST_LIMITS } from "@/lib/server/appAttest/config";
import { attestLogger, issueChallenge } from "@/lib/server/appAttest/service";
import { appAttestDeps } from "@/lib/server/appAttest/store";
import { checkRateLimit } from "@/lib/server/rate-limit";
import { visitorIp } from "@/lib/server/try/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

/**
 * POST /api/app/attest/challenge (no body) — the first half of App Attest for the iPad app before
 * its account (docs/ONBOARDING.md, "Server work this needs" 1; src/lib/server/appAttest). Answers
 * 200 `{ challenge, expiresAt }`: base64url of 32 random bytes, kept server-side
 * (`app_attest_challenges`, the service role only) for 5 minutes and good for ONE registration. The
 * app passes it to `DCAppAttestService.attestKey` as clientDataHash = SHA256(its UTF-8 bytes), then
 * sends the attestation to POST /api/app/attest/register.
 *
 * PUBLIC BY DESIGN (allow-listed in scripts/lib/routes.mjs): the app has no account yet, and a
 * challenge is worth nothing alone. In order: this IP's `APP_ATTEST_LIMITS.challenge` (in memory) ->
 * 429 `{ error: "rate_limited", retryAfterMs }`; no service role, or the challenge not saved -> 503
 * `{ error: "unavailable" }`. Never cached.
 */
export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  const log = attestLogger.child({ requestId, route: "attest/challenge" });
  const withId = (res: Response) => {
    res.headers.set("X-Request-Id", requestId);
    return res;
  };

  const mine = checkRateLimit(`ip:${visitorIp(req)}:appAttestChallenge`, APP_ATTEST_LIMITS.challenge);
  if (!mine.ok) return withId(appError(429, "rate_limited", { retryAfterMs: mine.retryAfterMs }));

  const out = await issueChallenge(appAttestDeps);
  if (!out.ok) {
    log.warn({}, "app attest: no challenge");
    return withId(appError(503, "unavailable"));
  }
  log.info({}, "app attest: challenge");
  return withId(Response.json({ challenge: out.challenge, expiresAt: out.expiresAt }, { headers: { "Cache-Control": "no-store" } }));
}
