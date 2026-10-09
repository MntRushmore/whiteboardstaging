/**
 * Boards for the console: the list (`AdminBoardList`: every board, one user's, or the ones saved in
 * the last few minutes, newest first, a page at a time) and one board for the viewer and the replay
 * (`AdminBoardDoc`).
 *
 * Rows come from the admin_board_rows view (whiteboards without `data`, plus the stored size of
 * `data` and the board's learning attempts; 20261008000000_admin_console.sql), so a page of 48 never
 * reads a snapshot. The owner's name comes from profiles, the email from the auth admin API, the
 * errors of the last 7 days (noise left out) from app_events.
 *
 * The document. `whiteboards.data` can be 8 MB of JSON. It is never parsed here: PostgREST answers
 * the one column as an object (`{"snapshot": …}`), and the answer is the console's own fields
 * followed by those bytes, streamed as they arrive (`openBoardDoc`). The board row is read first and
 * the data second, so the snapshot is never older than `board.version`: a save in between means the
 * next follow-live poll fetches it again, never that one is missed.
 *
 * Privacy: a page of rows (their thumbnails are students' screens) and every answer with a snapshot
 * write admin_audit first (`boards.list`, `board.view`); when that fails, nothing is shown. Following
 * a board live is one look: its polls write again only REPEAT_LOOK_MS after the admin's last row
 * for that board (`auditRepeatLook`), while opening it always writes.
 */
import { ADMIN_LIMITS, type AdminBoardDoc, type AdminBoardList, type AdminBoardRow } from "@/lib/admin/contracts";
import { toAdminAttempt, ATTEMPT_SELECT, type AttemptRow } from "./attempts";
import { auditLook, auditRepeatLook } from "./audit";
import { DAY_MS, errorCounts, inList, latestEvents, toAdminEvent } from "./events";
import { ConsoleQueryError, failureOf, restClient, type ConsoleDeps, type Rest } from "./rest";

export const BOARD_SELECT = "id,user_id,title,preview,created_at,updated_at,version,deleted_at,size_bytes,attempts";
/** A board's events, attempts and kept snapshots in the document, at most. */
export const DOC_EVENTS = 100;
export const DOC_ATTEMPTS = 200;
export const DOC_HISTORY = 100;
/** The user page lists at most this many boards. */
export const USER_BOARDS = 500;
/** The snapshot's first bytes must arrive within this long; after that it streams for as long as the function may run. */
export const SNAPSHOT_FIRST_BYTE_MS = 15_000;

/** One admin_board_rows row. */
export interface BoardViewRow {
  id: string;
  user_id: string;
  title: string | null;
  preview: string | null;
  created_at: string;
  updated_at: string;
  version: number | string;
  deleted_at: string | null;
  size_bytes: number | string | null;
  attempts: number | null;
}

export interface Owner {
  email: string | null;
  name: string | null;
}

/** A view row as the contract's AdminBoardRow. */
export function toBoardRow(row: BoardViewRow, owner: Owner | undefined, errors7d: number): AdminBoardRow {
  return {
    id: row.id,
    userId: row.user_id,
    ownerEmail: owner?.email ?? null,
    ownerName: owner?.name ?? null,
    title: row.title ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    preview: row.preview ? row.preview : null,
    version: Number(row.version) || 0,
    sizeKb: Math.round((Number(row.size_bytes) || 0) / 1024),
    attempts: Number(row.attempts) || 0,
    errors7d,
  };
}

/** The owners' names (profiles) and emails (auth) of these rows. */
export async function ownersOf(rest: Rest, rows: readonly BoardViewRow[]): Promise<Map<string, Owner>> {
  const ids = [...new Set(rows.map((r) => r.user_id))];
  if (!ids.length) return new Map();
  const [profiles, emails] = await Promise.all([
    rest.rows<{ user_id: string; display_name: string | null }>({ table: "profiles", params: { select: "user_id,display_name", user_id: inList(ids) } }),
    rest.emails(ids),
  ]);
  const names = new Map(profiles.map((p) => [p.user_id, p.display_name ?? null]));
  return new Map(ids.map((id) => [id, { email: emails.get(id) ?? null, name: names.get(id) ?? null }]));
}

