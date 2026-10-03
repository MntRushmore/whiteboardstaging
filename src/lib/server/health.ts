import { getServerEnv } from "@/lib/env";

/** How long GET /api/health waits for the database before calling it down. */
export const DB_PROBE_TIMEOUT_MS = 3_000;

/** The table the probe asks about: the core table, which no migration will ever drop. */
const PROBE_PATH = "/rest/v1/whiteboards?select=id&limit=1";

export type DbProbe = { up: true; ms: number } | { up: false; ms: number; reason: string };

/** A Postgres SQLSTATE (five characters); PostgREST's own codes are PGRSTnnn. */
const SQLSTATE = /^[0-9A-Z]{5}$/;

/**
 * Is the database answering queries? One PostgREST read with the anon key, DB_PROBE_TIMEOUT_MS at
 * most. `anon` has no grants on any table (docs/ARCHITECTURE.md "Data model"), so the expected
 * answer is a 401 carrying Postgres's own `42501 permission denied`: Postgres ran the query and
 * refused it, which proves it is up without reading a row or adding an anon-callable function.
 * A 2xx counts as up too. Anything else is down: a 5xx (PostgREST cannot reach Postgres, a paused
 * free project), another 4xx without a SQLSTATE, a timeout, a network error, or no env.
 */
export async function probeDatabase(fetchImpl: typeof fetch = fetch, timeoutMs = DB_PROBE_TIMEOUT_MS): Promise<DbProbe> {
  const startedAt = Date.now();
  const down = (reason: string): DbProbe => ({ up: false, ms: Date.now() - startedAt, reason });

  let url: string;
  let anonKey: string;
  try {
    const env = getServerEnv();
    url = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/+$/, "");
    anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  } catch {
    return down("server env invalid");
  }

  try {
    const res = await fetchImpl(`${url}${PROBE_PATH}`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    if (res.ok) return { up: true, ms: Date.now() - startedAt };
    const body = (await res.json().catch(() => null)) as { code?: unknown } | null;
    const code = typeof body?.code === "string" ? body.code : "";
    if (res.status < 500 && SQLSTATE.test(code)) return { up: true, ms: Date.now() - startedAt };
    return down(`status ${res.status}${code ? ` ${code}` : ""}`);
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    return down(name === "TimeoutError" || name === "AbortError" ? "timeout" : `network: ${err instanceof Error ? err.message : String(err)}`);
  }
}
