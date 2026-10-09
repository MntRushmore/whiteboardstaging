import { logger } from "@/lib/logger";
import { requireUser } from "@/lib/server/auth";
import { checkRateLimitDistributed, rateLimitedResponse } from "@/lib/server/rate-limit";
import { parseBoardId, reportAnswer, reportFailure, reportRefusal, reportStore } from "@/lib/report/http";
import { readReplay } from "@/lib/report/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** A board's data can be 8 MB. */
export const maxDuration = 30;

const log = logger.child({ module: "report", route: "report/boards/[id]" });

/**
 * GET /api/report/boards/<id> — one board to replay from the weekly report ("Watch them solve it"):
 * `{ id, ownerId, ownerName, title, updatedAt, snapshot }`, the snapshot as stored. A kid's board is
 * private to their family: RLS lets only the kid read it, so the grown-up's look goes through here,
 * where the service role reads it only after `mayWatch` (src/lib/report/access.ts) found the board's
 * owner to be the caller or one of the caller's OWN kids. The owner is read first and the board's
 * data only after that check. Any other board answers 404, the same as one that does not exist.
 *
 * requireUser (401) -> the `report` bucket (429) -> the id (400) -> 503 without the service role ->
 * 200, 404, or 502 when a read failed.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;
  const { user, token } = auth;

  const rl = await checkRateLimitDistributed({ token, userId: user.id, bucket: "report" });
  if (!rl.ok) return rateLimitedResponse(rl.retryAfterMs, rl.backend);

  const id = await parseBoardId(ctx.params, requestId);
  if ("response" in id) return id.response;

  const env = reportStore(log, requestId);
  if ("response" in env) return env.response;

  try {
    const board = await readReplay(env.store, user, id.id);
    if (!board) return reportRefusal(404, "No board of yours or your kids' has that id.", requestId);
    log.info({ requestId, userId: user.id, boardId: board.id, ownerId: board.ownerId, own: board.ownerId === user.id }, "report replay opened");
    return reportAnswer(board, requestId);
  } catch (err) {
    return reportFailure(err, { log, requestId, userId: user.id, what: "replay" });
  }
}
