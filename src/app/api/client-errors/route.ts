import { z } from "zod";
import { EVENT_KIND } from "@/lib/admin/contracts";
import { MAX_MESSAGE, MAX_REPORT_BYTES, MAX_STACK, stripUrlQueries } from "@/lib/clientErrors";
import { logger } from "@/lib/logger";
import { identifyUser, json } from "@/lib/server/auth";
import { recordEvent } from "@/lib/server/events";
import { checkRateLimit, clientIp, rateLimitedResponse } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

/**
 * Per-IP budget. One page load sends at most MAX_REPORTS (10); this lets a couple of crashing
 * loads a minute through and stops a loop, or anyone with curl, from filling the logs.
 */
const CLIENT_ERRORS_LIMIT = { limit: 20, windowMs: 60_000 } as const;

/** ClientErrorReport (src/lib/clientErrors.ts). Unknown keys are dropped, never logged. */
const ReportSchema = z.object({
  source: z.enum(["error", "rejection", "boundary", "global", "live"]),
  message: z.string().min(1).max(MAX_MESSAGE),
  stack: z.string().max(MAX_STACK).optional(),
  path: z.string().max(512).startsWith("/"),
  boardId: z.string().regex(/^[0-9a-f-]{36}$/i).optional(),
  userAgent: z.string().max(512).optional(),
  release: z.string().min(1).max(64),
  digest: z.string().max(64).optional(),
  /** what failed (`EVENT_KIND`, src/lib/admin/contracts.ts) and how, for the admin page */
  kind: z.string().regex(EVENT_KIND).optional(),
  code: z.string().max(40).optional(),
});

const log = logger.child({ module: "client-error" });

/** A board id app_events can store (a uuid; ReportSchema checks only its shape, loosely). */
const BOARD_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The top of the stack kept on the event, in characters (the log line keeps all of it). */
const STACK_HEAD = 600;

/** The body as text, or null once it passes `max` bytes (stops reading there; Content-Length is checked first). */
async function readCapped(req: Request, max: number): Promise<string | null> {
  if (Number(req.headers.get("content-length")) > max) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * POST /api/client-errors — a crash in the browser, or an error a student saw on the board
 * (src/lib/clientErrors.ts), becomes one structured log line, `module: "client-error"`
 * (docs/RUNBOOK-ops.md says where to find it), and one app event for the /admin page
 * (`recordEvent`, src/lib/server/events.ts): source `live` for `source: "live"`, else `client`;
 * kind the report's own (`live.solve`) or `client.<source>`; the path as its route; the digest, the
 * top of the stack and the user agent in `meta`. Fire and forget, so the answer never waits for it.
 *
 * PUBLIC BY DESIGN (allow-listed in scripts/lib/routes.mjs): errors happen signed out too, and a
 * beacon cannot carry a token. Per-IP rate limit -> 16 KB body cap (413) -> JSON + zod (400) ->
 * one log line and one event -> 204 with no body. A bearer token, when sent, only names the user in
 * the line and the event (`identifyUser`: the user id, never the token); a missing or bad one is
 * not an error. Query
 * strings and hashes are stripped from the path and from every URL in the message and stack again
 * here, whatever the client did.
 */
export async function POST(req: Request) {
  const rl = checkRateLimit(`ip:${clientIp(req)}:clientErrors`, CLIENT_ERRORS_LIMIT);
  if (!rl.ok) return rateLimitedResponse(rl.retryAfterMs);

  const text = await readCapped(req, MAX_REPORT_BYTES);
  if (text === null) return json(413, "invalid_request", `Report is too large (max ${MAX_REPORT_BYTES} bytes).`);

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return json(400, "invalid_request", "Request body must be valid JSON.");
  }
  const parsed = ReportSchema.safeParse(raw);
  if (!parsed.success) return json(400, "invalid_request", "Invalid error report.");

  const report = parsed.data;
  const userId = await identifyUser(req);
  const message = stripUrlQueries(report.message);
  const stack = report.stack ? stripUrlQueries(report.stack) : undefined;
  const path = report.path.replace(/[?#][\s\S]*/, "");
  const userAgent = report.userAgent ?? req.headers.get("user-agent")?.slice(0, 512);
  log.error(
    {
      source: report.source,
      kind: report.kind,
      code: report.code,
      message,
      stack,
      path,
      boardId: report.boardId,
      release: report.release,
      digest: report.digest,
      userAgent,
      userId: userId ?? undefined,
    },
    "client error",
  );
  // The same report as an app event, for the admin page and the error-spike alert (fire and
  // forget: the 204 never waits for it).
  recordEvent({
    source: report.source === "live" ? "live" : "client",
    level: "error",
    kind: report.kind ?? `client.${report.source}`,
    code: report.code,
    message,
    route: path,
    userId: userId ?? undefined,
    boardId: report.boardId && BOARD_UUID.test(report.boardId) ? report.boardId : undefined,
    release: report.release,
    meta: {
      ...(report.digest ? { digest: report.digest } : {}),
      ...(stack ? { stack: stack.split("\n").slice(0, 4).join("\n").slice(0, STACK_HEAD) } : {}),
      ...(userAgent ? { userAgent: userAgent.slice(0, 200) } : {}),
    },
  });
  return new Response(null, { status: 204 });
}
