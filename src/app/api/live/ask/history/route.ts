import { z } from "zod";
import { AskHistoryResponseSchema, type AskHistoryResponse } from "@/lib/live/ask/contracts";
import { json, requireUser } from "@/lib/server/auth";
import { buildAskHello } from "@/lib/server/ask/hello";
import { loadAskContext, readAskHistory } from "@/lib/server/ask/store";
import { liveLogger, withRequestId } from "@/lib/server/live-route";
import { checkRateLimitDistributed, rateLimitedResponse } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

const QuerySchema = z.object({ boardId: z.string().trim().min(1).max(64) });

/**
 * GET /api/live/ask/history?boardId=<id> — a board's saved Ask chat (`AskHistoryResponse`): its
 * newest ASK_LIMITS.storedTurns turns, oldest first, read with the student's own token (RLS). A
 * board with no turns yet answers a `hello` instead, built from what the tutor knows (name, grade,
 * the last skill worked, whether it remembers anything), without a model call.
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
  if (!query.success) return json(400, "invalid_request", "Which board? Send ?boardId=<the board's id>.", { requestId }, { ...NO_STORE, "X-Request-Id": requestId });
  const { boardId } = query.data;

  const caller = { token, userId: user.id };
  const read = await readAskHistory(caller, boardId);
  if (read.kind === "missing") return json(404, "not_found", "No board of yours has that id.", { requestId }, { ...NO_STORE, "X-Request-Id": requestId });
  if (read.kind === "failed") return json(502, "upstream_error", "The chat couldn't be loaded. Try again in a moment.", { requestId }, { ...NO_STORE, "X-Request-Id": requestId });

  const hello = read.turns.length ? null : buildAskHello(await loadAskContext(caller));
  const parsed = AskHistoryResponseSchema.safeParse({ turns: read.turns, hello });
  if (!parsed.success) {
    log.error({ boardId, issue: parsed.error.issues[0]?.message }, "ask history: the answer did not fit the contract");
    return json(502, "upstream_error", "The chat couldn't be loaded. Try again in a moment.", { requestId }, { ...NO_STORE, "X-Request-Id": requestId });
  }
  const body: AskHistoryResponse = parsed.data;
  log.info({ boardId, turns: body.turns.length, hello: hello !== null }, "ask history");
  return Response.json(body, { headers: { ...NO_STORE, "X-Request-Id": requestId } });
}
