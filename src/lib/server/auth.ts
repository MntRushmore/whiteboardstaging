import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getServerEnv } from "@/lib/env";

export type ApiErrorCode =
  | "unauthorized"
  | "invalid_request"
  | "rate_limited"
  | "credits_exhausted"
  | "upstream_error"
  | "voice_unavailable"
  | "feature_unavailable"
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
 * Require a signed-in Supabase user. Reads `Authorization: Bearer <access token>`
 * and verifies it against Supabase Auth (`auth.getUser(token)`).
 *
 * Returns `{ user, token }` on success (`token` is the verified access token, so
 * callers can act AS the user against Supabase, e.g. `consumeCredits`) or
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
    if (error || !data?.user) return { response: UNAUTHORIZED() };
    return { user: { id: data.user.id, email: data.user.email ?? null }, token };
  } catch {
    return { response: UNAUTHORIZED() };
  }
}
