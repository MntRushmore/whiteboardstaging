/**
 * Admin routes' guard: the caller must be signed in and in `public.admins`
 * (supabase/migrations/20261005000000_admin.sql). Exports are frozen by the contract
 * (src/lib/admin/contracts.ts).
 *
 * The token is verified like every other route's (`requireUser`); then the user id is looked up in
 * `admins` with the service role, never with the caller's token: the table has no policy, and the
 * page's `is_admin()` is only for showing the link. The answer is kept per user for ADMIN_CACHE_MS,
 * both ways, so the page's polling costs one lookup a minute; adding or removing an admin
 * (`node scripts/make-admin.mjs`) takes effect within that time on each server instance.
 *
 * Answers: 401 signed out (the shared contract's body), 404 with no body for a signed-in user who is
 * not an admin (the route does not exist for them), and 503 when the lookup itself failed (no
 * service role, or the database did not answer): an admin must be able to tell "the database is
 * down" from "you are not an admin", and a failed lookup is never cached.
 */
import { getServerEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { json, requireUser, type AuthedUser } from "@/lib/server/auth";

const log = logger.child({ module: "admin" });

/** How long one lookup's answer is kept for that user. */
const ADMIN_CACHE_MS = 60_000;
/** Users remembered at most (cleared when full: a handful of admins and the odd curious student). */
const ADMIN_CACHE_MAX = 1_000;
/** The lookup gives up after this long (503). */
const LOOKUP_TIMEOUT_MS = 5_000;

const cache = new Map<string, { admin: boolean; until: number }>();

const notFound = () => new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });

/** Is `userId` in `admins`? Null when it could not be checked. */
async function lookUp(userId: string): Promise<boolean | null> {
  let url: string;
  let serviceKey: string | undefined;
  try {
    const env = getServerEnv();
    url = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/+$/, "");
    serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  } catch {
    return null;
  }
  if (!serviceKey) {
    log.error("admin lookup impossible: SUPABASE_SERVICE_ROLE_KEY is not set");
    return null;
  }
  try {
    const res = await fetch(`${url}/rest/v1/admins?select=user_id&user_id=eq.${encodeURIComponent(userId)}`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok || !Array.isArray(body)) {
      log.error({ status: res.status }, "admin lookup failed");
      return null;
    }
    return body.length > 0;
  } catch (err) {
    log.error({ error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) }, "admin lookup failed");
    return null;
  }
}

/** The signed-in admin, or the response to send (401 signed out, 404 not an admin: the route does not exist for them). */
export async function requireAdmin(req: Request): Promise<{ user: AuthedUser } | { response: Response }> {
  const auth = await requireUser(req);
  if ("response" in auth) return { response: auth.response };
  const { user } = auth;

  const now = Date.now();
  const cached = cache.get(user.id);
  let admin = cached && cached.until > now ? cached.admin : undefined;
  if (admin === undefined) {
    const found = await lookUp(user.id);
    if (found === null) {
      return { response: json(503, "feature_unavailable", "Admin access could not be checked right now. Try again in a minute.") };
    }
    admin = found;
    if (cache.size >= ADMIN_CACHE_MAX) cache.clear();
    cache.set(user.id, { admin, until: now + ADMIN_CACHE_MS });
  }

  if (!admin) {
    log.warn({ userId: user.id, path: new URL(req.url).pathname }, "admin route refused: not an admin");
    return { response: notFound() };
  }
  return { user };
}
