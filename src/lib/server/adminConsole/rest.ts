/**
 * The admin console's reads and writes (src/lib/admin/contracts.ts, "the admin console"): plain
 * fetches to PostgREST and Supabase Auth's admin API with the service role, like the overview
 * (src/lib/server/adminOverview.ts), so the tests replace one function (`deps.fetch`).
 *
 * Unlike the overview, a missing table, view or function is an error here, named like any other
 * failed read (`ConsoleQueryError`, which the routes answer 502 with): every object the console
 * reads but the auth admin API comes from one migration (20261008000000_admin_console.sql) that
 * must be applied before this code runs.
 *
 * Emails come from the auth admin API: one account at a time (`email`, remembered EMAIL_CACHE_MS),
 * or every account in pages of AUTH_PAGE (`authUsers`, remembered DIRECTORY_CACHE_MS: the users list
 * shows sign-in times, so it is kept short).
 */
import { ADMIN_LIMITS } from "@/lib/admin/contracts";
import { getServerEnv } from "@/lib/env";

/** Rows read per table at most (newest first), like the overview's ROW_CAP. */
export const ROW_CAP = 5_000;
/** PostgREST's page (Supabase's default max-rows). */
export const PAGE_SIZE = 1_000;
/** One request's budget. */
export const QUERY_TIMEOUT_MS = 6_000;
/** One account's email (and sign-in time) is remembered this long. */
export const EMAIL_CACHE_MS = 10 * 60_000;
/** Every account's, this long (the users list). */
export const DIRECTORY_CACHE_MS = 60_000;
/** The auth admin API's page when listing every account. */
export const AUTH_PAGE = 1_000;
/** Pages of the auth list read at most (a server paging by 50 still reaches ADMIN_LIMITS.users). */
export const MAX_AUTH_PAGES = 40;
/** Distinct accounts whose emails one answer looks up one by one at most (more: the whole directory). */
export const MAX_EMAIL_LOOKUPS = 50;

export interface ConsoleDeps {
  /** the Supabase project URL, no trailing slash */
  url: string;
  serviceKey: string;
  fetch?: typeof fetch;
  /** ms since the epoch; Date.now() by default */
  now?: number;
}

/** The env the console needs, or null without the service role key. Throws when the env itself is invalid. */
export function consoleDeps(): ConsoleDeps | null {
  const env = getServerEnv();
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return { url: env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/+$/, ""), serviceKey: env.SUPABASE_SERVICE_ROLE_KEY };
}

/** A read or write that failed; `what` names the table, view or function (or "auth"). The routes answer 502 with its message. */
export class ConsoleQueryError extends Error {
  readonly what: string;
  readonly status: number | null;
  constructor(what: string, status: number | null, detail: string, verb: "read" | "write" = "read") {
    super(`Couldn't ${verb} ${what}: ${detail}`);
    this.name = "ConsoleQueryError";
    this.what = what;
    this.status = status;
  }
}

/** PostgREST's "no such table / function" (schema cache) and Postgres's undefined_table / undefined_function. */
const MISSING_CODES = new Set(["PGRST205", "PGRST202", "42P01", "42883"]);

/** A request: the table (view, `rpc/<function>`) and its query; a list repeats the key (two filters on one column). */
export type Query = { table: string; params: Record<string, string | string[]> };

/** PostgREST's query string: values encoded, but the commas, colons and arrows of its syntax kept readable. */
export function queryString(params: Record<string, string | string[]>): string {
  const pair = (k: string, v: string) => `${encodeURIComponent(k)}=${encodeURIComponent(v).replace(/%2C/g, ",").replace(/%3A/g, ":").replace(/%3E/g, ">")}`;
  return Object.entries(params)
    .flatMap(([k, v]) => (Array.isArray(v) ? v.map((one) => pair(k, one)) : [pair(k, v)]))
    .join("&");
}

/** An account as the auth admin API knows it. */
export interface AuthUser {
  id: string;
  email: string | null;
  createdAt: string | null;
  lastSignInAt: string | null;
}

