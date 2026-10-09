import { logger } from "@/lib/logger";
import { requireUser } from "@/lib/server/auth";
import { checkRateLimitDistributed, rateLimitedResponse } from "@/lib/server/rate-limit";
import { answer, familyFailure, familyStore, tzOffsetOf } from "@/lib/family/server/http";
import { readFamily, removeKidsImages } from "@/lib/family/server/service";
import { familyDeps } from "@/lib/family/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = logger.child({ module: "family", route: "family" });

/**
 * GET /api/family[?tz=<minutes>] — the caller's family (`FamilyState`, src/lib/family/contracts.ts):
 * who is signed in, their grown-up and the kids, each with a name, a picture and a grade. For the
 * grown-up, each kid's headline numbers (streak, problems this week, skills mastered), read with the
 * service role for the caller's OWN kids only; a kid sees their siblings' names and pictures, never
 * their numbers. `tz` is the browser's Date#getTimezoneOffset, for "this week".
 *
 * requireUser (401) -> the `family` bucket (429) -> 503 without the service role -> 200, or 502 when
 * a read failed.
 */
export async function GET(req: Request) {
  const requestId = crypto.randomUUID();
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;
  const { user, token } = auth;

  const rl = await checkRateLimitDistributed({ token, userId: user.id, bucket: "family" });
  if (!rl.ok) return rateLimitedResponse(rl.retryAfterMs, rl.backend);

  const env = familyStore(log, requestId);
  if ("response" in env) return env.response;

  try {
    const state = await readFamily(env.store, user, { now: familyDeps.now(), tzOffsetMinutes: tzOffsetOf(req) });
    return answer({ ok: true, value: state }, requestId);
  } catch (err) {
    return familyFailure(err, { log, requestId, userId: user.id, what: "read" });
  }
}

/**
 * DELETE /api/family — remove the saved images of every kid of the caller's family: the first step of
 * deleting the grown-up's own account (src/lib/billing/deleteAccount.ts), because SQL cannot remove
 * files. The kids' accounts are NOT deleted here: delete_own_account() deletes them in the same
 * transaction as the grown-up's, so a refused or failed deletion keeps every kid. Answers
 * `{ removed }` (the kids whose images were cleared); nothing to do for a solo account; 403 for a kid
 * profile. No body.
 */
export async function DELETE(req: Request) {
  const requestId = crypto.randomUUID();
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;
  const { user, token } = auth;

  const rl = await checkRateLimitDistributed({ token, userId: user.id, bucket: "family" });
  if (!rl.ok) return rateLimitedResponse(rl.retryAfterMs, rl.backend);

  const env = familyStore(log, requestId);
  if ("response" in env) return env.response;

  try {
    const outcome = await removeKidsImages(env.store, user);
    if (outcome.ok) log.info({ requestId, userId: user.id, removed: outcome.value.removed }, "kids' images removed before account deletion");
    return answer(outcome, requestId);
  } catch (err) {
    return familyFailure(err, { log, requestId, userId: user.id, what: "removal" });
  }
}
