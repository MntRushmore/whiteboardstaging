/**
 * Just enough of supabase-js's query builder for the Ask store's tests: `from(table)` with select,
 * upsert, update, delete, eq, in, or, order, limit, abortSignal and maybeSingle, and `rpc(fn, args)`,
 * awaited like the real one. Every request is recorded as a `FakeQuery` (an rpc as table
 * `rpc:<fn>`, its args in `rows`), and `answer` decides what it gets back (rows, an error, or a
 * thrown Error).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface FakeQuery {
  table: string;
  op: "select" | "upsert" | "update" | "delete" | "rpc";
  select?: string;
  filters: Array<[column: string, op: "eq" | "in" | "or", value: unknown]>;
  order?: { column: string; ascending: boolean };
  limit?: number;
  maybeSingle?: boolean;
  rows?: unknown;
  options?: Record<string, unknown>;
  signal?: boolean;
}

export type FakeAnswer = { data?: unknown; error?: { code?: string; message?: string } | null } | Error;

export interface FakeDb {
  client: SupabaseClient;
  calls: FakeQuery[];
}

/** The value of `column`'s eq filter in `q`, if any. */
export const eqOf = (q: FakeQuery, column: string) => q.filters.find(([c, op]) => c === column && op === "eq")?.[2];

/** The query's `or` filter (PostgREST syntax), if any. */
export const orOf = (q: FakeQuery) => q.filters.find(([, op]) => op === "or")?.[2];

export function fakeDb(answer: (q: FakeQuery) => FakeAnswer | Promise<FakeAnswer>): FakeDb {
  const calls: FakeQuery[] = [];
  const build = (q: FakeQuery) => {
    const builder = {
      select(columns?: string) {
        q.select = columns ?? "*";
        return builder;
      },
      upsert(rows: unknown, options?: Record<string, unknown>) {
        q.op = "upsert";
        q.rows = rows;
        q.options = options;
        return builder;
      },
      update(rows: unknown) {
        q.op = "update";
        q.rows = rows;
        return builder;
      },
      delete() {
        q.op = "delete";
        return builder;
      },
      eq(column: string, value: unknown) {
        q.filters.push([column, "eq", value]);
        return builder;
      },
      in(column: string, values: unknown) {
        q.filters.push([column, "in", values]);
        return builder;
      },
      or(filter: string) {
        q.filters.push(["", "or", filter]);
        return builder;
      },
      order(column: string, opts?: { ascending?: boolean }) {
        q.order = { column, ascending: opts?.ascending ?? true };
        return builder;
      },
      limit(n: number) {
        q.limit = n;
        return builder;
      },
      abortSignal(signal: AbortSignal) {
        q.signal = signal instanceof AbortSignal;
        return builder;
      },
      maybeSingle() {
        q.maybeSingle = true;
        return builder;
      },
      then<A, B>(resolve: (v: { data: unknown; error: unknown }) => A, reject?: (e: unknown) => B) {
        calls.push(q);
        return Promise.resolve()
          .then(() => answer(q))
          .then((r) => {
            if (r instanceof Error) throw r;
            return { data: r.data ?? null, error: r.error ?? null };
          })
          .then(resolve, reject);
      },
    };
    return builder;
  };
  const client = {
    from: (table: string) => build({ table, op: "select", filters: [] }),
    rpc: (fn: string, args?: Record<string, unknown>) => build({ table: `rpc:${fn}`, op: "rpc", filters: [], rows: args ?? {} }),
  };
  return { client: client as unknown as SupabaseClient, calls };
}
