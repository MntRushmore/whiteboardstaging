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

  /** Remove everything the checks may have left behind. Returns human-readable notes. */
  async function cleanup() {
    /** @type {string[]} */
    const notes = [];
    for (const c of [clientA, clientB]) {
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
      const ids = `(${a.userId},${b.userId})`;
      // bug_reports.user_id is ON DELETE SET NULL, so remove them before the users.
      await service.rest("DELETE", "bug_reports", { query: { user_id: `in.${ids}` } });
      for (const c of [clientA, clientB]) {
        for (const key of c.uploaded) {
          const slash = key.indexOf("/");
          await service.storageDelete(key.slice(0, slash), key.slice(slash + 1));
        }
      }
      for (const s of [a, b]) {
        const res = await adminDeleteUser(url, cfg.serviceKey, s.userId, cfg.fetchImpl);
        if (res.status >= 300) notes.push(`could not delete user ${s.email}: ${res.status}`);
      }
      if (!notes.length) notes.push(`deleted throwaway users ${a.email}, ${b.email}`);
    } else {
      notes.push(
        `throwaway users ${a.email} and ${b.email} (and their user_settings/bug_reports rows) were left in place; ` +
          "set SUPABASE_SERVICE_ROLE_KEY to have them removed automatically.",
      );
    }
    return notes;
  }

  return {
    ctx: { anon, a: clientA, b: clientB },
    users: [
      { email: a.email, userId: a.userId },
      { email: b.email, userId: b.userId },
    ],
    cleanup,
  };
}
