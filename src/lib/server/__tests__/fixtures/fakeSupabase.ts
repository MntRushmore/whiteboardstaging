/**
 * Just enough of PostgREST and Supabase Auth's admin API for the admin overview's and console's
 * tests: the filters they send (eq, neq, gt, gte, lt, in, is.null, not.is.null; a key repeated is
 * two filters), order (one or more columns), limit, offset, select with `alias:col` and
 * `alias:col->>key`, HEAD with `Prefer: count=exact`, `Accept: application/vnd.pgrst.object+json`
 * (one row, else 406 PGRST116), writes (POST insert, POST upsert with `on_conflict`, PATCH), views
 * and functions computed from the tables (`views`, `rpc`), a 1,000-row page cap, a missing table's
 * PGRST205 (a missing function's PGRST202), /auth/v1/admin/users/<id> and the paged
 * /auth/v1/admin/users list. Every request is recorded.
 */
export type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

/** An account for the auth admin API: its email, or the email with its times. */
export type FakeUser = string | { email: string | null; created_at?: string; last_sign_in_at?: string | null };

export interface FakeOptions {
  serviceKey?: string;
  /** user id -> account for the auth admin API (others answer 404) */
  users?: Record<string, FakeUser>;
  /** table -> HTTP status to fail with (reads and writes) */
  fail?: Record<string, number>;
  /** PostgREST's max-rows */
  maxRows?: number;
  /** view name -> its rows, computed from the tables at each read */
  views?: Record<string, (tables: Tables) => Row[]>;
  /** function name -> its rows, from its arguments (query parameters that are not filters) */
  rpc?: Record<string, { args: string[]; run: (args: Record<string, string>, tables: Tables) => Row[] }>;
  /** table -> a BEFORE UPDATE trigger: the row as it will be stored */
  onUpdate?: Record<string, (before: Row, after: Row) => Row>;
  /** the auth admin API's list answers this status */
  authListStatus?: number;
  /** the auth admin API's list pages by at most this many, whatever is asked */
  authPageCap?: number;
}

export interface FakeSupabase {
  fetch: typeof fetch;
  calls: { method: string; path: string; table: string; params: URLSearchParams; body: unknown; headers: Headers }[];
  tables: Tables;
}

function compare(a: unknown, b: string): number {
  const ta = typeof a === "string" ? Date.parse(a) : NaN;
  const tb = Date.parse(b);
  if (Number.isFinite(ta) && Number.isFinite(tb) && /\d{4}-\d{2}-\d{2}T/.test(b)) return ta - tb;
  if (typeof a === "number") return a - Number(b);
  return String(a).localeCompare(b);
}

function matches(value: unknown, filter: string): boolean {
  const dot = filter.indexOf(".");
  const op = filter.slice(0, dot);
  const arg = filter.slice(dot + 1);
  switch (op) {
    case "eq":
      return value !== null && value !== undefined && String(value) === arg;
    case "neq":
      return value === null || value === undefined || String(value) !== arg;
    case "gt":
      return value !== null && value !== undefined && compare(value, arg) > 0;
    case "gte":
      return value !== null && value !== undefined && compare(value, arg) >= 0;
    case "lt":
      return value !== null && value !== undefined && compare(value, arg) < 0;
    case "in":
      return arg.replace(/^\(|\)$/g, "").split(",").includes(String(value));
    case "is":
      if (arg === "null") return value === null || value === undefined;
      throw new Error(`fake PostgREST: unsupported filter ${filter}`);
    case "not":
      // only `not.is.null` (PostgREST's "has a value")
      if (arg === "is.null") return value !== null && value !== undefined;
      throw new Error(`fake PostgREST: unsupported filter ${filter}`);
    default:
      throw new Error(`fake PostgREST: unsupported filter ${filter}`);
  }
}

function pick(row: Row, select: string | null): Row {
  if (!select || select === "*") return { ...row };
  const out: Row = {};
  for (const part of select.split(",")) {
    const [alias, expr] = part.includes(":") ? part.split(":") : [null, part];
    const json = /^(\w+)->>(\w+)$/.exec(expr);
    if (json) {
      const obj = row[json[1]] as Record<string, unknown> | null | undefined;
      const v = obj?.[json[2]];
      out[alias ?? json[2]] = v === undefined || v === null ? null : String(v);
    } else {
      out[alias ?? expr] = row[expr] ?? null;
    }
  }
  return out;
}

function sortRows(rows: Row[], order: string): void {
  const keys = order.split(",").map((o) => {
    const [col, dir] = o.split(".");
    return { col, desc: dir === "desc" };
  });
  rows.sort((a, b) => {
    for (const { col, desc } of keys) {
      const av = a[col];
      const bv = b[col];
      if (av === bv) continue;
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      const c = compare(av, String(bv));
      if (c !== 0) return desc ? -c : c;
    }
    return 0;
  });
}

const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict"]);

