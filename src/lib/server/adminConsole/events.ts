/**
 * app_events as the console shows them (`AdminEvent`), and the error counts it puts beside users
 * and boards (errors in the last 7 days, noise left out).
 */
import { EVENT_LEVELS, EVENT_SOURCES, type AdminEvent, type EventLevel, type EventSource } from "@/lib/admin/contracts";
import { eventIsNoise } from "./noise";
import type { Query, Rest } from "./rest";

export const DAY_MS = 24 * 3_600_000;

/** Every column an AdminEvent needs. */
export const EVENT_SELECT = "id,at,source,level,kind,code,message,route,user_id,board_id,request_id,meta,release";

export interface EventRow {
  id: number;
  at: string;
  source: string;
  level: string;
  kind: string;
  code: string | null;
  message: string | null;
  route: string | null;
  user_id: string | null;
  board_id: string | null;
  request_id: string | null;
  meta: Record<string, unknown> | null;
  release: string | null;
}

const asSource = (s: string): EventSource => ((EVENT_SOURCES as readonly string[]).includes(s) ? (s as EventSource) : "server");
const asLevel = (l: string): EventLevel => ((EVENT_LEVELS as readonly string[]).includes(l) ? (l as EventLevel) : "error");

export function toAdminEvent(row: EventRow, emails: ReadonlyMap<string, string | null>): AdminEvent {
  const meta = row.meta && typeof row.meta === "object" && !Array.isArray(row.meta) ? row.meta : null;
  return {
    id: Number(row.id),
    at: row.at,
    source: asSource(row.source),
    level: asLevel(row.level),
    kind: row.kind,
    code: row.code ?? null,
    message: row.message ?? "",
    route: row.route ?? null,
    userId: row.user_id ?? null,
    userEmail: row.user_id ? (emails.get(row.user_id) ?? null) : null,
    boardId: row.board_id ?? null,
    requestId: row.request_id ?? null,
    meta,
    release: row.release ?? null,
    noise: eventIsNoise({ source: row.source, message: row.message, meta }),
  };
}

/** The latest `limit` events matching `filter`, newest first. */
export async function latestEvents(rest: Rest, filter: Record<string, string>, limit: number): Promise<EventRow[]> {
  return rest.rows<EventRow>({ table: "app_events", params: { select: EVENT_SELECT, ...filter, order: "at.desc,id.desc", limit: String(limit) } });
}

type ErrorRow = { user_id: string | null; board_id: string | null; source: string; message: string | null; stack: string | null };

/**
 * Errors (level error, health checks aside) since `sinceIso` per user or per board, noise left out.
 * `filter` narrows the read (`user_id=in.(…)`, `board_id=eq.…`). Past ROW_CAP rows the counts are a
 * floor; `truncated` says so.
 */
export async function errorCounts(rest: Rest, by: "user_id" | "board_id", sinceIso: string, filter: Record<string, string> = {}): Promise<{ counts: Map<string, number>; truncated: boolean }> {
  const q: Query = {
    table: "app_events",
    params: {
      select: "user_id,board_id,source,message,stack:meta->>stack",
      level: "eq.error",
      source: "neq.health",
      at: `gte.${sinceIso}`,
      [by]: "not.is.null",
      ...filter,
      order: "at.desc",
    },
  };
  const { rows, truncated } = await rest.paged<ErrorRow>(q);
  const counts = new Map<string, number>();
  for (const r of rows) {
    const key = r[by];
    if (!key || eventIsNoise(r)) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return { counts, truncated };
}

/** `in.(a,b,c)` for PostgREST, ids deduplicated. */
export function inList(ids: Iterable<string>): string {
  return `in.(${[...new Set(ids)].join(",")})`;
}