/** The rows with their owners and their errors of the last 7 days (noise left out). */
export async function boardRowsOf(rest: Rest, rows: readonly BoardViewRow[], owners?: ReadonlyMap<string, Owner>, errorFilter?: Record<string, string>): Promise<AdminBoardRow[]> {
  if (!rows.length) return [];
  const since = new Date(rest.now - 7 * DAY_MS).toISOString();
  const [who, errors] = await Promise.all([
    owners ? Promise.resolve(owners) : ownersOf(rest, rows),
    errorCounts(rest, "board_id", since, errorFilter ?? { board_id: inList(rows.map((r) => r.id)) }),
  ]);
  return rows.map((r) => toBoardRow(r, who.get(r.user_id), errors.counts.get(r.id) ?? 0));
}

export interface BoardListQuery {
  /** one user's boards */
  userId?: string;
  /** only boards saved in the last ADMIN_LIMITS.liveWindowMin */
  live?: boolean;
  /** the next page: boards saved before this (the previous page's nextBefore) */
  before?: string;
}

/** A page of boards, newest first (ADMIN_LIMITS.boardsPage), logged as `boards.list`. */
export async function buildBoardList(deps: ConsoleDeps, query: BoardListQuery, adminId: string): Promise<AdminBoardList> {
  const rest = restClient(deps);
  const updated: string[] = [];
  if (query.live) updated.push(`gte.${new Date(rest.now - ADMIN_LIMITS.liveWindowMin * 60_000).toISOString()}`);
  if (query.before) updated.push(`lt.${query.before}`);
  const page = await rest.rows<BoardViewRow>({
    table: "admin_board_rows",
    params: {
      select: BOARD_SELECT,
      deleted_at: "is.null",
      ...(query.userId ? { user_id: `eq.${query.userId}` } : {}),
      ...(updated.length ? { updated_at: updated } : {}),
      order: "updated_at.desc,id.desc",
      // one past the page says whether there is another
      limit: String(ADMIN_LIMITS.boardsPage + 1),
    },
  });
  const more = page.length > ADMIN_LIMITS.boardsPage;
  const rows = page.slice(0, ADMIN_LIMITS.boardsPage);
  const boards = await boardRowsOf(rest, rows);
  await auditLook(rest, {
    adminId,
    action: "boards.list",
    targetKind: query.userId ? "user" : null,
    targetId: query.userId ?? null,
    meta: { boards: boards.length, ...(query.live ? { live: true } : {}), ...(query.before ? { before: query.before } : {}) },
  });
  return { generatedAt: new Date(rest.now).toISOString(), boards, nextBefore: more ? rows[rows.length - 1].updated_at : null };
}

export type BoardDocResult =
  | { kind: "missing" }
  | { kind: "unchanged"; version: number }
  /** the AdminBoardDoc's JSON, streamed (the snapshot spliced in as stored) */
  | { kind: "doc"; version: number; body: ReadableStream<Uint8Array> };

const OPEN_BRACE = 0x7b;
const isSpace = (b: number) => b === 0x20 || b === 0x0a || b === 0x0d || b === 0x09;

/**
 * Reads up to PostgREST's opening brace of `{"snapshot": …}`; null when the board is gone. The rest
 * of the body is `"snapshot": … }`, ready to follow the document's own fields.
 */
async function openSnapshot(rest: Rest, id: string, signal: AbortSignal): Promise<{ lead: Uint8Array; reader: ReadableStreamDefaultReader<Uint8Array> } | null> {
  const res = await rest.stream(
    { table: "whiteboards", params: { select: "snapshot:data", id: `eq.${id}`, deleted_at: "is.null" } },
    { accept: "application/vnd.pgrst.object+json", signal },
  );
  if (!res.ok) {
    const err = await failureOf("whiteboards", res);
    // PGRST116: the object answer found no row (the board was deleted after its row was read)
    if (res.status === 406 && /PGRST116/.test(err.message)) return null;
    throw err;
  }
  if (!res.body) throw new ConsoleQueryError("whiteboards", res.status, "the board's data came back empty");
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) throw new ConsoleQueryError("whiteboards", res.status, "the board's data came back empty");
    let i = 0;
    while (i < value.length && isSpace(value[i])) i++;
    if (i === value.length) continue;
    if (value[i] !== OPEN_BRACE) {
      await reader.cancel().catch(() => {});
      throw new ConsoleQueryError("whiteboards", res.status, "the board's data was not a JSON object");
    }
    return { lead: value.subarray(i + 1), reader };
  }
}