export function fakeSupabase(tables: Tables, opts: FakeOptions = {}): FakeSupabase {
  const key = opts.serviceKey ?? "service-key";
  const maxRows = opts.maxRows ?? 1000;
  const calls: FakeSupabase["calls"] = [];
  let nextId = 1_000_000;

  const account = (id: string) => {
    const u = opts.users?.[id];
    if (u === undefined) return null;
    const o = typeof u === "string" ? { email: u } : u;
    return { id, email: o.email, aud: "authenticated", created_at: ("created_at" in o && o.created_at) || "2026-09-01T00:00:00.000Z", last_sign_in_at: ("last_sign_in_at" in o && o.last_sign_in_at) || null };
  };

  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const table = url.pathname.replace(/^\/rest\/v1\//, "");
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : null;
    calls.push({ method, path: url.pathname + url.search, table, params: url.searchParams, body, headers });
    if (headers.get("authorization") !== `Bearer ${key}` || headers.get("apikey") !== key) {
      return Response.json({ message: "Invalid API key" }, { status: 401 });
    }

    if (url.pathname === "/auth/v1/admin/users") {
      if (opts.authListStatus) return Response.json({ msg: "auth fell over" }, { status: opts.authListStatus });
      const page = Number(url.searchParams.get("page") ?? 1);
      const perPage = Math.min(Number(url.searchParams.get("per_page") ?? 50), opts.authPageCap ?? Infinity);
      const all = Object.keys(opts.users ?? {}).map(account);
      return Response.json({ users: all.slice((page - 1) * perPage, page * perPage), aud: "authenticated" }, { headers: { "x-total-count": String(all.length) } });
    }
    if (url.pathname.startsWith("/auth/v1/admin/users/")) {
      const id = decodeURIComponent(url.pathname.split("/").pop() ?? "");
      const user = account(id);
      return user === null ? Response.json({ code: 404, msg: "User not found" }, { status: 404 }) : Response.json(user);
    }
    if (!url.pathname.startsWith("/rest/v1/")) return new Response(null, { status: 404 });

    const failStatus = opts.fail?.[table];
    if (failStatus) return Response.json({ code: "XX000", message: "the fake database fell over" }, { status: failStatus });

    // ---------------------------------------------------------------- writes
    if (method === "POST" && !table.startsWith("rpc/")) {
      if (!(table in tables)) return Response.json({ code: "PGRST205", message: `Could not find the table 'public.${table}' in the schema cache` }, { status: 404 });
      const incoming = (Array.isArray(body) ? body : [body]) as Row[];
      const conflict = url.searchParams.get("on_conflict");
      const merge = (headers.get("prefer") ?? "").includes("merge-duplicates");
      const stored: Row[] = [];
      for (const raw of incoming) {
        const existing = conflict ? tables[table].find((r) => r[conflict] === raw[conflict]) : undefined;
        if (existing && merge) {
          Object.assign(existing, raw);
          stored.push(existing);
        } else if (existing) {
          return Response.json({ code: "23505", message: "duplicate key value" }, { status: 409 });
        } else {
          const row = { id: nextId++, at: new Date().toISOString(), ...raw };
          tables[table].push(row);
          stored.push(row);
        }
      }
      if ((headers.get("prefer") ?? "").includes("return=representation")) return Response.json(stored.map((r) => pick(r, url.searchParams.get("select"))), { status: 201 });
      return new Response(null, { status: 201 });
    }

    // ---------------------------------------------------------------- reads (and PATCH's match)
    let source: Row[];
    let args: Record<string, string> = {};
    if (table.startsWith("rpc/")) {
      const fn = opts.rpc?.[table.slice(4)];
      if (!fn) return Response.json({ code: "PGRST202", message: `Could not find the function public.${table.slice(4)}` }, { status: 404 });
      args = Object.fromEntries(fn.args.filter((a) => url.searchParams.has(a)).map((a) => [a, url.searchParams.get(a)!]));
      source = fn.run(args, tables);
    } else if (opts.views?.[table]) {
      source = opts.views[table](tables);
    } else if (table in tables) {
      source = method === "PATCH" ? tables[table] : [...tables[table]];
    } else {
      return method === "HEAD"
        ? new Response(null, { status: 404 })
        : Response.json({ code: "PGRST205", message: `Could not find the table 'public.${table}' in the schema cache` }, { status: 404 });
    }

    let rows = [...source];
    for (const [k, v] of url.searchParams) {
      if (RESERVED.has(k) || k in args) continue;
      rows = rows.filter((r) => matches(r[k], v));
    }

    if (method === "PATCH") {
      const patch = (body ?? {}) as Row;
      const changed = rows.map((r) => {
        const after = { ...r, ...patch };
        const stored = opts.onUpdate?.[table] ? opts.onUpdate[table](r, after) : after;
        Object.assign(r, stored);
        return r;
      });
      return Response.json(changed.map((r) => pick(r, url.searchParams.get("select"))));
    }

    const order = url.searchParams.get("order");
    if (order) sortRows(rows, order);
    const total = rows.length;
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? maxRows), maxRows);
    const page = rows.slice(offset, offset + limit).map((r) => pick(r, url.searchParams.get("select")));

    if ((headers.get("accept") ?? "").includes("application/vnd.pgrst.object+json")) {
      if (page.length !== 1) return Response.json({ code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: `The result contains ${page.length} rows` }, { status: 406 });
      return Response.json(page[0]);
    }

    const counted = (headers.get("prefer") ?? "").includes("count=exact");
    const range = page.length ? `${offset}-${offset + page.length - 1}/${counted ? total : "*"}` : `*/${counted ? total : "*"}`;
    if (method === "HEAD") return new Response(null, { status: 200, headers: { "content-range": range } });
    return Response.json(page, { headers: { "content-range": range } });
  };

  return { fetch: impl as typeof fetch, calls, tables };
}
