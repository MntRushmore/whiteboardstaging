import { json, requireUser } from "@/lib/server/auth";
import { checkRateLimitDistributed, rateLimitedResponse } from "@/lib/server/rate-limit";
import { emailLogger } from "@/lib/email/resend";
import { emailDeps, type EmailEnv } from "@/lib/email/server";
import { runWelcome, type WelcomeOutcome } from "@/lib/email/welcome";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** One profile read, one log insert, one Resend call (10 s timeout), one log update. */
export const maxDuration = 20;

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * POST /api/email/welcome — send this account's welcome email, once (src/lib/email/welcome.ts).
 *
 * No body: the handler never reads one (NO_BODY_ROUTES in scripts/lib/routes.mjs). Everything the
 * email depends on comes from the server: the recipient is the verified account's own address
 * (`requireUser` -> Supabase Auth), onboarding is read from the caller's profile, and email_log
 * keeps it to one per account. The app calls it at the end of the guided first board, after
 * save_onboarding (src/lib/email/client.ts, `sendWelcomeEmail`).
 *
 * requireUser -> the `emailWelcome` budget -> 503 feature_unavailable without RESEND_API_KEY or the
 * service role (the email log needs it) -> 200 with what happened:
 *   { status: "sent" } | { status: "already_sent" }
 *   { status: "skipped", reason: "no_email" | "kid_profile" | "not_onboarded" | "not_new" }
 * A kid profile (its address on the kid domain, src/lib/family/contracts.ts) is always skipped:
 * nothing ever emails one (and sendEmail itself refuses the address).
 * 502 upstream_error when Resend refused or could not be reached (the claim is released, so the
 * next call retries); 500 internal_error when the profile or the log could not be read.
 */
export async function POST(req: Request) {
  const requestId = crypto.randomUUID();

  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;
  const { user, token } = auth;
  const log = emailLogger.child({ requestId, route: "email/welcome", userId: user.id });

  const rl = await checkRateLimitDistributed({ token, userId: user.id, bucket: "emailWelcome" });
  if (!rl.ok) return rateLimitedResponse(rl.retryAfterMs, rl.backend);

  let env: EmailEnv;
  try {
    env = emailDeps.getEnv();
  } catch (err) {
    log.error({ error: err instanceof Error ? err.message : String(err) }, "server env invalid");
    return json(500, "internal_error", "Server is not configured.");
  }
  if (!env.resend.apiKey) {
    log.info("welcome email skipped: RESEND_API_KEY is not set");
    return json(503, "feature_unavailable", "Email is not set up on this deployment (RESEND_API_KEY).", undefined, NO_STORE);
  }
  if (!env.hasServiceRole) {
    log.warn("welcome email skipped: SUPABASE_SERVICE_ROLE_KEY is not set (the email log needs it)");
    return json(503, "feature_unavailable", "Email is not set up on this deployment (SUPABASE_SERVICE_ROLE_KEY).", undefined, NO_STORE);
  }

  let outcome: WelcomeOutcome;
  try {
    outcome = await runWelcome(emailDeps, env, { id: user.id, email: user.email, token }, log);
  } catch (err) {
    log.error({ error: err instanceof Error ? err.message : String(err) }, "welcome email failed");
    return json(500, "internal_error", "Something went wrong on our side.", undefined, NO_STORE);
  }
  switch (outcome.status) {
    case "sent":
    case "already_sent":
      return Response.json({ status: outcome.status }, { headers: NO_STORE });
    case "skipped":
      return Response.json({ status: "skipped", reason: outcome.reason }, { headers: NO_STORE });
    case "failed":
      return json(502, "upstream_error", "The email could not be sent. Try again later.", undefined, NO_STORE);
    case "error":
      return json(500, "internal_error", "Something went wrong on our side.", undefined, NO_STORE);
  }
}
