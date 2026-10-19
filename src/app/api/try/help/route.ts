import { getEngine } from "@/lib/live/engine";
import { tryEnabled } from "@/lib/env";
import { withRequestId } from "@/lib/server/live-route";
import { checkRateLimit } from "@/lib/server/rate-limit";
import { errorResponse } from "@/lib/server/request";
import { nextTryStep } from "@/lib/server/try/help";
import { appClaimOf, appRefusal, pathOf, verifyAppClaim } from "@/lib/server/appAttest/guard";
import { isSameOrigin, parseJson, readCapped, TRY_HELP_MAX_BYTES, tryError, tryLogger, visitorIp } from "@/lib/server/try/http";
import { tryInk } from "@/lib/server/try/ink";
import { TRY_LIMITS, TryHelpRequestSchema, TryHelpResponseSchema } from "@/lib/try/contracts";
import { tryProblem } from "@/lib/try/problems";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

/**
 * POST /api/try/help — "Show me a step" on the try board (src/lib/try/contracts.ts): the next line
 * under the visitor's work from the engine's local solve (`nextTryStep`), in the tutor's hand
 * (`tryInk`: SVG paths and a writing schedule; null when the hand cannot write the line). No read,
 * no model: nothing it does costs anything but this server's time.
 *
 * PUBLIC BY DESIGN (allow-listed in scripts/lib/routes.mjs), with the check's guards less the day's
 * cap on reads, for our web page or the iPad app before its account (an App Attest assertion over
 * the body, src/lib/server/appAttest/guard.ts): `TRY_ENABLED=0` -> 503 `unavailable`; the web not
 * from our page -> 403 `invalid_request`, or the app's headers incomplete -> 403 `invalid_request`
 * with `reason` `attest_required` / `attest_invalid`; a body over 16 KB -> 413; the app's assertion
 * on the body's exact bytes -> 403 `attest_unknown_key` / `attest_invalid` (429 past the per-IP
 * verifications, 503 without the key store); not the schema or an unknown problem id -> 400
 * `invalid_request`; this visitor's `TRY_LIMITS.help` (in memory; for the app also per attested key
 * or debug device) -> 429 `rate_limited`. Then 200 `{ latex, ink, solves }`, `latex` null when the
 * problem is solved already or the engine has no step. The info line says which `path` it took.
 */
export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  const log = tryLogger.child({ requestId, route: "help" });
  const done = (res: Response) => withRequestId(res, requestId);
  try {
    if (!tryEnabled()) return done(tryError(503, "unavailable"));
    const app = appClaimOf(req);
    const path = pathOf(app);
    if (app?.kind === "refused") {
      log.info({ path, reason: app.reason }, "try help refused: the app's headers");
      return done(appRefusal(app.reason));
    }
    if (!app && !isSameOrigin(req)) {
      log.info({ site: req.headers.get("sec-fetch-site"), origin: Boolean(req.headers.get("origin")) }, "try help refused: not from our page");
      return done(tryError(403, "invalid_request"));
    }

    const raw = await readCapped(req, TRY_HELP_MAX_BYTES, "bytes");
    if (raw === null) return done(tryError(413, "invalid_request"));
    const ip = visitorIp(req);
    const pass = app ? await verifyAppClaim(app, raw, ip) : null;
    if (pass && !pass.ok) return done(pass.response);
    const parsed = TryHelpRequestSchema.safeParse(parseJson(raw.toString("utf8")));
    if (!parsed.success) return done(tryError(400, "invalid_request"));
    const problem = tryProblem(parsed.data.problemId);
    if (!problem) return done(tryError(400, "invalid_request"));

    const mine = checkRateLimit(`ip:${ip}:tryHelp`, TRY_LIMITS.help);
    if (!mine.ok) return done(tryError(429, "rate_limited", mine.retryAfterMs));
    if (pass) {
      const device = checkRateLimit(`${pass.who}:tryHelp`, TRY_LIMITS.help);
      if (!device.ok) return done(tryError(429, "rate_limited", device.retryAfterMs));
    }

    const engine = await getEngine();
    const step = nextTryStep(engine, problem, parsed.data.work);
    const ink = step.latex ? tryInk(problem, step.latex) : null;
    const body = TryHelpResponseSchema.parse({ latex: step.latex, ink, solves: step.latex ? step.solves : false });
    log.info({ path, band: problem.band, problem: problem.id, lines: parsed.data.work.length, step: Boolean(step.latex), ink: Boolean(ink), solves: body.solves, ms: Date.now() - startedAt }, "try help");
    return done(Response.json(body, { headers: { "Cache-Control": "no-store" } }));
  } catch (err) {
    return done(errorResponse(err, log, { ms: Date.now() - startedAt }));
  }
}
