import { z } from "zod";
import { AskHistoryResponseSchema, AskScreenIdSchema, type AskHistoryResponse } from "@/lib/live/ask/contracts";
import { json, requireUser } from "@/lib/server/auth";
import { buildAskHello, buildNewScreenHello } from "@/lib/server/ask/hello";
import { loadAskContext, readAskHistory } from "@/lib/server/ask/store";
import { liveLogger, withRequestId } from "@/lib/server/live-route";
import { checkRateLimitDistributed, rateLimitedResponse } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

const QuerySchema = z.object({
  boardId: z.string().trim().min(1).max(64),
  /** the screen whose chat to read (its tldraw page id); absent: the whole board's, as before */
  screenId: AskScreenIdSchema.optional(),
  /** the screen is the board's first (by the pages' order, which only the client knows) */
  first: z.enum(["1", "0", "true", "false"]).optional(),
});

/**
 * GET /api/live/ask/history?boardId=<id>[&screenId=<page id>&first=1|0] — a board's saved Ask chat
 * (`AskHistoryResponse`): its newest ASK_LIMITS.storedTurns turns, oldest first, read with the
 * student's own token (RLS).
 *
 * A chat per screen (docs/ASK-V2.md). With `screenId`, that screen's chat only. Turns saved without
 * a screen (before chats were per screen, or by an older client) are the board's FIRST screen's,
 * and only the client knows which screen is first (the board's pages are not the server's to read),
 * so the client says: `first=1` adds those turns to this screen's. The rule is the client's page
 * order at the moment it asks; a board whose first screen was deleted hands them to the screen that
 * is first now. Without `screenId` (an older client) it is the whole board's chat, as before.
 *
 * A screen with no turns yet answers a `hello` instead, built without a model call:
 *   - the first screen (or no screen named): today's hello from what the tutor knows — name, grade,
 *     the last skill worked in an EARLIER session (not on this board, not in the last
 *     LAST_SESSION_GAP_MS), whether it remembers anything ("Welcome back, Maya!…");
 *   - any other screen: "New screen! What should we work on?", with chips that follow from the
 *     screen before when the board's learning record names what was worked on there
 *     (`buildNewScreenHello`: "3 more on dividing fractions").
 *
 * requireUser (401) -> the `liveAskHistory` bucket (429) -> the query (400) -> the board must be the
 * caller's: anyone else's, a deleted one and none at all are the same 404 -> 502 when the chat could
 * not be read. Without the table (the migration not applied) the answer is no turns and a hello.
 * Never charged; always no-store (it is a child's chat).
 */
export async function GET(req: Request) {
  const requestId = crypto.randomUUID();
  const auth = await requireUser(req);
  if ("response" in auth) return withRequestId(auth.response, requestId);
  const { user, token } = auth;
  const log = liveLogger.child({ requestId, route: "ask/history", userId: user.id });

  const rl = await checkRateLimitDistributed({ token, userId: user.id, bucket: "liveAskHistory" });
  if (!rl.ok) return withRequestId(rateLimitedResponse(rl.retryAfterMs, rl.backend), requestId);

  const query = QuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!query.success) return json(400, "invalid_request", "Which board? Send ?boardId=<the board's id> (and ?screenId=<a page id>).", { requestId }, { ...NO_STORE, "X-Request-Id": requestId });
  const { boardId, screenId } = query.data;
  // no screen named is the first screen's chat (and the whole board's, as before)
  const first = !screenId || query.data.first === "1" || query.data.first === "true";

  const caller = { token, userId: user.id };
  const read = await readAskHistory(caller, boardId, screenId ? { id: screenId, first } : null);
  if (read.kind === "missing") return json(404, "not_found", "No board of yours has that id.", { requestId }, { ...NO_STORE, "X-Request-Id": requestId });
  if (read.kind === "failed") return json(502, "upstream_error", "The chat couldn't be loaded. Try again in a moment.", { requestId }, { ...NO_STORE, "X-Request-Id": requestId });

  // "Last time" is an earlier session: not this board's attempts, nor any from the last half hour.
  // A new screen follows from this board's own work instead.
  const hello = read.turns.length
    ? null
    : first
      ? buildAskHello(await loadAskContext(caller, { lastSession: { boardId } }))
      : buildNewScreenHello(await loadAskContext(caller, { onBoard: boardId }));
  const parsed = AskHistoryResponseSchema.safeParse({ turns: read.turns, hello });
  if (!parsed.success) {
    log.error({ boardId, issue: parsed.error.issues[0]?.message }, "ask history: the answer did not fit the contract");
    return json(502, "upstream_error", "The chat couldn't be loaded. Try again in a moment.", { requestId }, { ...NO_STORE, "X-Request-Id": requestId });
  }
  const body: AskHistoryResponse = parsed.data;
  log.info({ boardId, screen: screenId ? (first ? "first" : "other") : "board", turns: body.turns.length, hello: hello !== null }, "ask history");
  return Response.json(body, { headers: { ...NO_STORE, "X-Request-Id": requestId } });
}
