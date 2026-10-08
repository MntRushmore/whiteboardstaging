import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getServerEnv } from "@/lib/env";
import { recordEvent } from "@/lib/server/events";

export type ApiErrorCode =
  | "unauthorized"
  | "invalid_request"
  | "rate_limited"
  | "ink_empty"
  | "upstream_error"
  | "feature_unavailable"
  // a row that does not exist (the admin console's users, boards, bug reports)
  | "not_found"
  | "internal_error"
  | "recognizer_failed";

/**
 * Build a JSON error response following the shared API contract:
 * `{ error: <machine code>, message: <human text>, ...extra }`.
 */
export function json(
  status: number,
  error: ApiErrorCode,
  message: string,
  extra?: Record<string, unknown>,
  headers?: HeadersInit,
): Response {
  return Response.json({ error, message, ...(extra ?? {}) }, { status, headers });
}

export type AuthedUser = { id: string; email: string | null };

let verifier: SupabaseClient | null = null;

function getVerifier(): SupabaseClient {
  if (verifier) return verifier;
  const env = getServerEnv();
  verifier = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return verifier;
}

function extractBearerToken(req: Request): string | null {
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;
  const token = match[1].trim();
  // A JWT is three base64url segments; reject obvious garbage before hitting the network.
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return null;
  return token;
}

const UNAUTHORIZED = () =>
  json(401, "unauthorized", "You need to be signed in to use this feature.", undefined, {
    "WWW-Authenticate": "Bearer",
  });

/**
 * Supabase Auth itself failing to answer (unreachable, a 5xx, a timeout) — not a token it refused.
 * The student is told "Please sign in again" either way (a 401, as before), and signing in again
 * cannot help while Auth is down: an app event (`auth`, code `unavailable`), so the admin page sees
 * an outage instead of a crowd of students who all seem signed out. Never for a token that is simply
 * expired or invalid (Auth's own 4xx): that is a normal 401.
 */
function authUnavailable(req: Request, error: unknown, thrown: boolean): boolean {
  const e = (error ?? {}) as { status?: unknown; name?: unknown; message?: unknown };
  const status = typeof e.status === "number" ? e.status : undefined;
  const name = typeof e.name === "string" ? e.name : "";
  // supabase-js: `AuthRetryableFetchError` (status 0, or a 5xx) when Auth could not be reached or failed
  const down = thrown || status === 0 || (status !== undefined && status >= 500) || /Retryable|Fetch/i.test(name);
  if (!down) return false;
  let route: string | undefined;
  try {
    route = new URL(req.url).pathname.slice(0, 200);
  } catch {
    route = undefined;
  }
  recordEvent({
    source: "server",
    level: "error",
    kind: "auth",
    code: "unavailable",
    message: "Supabase Auth did not verify a token: the student was told to sign in again",
    route,
    meta: { ...(status !== undefined ? { status } : {}), ...(name ? { error: name.slice(0, 60) } : {}), detail: String(e.message ?? "").slice(0, 160) },
  });
  return true;
}

/**
 * Require a signed-in Supabase user. Reads `Authorization: Bearer <access token>`
 * and verifies it against Supabase Auth (`auth.getUser(token)`).
 *
 * Returns `{ user, token }` on success (`token` is the verified access token, so
 * callers can act AS the user against Supabase, e.g. `consumeInk`) or
 * `{ response }` (a ready-to-return 401 JSON response) on any failure.
 */
export async function requireUser(
  req: Request,
): Promise<{ user: AuthedUser; token: string } | { response: Response }> {
  const token = extractBearerToken(req);
  if (!token) return { response: UNAUTHORIZED() };

  let client: SupabaseClient;
  try {
    client = getVerifier();
  } catch (err) {
    // Misconfigured server: surface as 500 rather than pretending the token is bad.
    return {
      response: json(
        500,
        "internal_error",
        err instanceof Error ? err.message : "Server is not configured for authentication.",
      ),
    };
  }

  try {
    const { data, error } = await client.auth.getUser(token);
    if (error) authUnavailable(req, error, false);
    if (error || !data?.user) return { response: UNAUTHORIZED() };
    return { user: { id: data.user.id, email: data.user.email ?? null }, token };
  } catch (err) {
    authUnavailable(req, err, true);
    return { response: UNAUTHORIZED() };
  }
}

/** How long `identifyUser` waits for Supabase Auth before answering "nobody". */
const IDENTIFY_TIMEOUT_MS = 3_000;

/**
 * The signed-in user's id when the request carries a valid access token, else null — never a 401.
 * For public routes that only want to say who it was (POST /api/client-errors logs it); a route
 * that needs a user calls `requireUser`. Gives up after IDENTIFY_TIMEOUT_MS, so a slow Auth never
 * holds the caller.
 */
export async function identifyUser(req: Request): Promise<string | null> {
  const token = extractBearerToken(req);
  if (!token) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const verified = getVerifier()
      .auth.getUser(token)
      .then(({ data, error }) => (error ? null : (data?.user?.id ?? null)));
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), IDENTIFY_TIMEOUT_MS);
    });
    return await Promise.race([verified, timeout]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
