import { AskMoveRequestSchema } from "@/lib/live/ask/contracts";
import { json, requireUser } from "@/lib/server/auth";
import { moveAskTurns } from "@/lib/server/ask/store";
import { liveLogger, withRequestId } from "@/lib/server/live-route";
import { checkRateLimitDistributed, rateLimitedResponse } from "@/lib/server/rate-limit";
import { parseJsonBody } from "@/lib/server/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/live/ask/history/move `{ boardId, turnIds, screenId }` (AskMoveRequestSchema) — the
 * tutor's own actions started a new screen (more problems on a full one), so the exchange that
 * asked for it moves into the new screen's chat with them (docs/ASK-V2.md, "A chat per screen").
 * Re-tags up to 4 of the CALLER'S OWN saved turns on a board of theirs to `screenId`, with their own
 * token (`ask_move_turns`, which acts only as them and only on their board). Answers `{ moved }`:
 * how many moved (0 when none of the ids is the caller's turn on this board).
 *
 * requireUser (401) -> the `liveAskMove` bucket (429) -> zod (400; the turn ids must be the saved
 * turns' uuids) -> the board must be the caller's: anyone else's, a deleted one and none at all are
 * the same 404 -> 503 before the migration (the turns stay on the screen they were asked from) ->
 * 502 when it could not be done. Never charged; always no-store.
 */
export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  const auth = await requireUser(req);
  if ("response" in auth) return withRequestId(auth.response, requestId);
  const { user, token } = auth;
  const log = liveLogger.child({ requestId, route: "ask/history/move", userId: user.id });
  const headers = { ...NO_STORE, "X-Request-Id": requestId };

  const rl = await checkRateLimitDistributed({ token, userId: user.id, bucket: "liveAskMove" });
  if (!rl.ok) return withRequestId(rateLimitedResponse(rl.retryAfterMs, rl.backend), requestId);

  const body = await parseJsonBody(req, AskMoveRequestSchema);
  if ("response" in body) return withRequestId(body.response, requestId);
  const { boardId, turnIds, screenId } = body.data;
  if (!turnIds.every((id) => UUID.test(id))) return json(400, "invalid_request", "turnIds must be the saved turns' ids.", { requestId }, headers);
  if (!UUID.test(boardId)) return json(404, "not_found", "No board of yours has that id.", { requestId }, headers);

  const result = await moveAskTurns({ token, userId: user.id }, boardId, turnIds, screenId);
  if (result.kind === "missing") return json(404, "not_found", "No board of yours has that id.", { requestId }, headers);
  if (result.kind === "unavailable") return json(503, "feature_unavailable", "Chats per screen are not set up here yet.", { requestId }, headers);
  if (result.kind === "failed") return json(502, "upstream_error", "The chat couldn't be moved. Try again in a moment.", { requestId }, headers);
  log.info({ boardId, asked: turnIds.length, moved: result.moved }, "ask turns moved to a new screen");
  return Response.json({ moved: result.moved }, { headers });
}
