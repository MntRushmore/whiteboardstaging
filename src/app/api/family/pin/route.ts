import { logger } from "@/lib/logger";
import { requireUser } from "@/lib/server/auth";
import { checkRateLimitDistributed, rateLimitedResponse } from "@/lib/server/rate-limit";
import { parseJsonBody } from "@/lib/server/request";
import { SetPinSchema } from "@/lib/family/schemas";
import { answer, familyFailure, familyStore } from "@/lib/family/server/http";
import { setFamilyPin } from "@/lib/family/server/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = logger.child({ module: "family", route: "pin" });

/**
 * POST /api/family/pin `{ pin }` — set or change the grown-up's 4-digit PIN (SetPinSchema). The
 * grown-up's own session is the proof: a kid profile is refused (403). The first PIN creates the
 * family; it must be set before the first kid is added, because it is what keeps a kid from
 * switching back into the grown-up's profile. Stored only as a scrypt hash (src/lib/family/server
 * /pin.ts); the PIN itself is never logged.
 *
 * requireUser (401) -> the `family` bucket (429) -> zod (400) -> 503 without the service role ->
 * 200 `{ hasPin: true }`, or 502 when the write failed.
 */
export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;
  const { user, token } = auth;

  const rl = await checkRateLimitDistributed({ token, userId: user.id, bucket: "family" });
  if (!rl.ok) return rateLimitedResponse(rl.retryAfterMs, rl.backend);

  const body = await parseJsonBody(req, SetPinSchema);
  if ("response" in body) return body.response;

  const env = familyStore(log, requestId);
  if ("response" in env) return env.response;

  try {
    const outcome = await setFamilyPin(env.store, user, body.data.pin);
    if (outcome.ok) log.info({ requestId, userId: user.id }, "family PIN set");
    return answer(outcome, requestId);
  } catch (err) {
    return familyFailure(err, { log, requestId, userId: user.id, what: "PIN" });
  }
}