export interface Rest {
  /** the deps' clock */
  now: number;
  rows<T>(q: Query): Promise<T[]>;
  /** newest-first rows up to `cap`, page by page (sequential: the pages are few) */
  paged<T>(q: Query, cap?: number): Promise<{ rows: T[]; truncated: boolean }>;
  /** the one row, or null (no row) */
  one<T>(q: Query): Promise<T | null>;
  count(q: Query): Promise<number>;
  /** POST rows, nothing back */
  insert(table: string, body: unknown): Promise<void>;
  /** POST with on_conflict and merge-duplicates: the stored row back */
  upsert<T>(table: string, onConflict: string, body: Record<string, unknown>, select: string): Promise<T>;
  /** PATCH what `q` matches: the changed rows back (`select` in q.params) */
  patch<T>(q: Query, body: Record<string, unknown>): Promise<T[]>;
  /** a raw GET for the caller to stream; never throws on a status (the caller reads it), only on the network */
  stream(q: Query, init: { accept: string; signal: AbortSignal }): Promise<Response>;
  /** one account (cached EMAIL_CACHE_MS); null when there is no such account or the API failed */
  authUser(userId: string): Promise<AuthUser | null>;
  /** every account, at most ADMIN_LIMITS.users (cached DIRECTORY_CACHE_MS); throws ConsoleQueryError("auth") */
  authUsers(): Promise<Map<string, AuthUser>>;
  /** emails of these accounts (null: none known); never throws */
  emails(userIds: Iterable<string | null | undefined>): Promise<Map<string, string | null>>;
}

const userCache = new Map<string, { user: AuthUser | null; at: number }>();
let directory: { users: Map<string, AuthUser>; at: number } | null = null;

/** Tests only. */
export function resetConsoleCaches(): void {
  userCache.clear();
  directory = null;
}

function toAuthUser(raw: unknown): AuthUser | null {
  if (!raw || typeof raw !== "object") return null;
  const u = raw as { id?: unknown; email?: unknown; created_at?: unknown; last_sign_in_at?: unknown };
  if (typeof u.id !== "string") return null;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  return { id: u.id, email: str(u.email), createdAt: str(u.created_at), lastSignInAt: str(u.last_sign_in_at) };
}

