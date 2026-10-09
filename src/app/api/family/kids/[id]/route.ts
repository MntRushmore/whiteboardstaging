import { logger } from "@/lib/logger";
import { requireUser } from "@/lib/server/auth";
import { checkRateLimitDistributed, rateLimitedResponse } from "@/lib/server/rate-limit";
import { parseJsonBody } from "@/lib/server/request";
import { EditKidSchema } from "@/lib/family/schemas";
import { answer, familyFailure, familyStore, parseKidId } from "@/lib/family/server/http";
import { editKid, removeKid } from "@/lib/family/server/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = logger.child({ module: "family", route: "kids/[id]" });

/**
 * PATCH /api/family/kids/<id> `{ displayName?, grade?, avatar? }` (EditKidSchema) — change one of
 * the caller's OWN kids' name, grade or picture. 404 for any id that is not their kid (another
 * family's, a sibling asking, a made-up one); 403 for a kid profile.
 *
 * requireUser (401) -> the `family` bucket (429) -> the id (400) -> zod (400) -> 503 without the
 * service role -> 200 `{ updated: true }`, or 502 when the write failed.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;
  const { user, token } = auth;

  const rl = await checkRateLimitDistributed({ token, userId: user.id, bucket: "family" });
  if (!rl.ok) return rateLimitedResponse(rl.retryAfterMs, rl.backend);

  const id = await parseKidId(ctx.params, requestId);
  if ("response" in id) return id.response;
  const body = await parseJsonBody(req, EditKidSchema);
  if ("response" in body) return body.response;

  const env = familyStore(log, requestId);
  if ("response" in env) return env.response;

  try {
    const outcome = await editKid(env.store, user, id.id, body.data);
    if (outcome.ok) log.info({ requestId, userId: user.id, kidId: id.id }, "kid profile edited");
    return answer(outcome, requestId);
  } catch (err) {
    return familyFailure(err, { log, requestId, userId: user.id, what: "edit kid" });
  }
}

/**
 * DELETE /api/family/kids/<id> — remove one of the caller's OWN kids: their saved images, then their
 * account, which takes their boards, learning record and everything else with it. The family page
 * asks first, in a dialog that says so. 404 for any id that is not their kid; 403 for a kid profile.
 * No body.
 */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;
  const { user, token } = auth;

  const rl = await checkRateLimitDistributed({ token, userId: user.id, bucket: "family" });
  if (!rl.ok) return rateLimitedResponse(rl.retryAfterMs, rl.backend);

  const id = await parseKidId(ctx.params, requestId);
  if ("response" in id) return id.response;

  const env = familyStore(log, requestId);
  if ("response" in env) return env.response;

  try {
    const outcome = await removeKid(env.store, user, id.id);
    if (outcome.ok) log.info({ requestId, userId: user.id, kidId: id.id, assetsError: outcome.value.assetsError }, "kid profile removed");
    return answer(outcome, requestId);
  } catch (err) {
    return familyFailure(err, { log, requestId, userId: user.id, what: "remove kid" });
  }
}
