/**
 * Just enough of PostgREST and Supabase Auth's admin API for the admin overview's tests: the
 * filters it sends (eq, neq, gt, gte, in, not.is.null), order, limit, offset, select with `alias:col->>key`,
 * HEAD with `Prefer: count=exact`, a 1,000-row page cap, a missing table's PGRST205, and
 * /auth/v1/admin/users/<id>. Every request is recorded.
 */
export type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

export interface FakeOptions {
  serviceKey?: string;
  /** user id -> email for the auth admin API (others answer 404) */
  users?: Record<string, string>;
  /** table -> HTTP status to fail with */
  fail?: Record<string, number>;
  /** PostgREST's max-rows */
  maxRows?: number;
}

export interface FakeSupabase {
  fetch: typeof fetch;
  calls: { method: string; path: string; table: string; params: URLSearchParams }[];
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

export function fakeSupabase(tables: Tables, opts: FakeOptions = {}): FakeSupabase {
  const key = opts.serviceKey ?? "service-key";
  const maxRows = opts.maxRows ?? 1000;
  const calls: FakeSupabase["calls"] = [];

  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const table = url.pathname.replace(/^\/rest\/v1\//, "");
    calls.push({ method, path: url.pathname + url.search, table, params: url.searchParams });
    if (headers.get("authorization") !== `Bearer ${key}` || headers.get("apikey") !== key) {
      return Response.json({ message: "Invalid API key" }, { status: 401 });
    }

    if (url.pathname.startsWith("/auth/v1/admin/users/")) {
      const id = decodeURIComponent(url.pathname.split("/").pop() ?? "");
      const email = opts.users?.[id];
      return email === undefined ? Response.json({ code: 404, msg: "User not found" }, { status: 404 }) : Response.json({ id, email, aud: "authenticated" });
    }
    if (!url.pathname.startsWith("/rest/v1/")) return new Response(null, { status: 404 });

    const failStatus = opts.fail?.[table];
    if (failStatus) return Response.json({ code: "XX000", message: "the fake database fell over" }, { status: failStatus });
    if (!(table in tables)) {
      return method === "HEAD"
        ? new Response(null, { status: 404 })
        : Response.json({ code: "PGRST205", message: `Could not find the table 'public.${table}' in the schema cache` }, { status: 404 });
    }

    let rows = [...tables[table]];
    for (const [k, v] of url.searchParams) {
      if (k === "select" || k === "order" || k === "limit" || k === "offset") continue;
      rows = rows.filter((r) => matches(r[k], v));
    }
    const order = url.searchParams.get("order");
    if (order) {
      const [col, dir] = order.split(".");
      rows.sort((a, b) => compare(a[col], String(b[col])) * (dir === "desc" ? -1 : 1));
    }
    const total = rows.length;
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? maxRows), maxRows);
    const page = rows.slice(offset, offset + limit).map((r) => pick(r, url.searchParams.get("select")));

    const counted = (headers.get("prefer") ?? "").includes("count=exact");
    const range = page.length ? `${offset}-${offset + page.length - 1}/${counted ? total : "*"}` : `*/${counted ? total : "*"}`;
    if (method === "HEAD") return new Response(null, { status: 200, headers: { "content-range": range } });
    return Response.json(page, { headers: { "content-range": range } });
  };

  return { fetch: impl as typeof fetch, calls };
}
