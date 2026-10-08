import { logger } from "@/lib/logger";
import { requireAdmin } from "@/lib/server/admin";
import { bugScreenshot } from "@/lib/server/adminConsole/bugs";
import { consoleEnv, consoleFailure, notFound, parseId } from "@/lib/server/adminConsole/http";
import { checkRateLimit, LIMITS, rateLimitKey, rateLimitedResponse } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

const log = logger.child({ module: "admin-console", route: "admin/bugs/[id]/screenshot" });

/**
 * GET /api/admin/bugs/<id>/screenshot: the report's screenshot as image bytes (decoded from the
 * stored data URL; PNG, JPEG, WebP or GIF, never SVG), kept by the admin's browser for 5 minutes
 * (`Cache-Control: private`). Written to admin_audit ('bug.screenshot') before the bytes are sent.
 *
 * `requireAdmin` first: requireUser(req) (401 signed out), then the admins table (404 for everyone
 * else), then its own bucket (`adminScreenshot`: the inbox may load several). 400 for a bad id, 404
 * for no such report or no screenshot, 503 without SUPABASE_SERVICE_ROLE_KEY or when the look cannot
 * be logged, 502 when the read fails or the stored screenshot is not an image.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  const gate = await requireAdmin(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  const limited = checkRateLimit(rateLimitKey(user.id, "adminScreenshot"), LIMITS.adminScreenshot);
  if (!limited.ok) return rateLimitedResponse(limited.retryAfterMs, "memory");

  const id = await parseId(ctx.params, "bug report", requestId);
  if ("response" in id) return id.response;

  const env = consoleEnv(log, requestId);
  if ("response" in env) return env.response;

  try {
    const shot = await bugScreenshot(env.deps, id.id, user.id);
    if (shot.kind === "missing") return notFound("No bug report has that id.", requestId);
    if (shot.kind === "none") return notFound("This bug report has no screenshot.", requestId);
    if (shot.kind === "invalid") return consoleFailure(new Error("the stored screenshot is not a PNG, JPEG, WebP or GIF data URL"), { log, requestId, userId: user.id, what: "screenshot" });
    return new Response(new Blob([shot.bytes as Uint8Array<ArrayBuffer>], { type: shot.contentType }), {
      headers: {
        "Content-Type": shot.contentType,
        "Cache-Control": "private, max-age=300",
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
        "X-Request-Id": requestId,
      },
    });
  } catch (err) {
    return consoleFailure(err, { log, requestId, userId: user.id, what: "screenshot" });
  }
}
