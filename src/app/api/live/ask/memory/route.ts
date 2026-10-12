import type pino from "pino";
import { z } from "zod";
import { isKidEmail } from "@/lib/family/contracts";
import { ownsKid, type FamilyLinks } from "@/lib/family/members";
import { familyDeps } from "@/lib/family/server/store";
import { AskMemoryResponseSchema, type LearnerMemory } from "@/lib/live/ask/contracts";
import { json, requireUser, type AuthedUser } from "@/lib/server/auth";
import { deleteKidMemory, deleteLearnerMemory, fetchKidMemory, fetchLearnerMemory } from "@/lib/server/ask/store";
import { liveLogger, withRequestId } from "@/lib/server/live-route";
import { checkRateLimitDistributed, rateLimitedResponse } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

const QuerySchema = z.object({ kidId: z.string().uuid().optional() });

type Who = { kind: "self" } | { kind: "kid"; kidId: string };

/**
 * Whose memory: the caller's own, or with `?kidId=` one of the caller's OWN kids (the grown-up on the
 * Family page). A kid profile asking about anyone is 403; a kid who is not the caller's (another
 * family's, a made-up id) is 404, the same as no kid at all; 503 without the service role (the
 * family tables and another account's memory need it).
 */
async function whose(req: Request, user: AuthedUser, requestId: string, log: pino.Logger): Promise<{ who: Who } | { response: Response }> {
  const headers = { ...NO_STORE, "X-Request-Id": requestId };
  const query = QuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!query.success) return { response: json(400, "invalid_request", "The kid's profile id must be a uuid.", { requestId }, headers) };
  const kidId = query.data.kidId;
  if (!kidId || kidId === user.id) return { who: { kind: "self" } };

  let store: ReturnType<typeof familyDeps.store>;
  try {
    store = familyDeps.store();
  } catch (err) {
    log.error({ err: err instanceof Error ? err.message : String(err) }, "ask memory: server env invalid");
    return { response: json(500, "internal_error", "The server's environment is not set up.", { requestId }, headers) };
  }
  if (!store) return { response: json(503, "feature_unavailable", "Families are not set up on this deployment (SUPABASE_SERVICE_ROLE_KEY).", { requestId }, headers) };
  let links: FamilyLinks | null;
  try {
    links = await store.links(user.id);
  } catch (err) {
    log.error({ err: err instanceof Error ? err.message : String(err) }, "ask memory: family not read");
    return { response: json(502, "upstream_error", "Something went wrong on our side. Try again in a moment.", { requestId }, headers) };
  }
  if (isKidEmail(user.email) || (links && links.parentId !== user.id)) {
    return { response: json(403, "invalid_request", "A kid profile can't do that. Ask your grown-up.", { requestId, reason: "kid" }, headers) };
  }
  if (!ownsKid(links, user.id, kidId)) return { response: json(404, "not_found", "No kid in your family has that profile.", { requestId }, headers) };
  return { who: { kind: "kid", kidId } };
}

async function preamble(req: Request, route: string): Promise<{ user: AuthedUser; token: string; who: Who; requestId: string; log: pino.Logger } | { response: Response }> {
  const requestId = crypto.randomUUID();
  const auth = await requireUser(req);
  if ("response" in auth) return { response: withRequestId(auth.response, requestId) };
  const { user, token } = auth;
  const log = liveLogger.child({ requestId, route, userId: user.id });

  const rl = await checkRateLimitDistributed({ token, userId: user.id, bucket: "liveAskMemory" });
  if (!rl.ok) return { response: withRequestId(rateLimitedResponse(rl.retryAfterMs, rl.backend), requestId) };

  const target = await whose(req, user, requestId, log);
  if ("response" in target) return target;
  return { user, token, who: target.who, requestId, log };
}

function answer(memory: LearnerMemory, requestId: string): Response {
  return Response.json(AskMemoryResponseSchema.parse(memory), { headers: { ...NO_STORE, "X-Request-Id": requestId } });
}

const unavailable = (requestId: string, what: string) =>
  json(502, "upstream_error", `What Ask remembers couldn't be ${what}. Try again in a moment.`, { requestId }, { ...NO_STORE, "X-Request-Id": requestId });

/**
 * GET /api/live/ask/memory[?kidId=<uuid>] — what Ask remembers (`LearnerMemory`): the caller's own
 * notes (their token), or a kid's for their grown-up (service role, after the family check). The
 * account page's and the Family page's "What Ask remembers".
 *
 * requireUser (401) -> the `liveAskMemory` bucket (429) -> whose (400, 403, 404, 503) -> 502 when it
 * could not be read. No notes is `{ notes: [], updatedAt: null }`. Always no-store.
 */
export async function GET(req: Request) {
  const ctx = await preamble(req, "ask/memory");
  if ("response" in ctx) return ctx.response;
  const { user, token, who, requestId, log } = ctx;
  const memory = who.kind === "kid" ? await fetchKidMemory(who.kidId) : await fetchLearnerMemory({ token, userId: user.id });
  if (!memory) return unavailable(requestId, "loaded");
  log.info({ kid: who.kind === "kid", notes: memory.notes.length }, "ask memory read");
  return answer(memory, requestId);
}

/**
 * DELETE /api/live/ask/memory[?kidId=<uuid>] — clears what Ask remembers: the caller's own notes
 * (their token: the owner's delete policy), or a kid's for their grown-up (service role, after the
 * family check). The tutor starts again from nothing; the boards and their chats stay. Answers the
 * memory as it now is (`{ notes: [], updatedAt: null }`), or 502 when it could not be cleared.
 */
export async function DELETE(req: Request) {
  const ctx = await preamble(req, "ask/memory");
  if ("response" in ctx) return ctx.response;
  const { user, token, who, requestId, log } = ctx;
  const cleared = who.kind === "kid" ? await deleteKidMemory(who.kidId) : await deleteLearnerMemory({ token, userId: user.id });
  if (!cleared) return unavailable(requestId, "cleared");
  log.info({ kid: who.kind === "kid" }, "ask memory cleared");
  return answer({ notes: [], updatedAt: null }, requestId);
}