export function restClient(deps: ConsoleDeps): Rest {
  const f = deps.fetch ?? fetch;
  const headers = { apikey: deps.serviceKey, Authorization: `Bearer ${deps.serviceKey}` };
  const now = deps.now ?? Date.now();

  async function request(q: Query, init: { method?: string; prefer?: string; accept?: string; body?: unknown } = {}): Promise<Response> {
    const qs = queryString(q.params);
    const url = `${deps.url}/rest/v1/${q.table}${qs ? `?${qs}` : ""}`;
    let res: Response;
    try {
      res = await f(url, {
        method: init.method ?? "GET",
        headers: {
          ...headers,
          ...(init.prefer ? { Prefer: init.prefer } : {}),
          ...(init.accept ? { Accept: init.accept } : {}),
          ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      throw new ConsoleQueryError(q.table, null, name === "TimeoutError" || name === "AbortError" ? "no answer in time" : `network: ${err instanceof Error ? err.message : String(err)}`, verbOf(init.method));
    }
    if (res.ok) return res;
    throw await failureOf(q.table, res, init.method === "HEAD", verbOf(init.method));
  }

  async function rows<T>(q: Query): Promise<T[]> {
    const res = await request(q);
    const body: unknown = await res.json().catch(() => null);
    if (!Array.isArray(body)) throw new ConsoleQueryError(q.table, res.status, "the answer was not a list of rows");
    return body as T[];
  }

  /** `Content-Range: 0-999/4210` -> 4210; null when the total is not given ("*"). */
  const totalOf = (res: Response) => {
    const m = /\/(\d+)\s*$/.exec(res.headers.get("content-range") ?? "");
    return m ? Number(m[1]) : null;
  };

  async function fetchUser(userId: string): Promise<AuthUser | null | undefined> {
    try {
      const res = await f(`${deps.url}/auth/v1/admin/users/${encodeURIComponent(userId)}`, { headers, signal: AbortSignal.timeout(QUERY_TIMEOUT_MS), cache: "no-store" });
      // a deleted account answers 404: remembered as none
      if (res.status === 404) return null;
      if (!res.ok) return undefined;
      return toAuthUser(await res.json().catch(() => null));
    } catch {
      return undefined;
    }
  }

  const client: Rest = {
    now,
    rows,
    async paged<T>(q: Query, cap = ROW_CAP) {
      const page = (offset: number) => ({ table: q.table, params: { ...q.params, limit: String(Math.min(PAGE_SIZE, cap - offset)), offset: String(offset) } });
      // The first page also asks how many rows match, so the rest are read in parallel, and only as far as needed.
      const res = await request(page(0), { prefer: "count=exact" });
      const first: unknown = await res.json().catch(() => null);
      if (!Array.isArray(first)) throw new ConsoleQueryError(q.table, res.status, "the answer was not a list of rows");
      if (first.length < Math.min(PAGE_SIZE, cap)) return { rows: first as T[], truncated: false };
      const total = totalOf(res);
      if (total !== null) {
        const offsets: number[] = [];
        for (let o = PAGE_SIZE; o < Math.min(cap, total); o += PAGE_SIZE) offsets.push(o);
        const rest = await Promise.all(offsets.map((o) => rows<T>(page(o))));
        return { rows: [first as T[], ...rest].flat().slice(0, cap), truncated: total > cap };
      }
      // No count in the answer: page by page until a short one, then one row past the cap says whether there is more.
      const all = [...(first as T[])];
      for (let offset = PAGE_SIZE; offset < cap; offset += PAGE_SIZE) {
        const next = await rows<T>(page(offset));
        all.push(...next);
        if (next.length < Math.min(PAGE_SIZE, cap - offset)) return { rows: all, truncated: false };
      }
      const more = await rows<T>({ table: q.table, params: { ...q.params, limit: "1", offset: String(cap) } });
      return { rows: all, truncated: more.length > 0 };
    },
    async one<T>(q: Query) {
      const found = await rows<T>({ table: q.table, params: { ...q.params, limit: "1" } });
      return found[0] ?? null;
    },
    async count(q: Query) {
      const res = await request({ table: q.table, params: { ...q.params, limit: "1" } }, { method: "HEAD", prefer: "count=exact" });
      const total = totalOf(res);
      if (total === null) throw new ConsoleQueryError(q.table, res.status, "no count in the answer");
      return total;
    },
    async insert(table: string, body: unknown) {
      await request({ table, params: {} }, { method: "POST", prefer: "return=minimal", body });
    },
    async upsert<T>(table: string, onConflict: string, body: Record<string, unknown>, select: string) {
      const res = await request({ table, params: { on_conflict: onConflict, select } }, { method: "POST", prefer: "resolution=merge-duplicates,return=representation", body });
      const out: unknown = await res.json().catch(() => null);
      if (!Array.isArray(out) || !out.length) throw new ConsoleQueryError(table, res.status, "the write answered no row", "write");
      return out[0] as T;
    },
    async patch<T>(q: Query, body: Record<string, unknown>) {
      const res = await request(q, { method: "PATCH", prefer: "return=representation", body });
      const out: unknown = await res.json().catch(() => null);
      if (!Array.isArray(out)) throw new ConsoleQueryError(q.table, res.status, "the write answered no rows", "write");
      return out as T[];
    },
    async stream(q: Query, init: { accept: string; signal: AbortSignal }) {
      const qs = queryString(q.params);
      try {
        return await f(`${deps.url}/rest/v1/${q.table}${qs ? `?${qs}` : ""}`, { headers: { ...headers, Accept: init.accept }, signal: init.signal, cache: "no-store" });
      } catch (err) {
        const name = err instanceof Error ? err.name : "";
        throw new ConsoleQueryError(q.table, null, name === "TimeoutError" || name === "AbortError" ? "no answer in time" : `network: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    async authUser(userId: string) {
      const cached = userCache.get(userId);
      const t = Date.now();
      if (cached && t - cached.at < EMAIL_CACHE_MS) return cached.user;
      const user = await fetchUser(userId);
      if (user === undefined) return null;
      userCache.set(userId, { user, at: t });
      return user;
    },
    async authUsers() {
      const t = Date.now();
      if (directory && t - directory.at < DIRECTORY_CACHE_MS) return directory.users;
      const users = new Map<string, AuthUser>();
      for (let page = 1; users.size < ADMIN_LIMITS.users; page++) {
        let res: Response;
        try {
          res = await f(`${deps.url}/auth/v1/admin/users?page=${page}&per_page=${AUTH_PAGE}`, { headers, signal: AbortSignal.timeout(QUERY_TIMEOUT_MS), cache: "no-store" });
        } catch (err) {
          throw new ConsoleQueryError("auth", null, err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError") ? "no answer in time" : `network: ${err instanceof Error ? err.message : String(err)}`);
        }
        if (!res.ok) throw new ConsoleQueryError("auth", res.status, `status ${res.status}`);
        const body = (await res.json().catch(() => null)) as { users?: unknown } | null;
        if (!body || !Array.isArray(body.users)) throw new ConsoleQueryError("auth", res.status, "the answer had no users");
        for (const raw of body.users) {
          const u = toAuthUser(raw);
          if (u && users.size < ADMIN_LIMITS.users) users.set(u.id, u);
        }
        // Done at an empty page, once everyone is read (X-Total-Count; a server that pages smaller than
        // asked is still read to the end), or, with no count, at a short page. At most MAX_AUTH_PAGES.
        const total = Number(res.headers.get("x-total-count"));
        const known = Number.isFinite(total) && total > 0;
        if (!body.users.length || (known ? users.size >= Math.min(total, ADMIN_LIMITS.users) : body.users.length < AUTH_PAGE)) break;
        if (page >= MAX_AUTH_PAGES) break;
      }
      directory = { users, at: t };
      for (const u of users.values()) userCache.set(u.id, { user: u, at: t });
      return users;
    },
    async emails(userIds: Iterable<string | null | undefined>) {
      const ids = [...new Set([...userIds].filter((id): id is string => typeof id === "string" && id.length > 0))];
      const out = new Map<string, string | null>();
      if (!ids.length) return out;
      if (ids.length > MAX_EMAIL_LOOKUPS) {
        try {
          const all = await client.authUsers();
          for (const id of ids) out.set(id, all.get(id)?.email ?? null);
          return out;
        } catch {
          for (const id of ids) out.set(id, null);
          return out;
        }
      }
      const found = await Promise.all(ids.map(async (id) => [id, (await client.authUser(id))?.email ?? null] as const));
      for (const [id, email] of found) out.set(id, email);
      return out;
    },
  };
  return client;
}

/** A write (POST, PATCH, DELETE) or a read. */
const verbOf = (method: string | undefined): "read" | "write" => (!method || method === "GET" || method === "HEAD" ? "read" : "write");

/** The error for a PostgREST answer that is not ok (`head`: a HEAD request, which has no body). */
export async function failureOf(table: string, res: Response, head = false, verb: "read" | "write" = "read"): Promise<ConsoleQueryError> {
  const body = head ? null : ((await res.json().catch(() => null)) as { code?: unknown; message?: unknown } | null);
  const code = typeof body?.code === "string" ? body.code : "";
  if (MISSING_CODES.has(code) || (head && res.status === 404)) {
    return new ConsoleQueryError(table, res.status, "it does not exist (is migration 20261008000000_admin_console.sql applied?)", verb);
  }
  const message = typeof body?.message === "string" ? body.message : "";
  return new ConsoleQueryError(table, res.status, `status ${res.status}${code ? ` ${code}` : ""}${message ? `: ${message.slice(0, 200)}` : ""}`, verb);
}
