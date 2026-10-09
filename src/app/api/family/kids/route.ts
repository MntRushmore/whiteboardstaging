import { logger } from "@/lib/logger";
import { requireUser } from "@/lib/server/auth";
import { checkRateLimitDistributed, rateLimitedResponse } from "@/lib/server/rate-limit";
import { parseJsonBody } from "@/lib/server/request";
import { AddKidSchema } from "@/lib/family/schemas";
import { answer, familyFailure, familyStore } from "@/lib/family/server/http";
import { addKid } from "@/lib/family/server/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** One account made in Auth, one profile write, one link. */
export const maxDuration = 20;

const log = logger.child({ module: "family", route: "kids" });

/**
 * POST /api/family/kids `{ displayName, grade, avatar }` (AddKidInput) — add a kid profile under the
 * signed-in grown-up: a real account made by the server (no email of its own, no password anyone
 * knows; src/lib/family/server/store.ts), with the kid's name, grade and picture, already past the
 * welcome. Refused for a kid profile (403), before the PIN is set (409 `pin_required`) and past
 * MAX_KIDS (409 `too_many`). Answers the new `FamilyMember` (201).
 *
 * requireUser (401) -> the `family` bucket (429) -> zod (400) -> 503 without the service role ->
 * 201, or 502 when Auth or a write failed (a half-made account is deleted again).
 */
export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;
  const { user, token } = auth;

  const rl = await checkRateLimitDistributed({ token, userId: user.id, bucket: "family" });
  if (!rl.ok) return rateLimitedResponse(rl.retryAfterMs, rl.backend);

  const body = await parseJsonBody(req, AddKidSchema);
  if ("response" in body) return body.response;

  const env = familyStore(log, requestId);
  if ("response" in env) return env.response;

  try {
    const outcome = await addKid(env.store, user, body.data);
    if (outcome.ok) log.info({ requestId, userId: user.id, kidId: outcome.value.userId }, "kid profile added");
    return answer(outcome, requestId, 201);
  } catch (err) {
    return familyFailure(err, { log, requestId, userId: user.id, what: "add kid" });
  }
}
