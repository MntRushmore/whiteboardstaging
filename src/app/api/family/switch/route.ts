import { logger } from "@/lib/logger";
import { requireUser } from "@/lib/server/auth";
import { checkRateLimitDistributed, rateLimitedResponse } from "@/lib/server/rate-limit";
import { parseJsonBody, recordRouteEvent } from "@/lib/server/request";
import { SwitchSchema } from "@/lib/family/schemas";
import { answer, familyFailure, familyStore } from "@/lib/family/server/http";
import { switchProfile } from "@/lib/family/server/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** One PIN check (scrypt), one link made and verified in Auth, one sign-out. */
export const maxDuration = 20;

const log = logger.child({ module: "family", route: "switch" });

/**
 * POST /api/family/switch `{ to, pin? }` (SwitchInput) — become another profile of the caller's
 * family, without a password: the server mints `to`'s session (a magic link's token, verified on
 * the server; no email is sent) and answers `{ access_token, refresh_token }` (SwitchResult) for
 * `supabase.auth.setSession`. The caller's own session is then ended.
 *
 * Who: the caller and `to` must be in the same family (`decideSwitch`, src/lib/family/members.ts);
 * anything else — a solo account, another family's profile, a made-up id — is 404, the same answer
 * whether or not that account exists. Switching TO the grown-up needs their PIN (400 `pin_required`
 * without one), checked here against the hash, every try counted per family first: 403 `wrong_pin`
 * (with `triesLeft`), past 5 tries in 15 minutes 429, and the day's 10th wrong PIN (PIN_DAILY_LIMIT)
 * locks switching to the grown-up: that answer says `locked: true` and is recorded as an app event
 * (warn, `pin_locked`), and every try after it is 429 `reason: "pin_locked"` until the grown-up signs
 * in with their password or 24 hours pass. When the database's counter cannot be asked, the try is
 * refused (503 `pin_unavailable`), never let through uncounted. A kid to a sibling, or the grown-up
 * to a kid, needs no PIN. The PIN is never logged.
 *
 * requireUser (401) -> the `familySwitch` bucket (429) -> zod (400) -> 503 without the service role
 * -> the rules above -> 200, or 502 when Auth failed (nothing changed).
 */
export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;
  const { user, token } = auth;

  const rl = await checkRateLimitDistributed({ token, userId: user.id, bucket: "familySwitch" });
  if (!rl.ok) return rateLimitedResponse(rl.retryAfterMs, rl.backend);

  const body = await parseJsonBody(req, SwitchSchema);
  if ("response" in body) return body.response;

  const env = familyStore(log, requestId);
  if ("response" in env) return env.response;

  try {
    const outcome = await switchProfile(env.store, user, token, body.data);
    if (outcome.ok) log.info({ requestId, userId: user.id, to: body.data.to }, "profile switched");
    else log.info({ requestId, userId: user.id, status: outcome.status, reason: outcome.extra?.reason ?? null }, "profile switch refused");
    if (!outcome.ok && outcome.event) recordRouteEvent(log.child({ requestId, userId: user.id }), { level: "warn", ...outcome.event });
    return answer(outcome, requestId);
  } catch (err) {
    return familyFailure(err, { log, requestId, userId: user.id, what: "switch" });
  }
}