/**
 * One board for the viewer: `{ unchanged }` when `since` is its version, else the whole document,
 * streamed, once the look is logged (`board.view`). Null-ish answers: "missing" for no such board (or
 * a deleted one).
 */
export async function openBoardDoc(deps: ConsoleDeps, id: string, opts: { since?: number; adminId: string }): Promise<BoardDocResult> {
  const rest = restClient(deps);
  const row = await rest.one<BoardViewRow>({ table: "admin_board_rows", params: { select: BOARD_SELECT, id: `eq.${id}` } });
  if (!row || row.deleted_at) return { kind: "missing" };
  const version = Number(row.version) || 0;
  if (opts.since !== undefined && opts.since === version) return { kind: "unchanged", version };

  // The snapshot first (the slow part), everything else beside it; the look logged before any of it is answered.
  const abort = new AbortController();
  const firstByte = setTimeout(() => abort.abort(new DOMException("The board's data did not arrive in time.", "TimeoutError")), SNAPSHOT_FIRST_BYTE_MS);
  const snapshot = openSnapshot(rest, id, abort.signal);
  // Never an unhandled rejection: it is awaited below, or abandoned when something else failed first.
  snapshot.catch(() => {});
  try {
    const [board, events, attempts, history] = await Promise.all([
      boardRowsOf(rest, [row]).then((rows) => rows[0]),
      latestEvents(rest, { board_id: `eq.${id}` }, DOC_EVENTS),
      rest.rows<AttemptRow>({ table: "learning_attempts", params: { select: ATTEMPT_SELECT, board_id: `eq.${id}`, order: "started_at.desc", limit: String(DOC_ATTEMPTS) } }),
      rest.rows<{ id: number; created_at: string; version: number | string; reason: string | null }>({
        table: "whiteboard_snapshots",
        params: { select: "id,created_at,version,reason", whiteboard_id: `eq.${id}`, order: "created_at.desc", limit: String(DOC_HISTORY) },
      }),
      // an open always logs; a follow-live poll (`since`) is the same look, logged again only after REPEAT_LOOK_MS
      opts.since === undefined
        ? auditLook(rest, { adminId: opts.adminId, action: "board.view", targetKind: "board", targetId: id, meta: { version, ownerId: row.user_id } })
        : auditRepeatLook(rest, { adminId: opts.adminId, action: "board.view", targetKind: "board", targetId: id, meta: { version, ownerId: row.user_id, follow: true } }),
    ]);
    const opened = await snapshot;
    clearTimeout(firstByte);
    if (!opened) return { kind: "missing" };

    const emails = await rest.emails(events.map((e) => e.user_id));
    const head: Omit<AdminBoardDoc, "snapshot"> = {
      generatedAt: new Date(rest.now).toISOString(),
      board,
      events: events.map((e) => toAdminEvent(e, emails)),
      attempts: attempts.map(toAdminAttempt),
      history: history.map((h) => ({ id: Number(h.id), at: h.created_at, version: Number(h.version) || 0, reason: h.reason ?? "interval" })),
    };
    // `{…head…,` + `"snapshot": …}`: the head's closing brace becomes the comma before PostgREST's key.
    const prefix = new TextEncoder().encode(`${JSON.stringify(head).slice(0, -1)},`);
    const { lead, reader } = opened;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(prefix);
        if (lead.length) controller.enqueue(lead);
      },
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) controller.close();
          else controller.enqueue(value);
        } catch (err) {
          controller.error(err);
        }
      },
      cancel(reason) {
        return reader.cancel(reason);
      },
    });
    return { kind: "doc", version, body };
  } catch (err) {
    clearTimeout(firstByte);
    abort.abort();
    throw err;
  }
}
