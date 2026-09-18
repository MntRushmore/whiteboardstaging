/**
 * Provision two throwaway users against a Supabase project and hand back the
 * CheckContext consumed by scripts/lib/rlsChecks.mjs, plus a cleanup function.
 * Shared by scripts/verify-rls.mjs and src/__tests__/db-rls.integration.test.ts.
 */
import { adminDeleteUser, createSupabaseHttp, provisionUser } from "./supabaseHttp.mjs";

/**
 * @param {{ url: string, anonKey: string, serviceKey?: string | null, emailDomain?: string, fetchImpl?: typeof fetch }} cfg
 * @returns {Promise<{
 *   ctx: import("./rlsChecks.mjs").CheckContext,
 *   users: Array<{ email: string, userId: string }>,
 *   cleanup: () => Promise<string[]>,
 * }>}
 */
export async function bootstrapVerifyContext(cfg) {
  const url = cfg.url.replace(/\/$/, "");
  const domain = cfg.emailDomain || "example.com";
  const tag = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const password = `Verify-${globalThis.crypto.randomUUID()}`;

  const sessions = [];
  for (const who of ["a", "b"]) {
    sessions.push(
      await provisionUser({
        url,
        anonKey: cfg.anonKey,
        serviceKey: cfg.serviceKey ?? null,
        email: `rls-verify-${tag}-${who}@${domain}`,
        password,
        fetchImpl: cfg.fetchImpl,
      }),
    );
  }
  const [a, b] = sessions;

  const mk = (/** @type {typeof a | null} */ s) =>
    createSupabaseHttp({
      url,
      anonKey: cfg.anonKey,
      accessToken: s?.accessToken ?? null,
      userId: s?.userId ?? null,
      fetchImpl: cfg.fetchImpl,
    });
  const anon = mk(null);
  const clientA = mk(a);
  const clientB = mk(b);
  // Service-role client for checks that must plant rows a user cannot (e.g. an old
  // usage_events row for the refund window). Absent without SUPABASE_SERVICE_ROLE_KEY,
  // in which case those checks report themselves as skipped.
  const service = cfg.serviceKey
    ? createSupabaseHttp({ url, anonKey: cfg.anonKey, accessToken: cfg.serviceKey, userId: null, fetchImpl: cfg.fetchImpl })
    : undefined;

  /**
   * Extra throwaway users created on demand by checks that destroy the account
   * they run as (delete_own_account). Tracked so cleanup can remove leftovers
   * when such a check fails half-way.
   * @type {Array<{ session: typeof a, client: ReturnType<typeof mk> }>}
   */
  const extras = [];
  async function newUser() {
    const session = await provisionUser({
      url,
      anonKey: cfg.anonKey,
      serviceKey: cfg.serviceKey ?? null,
      email: `rls-verify-${tag}-c${extras.length + 1}@${domain}`,
      password,
      fetchImpl: cfg.fetchImpl,
    });
    const client = mk(session);
    extras.push({ session, client });
    return client;
  }

  /** Remove everything the checks may have left behind. Returns human-readable notes. */
  async function cleanup() {
    /** @type {string[]} */
    const notes = [];
    const extraClients = extras.map((e) => e.client);
    for (const c of [clientA, clientB, ...extraClients]) {
      // Owners may delete their own boards (cascades snapshots + board_assets rows).
      await c.rest("DELETE", "whiteboards", { query: { user_id: `eq.${c.userId}` } });
      for (const key of c.uploaded) {
        const slash = key.indexOf("/");
        await c.storageDelete(key.slice(0, slash), key.slice(slash + 1));
      }
    }
    if (cfg.serviceKey) {
      const service = createSupabaseHttp({
        url,
        anonKey: cfg.anonKey,
        accessToken: cfg.serviceKey,
        userId: null,
        fetchImpl: cfg.fetchImpl,
      });
      const allSessions = [a, b, ...extras.map((e) => e.session)];
      const ids = `(${allSessions.map((s) => s.userId).join(",")})`;
      // bug_reports.user_id is ON DELETE SET NULL, so remove them before the users.
      await service.rest("DELETE", "bug_reports", { query: { user_id: `in.${ids}` } });
      for (const c of [clientA, clientB, ...extraClients]) {
        for (const key of c.uploaded) {
          const slash = key.indexOf("/");
          await service.storageDelete(key.slice(0, slash), key.slice(slash + 1));
        }
      }
      for (const s of allSessions) {
        const res = await adminDeleteUser(url, cfg.serviceKey, s.userId, cfg.fetchImpl);
        // 404: the user already deleted itself (delete_own_account check) - not a problem.
        if (res.status >= 300 && res.status !== 404) notes.push(`could not delete user ${s.email}: ${res.status}`);
      }
      if (!notes.length) notes.push(`deleted throwaway users ${allSessions.map((s) => s.email).join(", ")}`);
    } else {
      notes.push(
        `throwaway users ${a.email} and ${b.email} (and their profiles/usage_events/user_settings/bug_reports rows) were left in place; ` +
          "set SUPABASE_SERVICE_ROLE_KEY to have them removed automatically.",
      );
    }
    return notes;
  }

  return {
    ctx: { anon, a: clientA, b: clientB, newUser, ...(service ? { service } : {}) },
    users: [
      { email: a.email, userId: a.userId },
      { email: b.email, userId: b.userId },
    ],
    cleanup,
  };
}
