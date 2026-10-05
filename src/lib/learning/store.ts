/**
 * The learning record's reads and writes: the student's own `learning_attempts` rows
 * (`supabase/migrations/20261004000000_learning.sql`), with the signed-in Supabase client, so RLS
 * lets each student touch only their own. Loaded with a dynamic import after the board is up, like
 * everything in `src/lib/learning` but `bus.ts`, `hint.ts` and `practiceMarker.ts`.
 *
 * Writes are upserts by the attempt's id, so saving an attempt again replaces it with its latest
 * state, and a retry after a lost answer changes nothing. What goes in is cleaned first: counts and
 * active time clamped to LEARNING_LIMITS, the problem cut to 500 characters, an unknown skill filed
 * under `other`, so a record the board made is never refused for a detail. The database owns
 * `user_id` (its default is the caller), `created_at` and `updated_at` (server time), which are
 * never sent.
 *
 * Failures throw a LearningStoreError whose `code` tells the caller (the board's attempt tracker)
 * whether to try again: only "network" and "unknown" are worth retrying.
 */
import { isCourseId } from "@/lib/onboarding/courseIds";
import { supabase } from "@/lib/supabase";
import { ATTEMPT_ORIGINS, isSkillId, LEARNING_LIMITS, MISTAKE_KINDS, OUTCOMES, type AttemptOrigin, type AttemptRecord, type MistakeKind, type Outcome } from "./contracts";

/**
 * Why a read or write of the learning record failed.
 *
 * - `unavailable`: the table is not there (the migration is not applied); retrying will not help.
 * - `unauthorized`: signed out, the session was refused (401), or RLS refused the rows (42501),
 *   for instance a board that is not the signed-in student's.
 * - `invalid`: the database refused a value (a constraint, 22xxx/23xxx). Every other record of the
 *   same save was still written.
 * - `network`: no answer, a timeout, a gateway or an overloaded database. Retry later.
 * - `unknown`: anything else. Retry later.
 */
export class LearningStoreError extends Error {
  readonly code: "unavailable" | "unauthorized" | "invalid" | "network" | "unknown";
  /** the HTTP status, when the server answered */
  readonly status?: number;
  /** the PostgREST or Postgres error code (PGRST205, 42501, 23514, ...), when there was one */
  readonly dbCode?: string;

  constructor(code: LearningStoreError["code"], message: string, opts: { status?: number; dbCode?: string; cause?: unknown } = {}) {
    super(message);
    this.name = "LearningStoreError";
    this.code = code;
    if (opts.status !== undefined) this.status = opts.status;
    if (opts.dbCode) this.dbCode = opts.dbCode;
    if (opts.cause !== undefined) (this as { cause?: unknown }).cause = opts.cause;
  }
}

type Code = LearningStoreError["code"];

const TABLE = "learning_attempts";
/** rows per upsert request */
const WRITE_CHUNK = 200;
/** rows per read request: PostgREST's `max_rows` (supabase/config.toml [api]); a page never asks for more */
const READ_PAGE = 1000;
/** a mistake kind's count in one attempt (the database's check, and LearnerHint's) */
const MAX_MISTAKE_COUNT = 9999;
/** the earliest time the database accepts for `started_at` / `finished_at` */
const EARLIEST = Date.parse("2026-01-01T00:00:00Z");
const DAY_MS = 86_400_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const COUNT_COLUMNS = [
  ["linesWritten", "lines_written"],
  ["linesRight", "lines_right"],
  ["linesRinged", "lines_ringed"],
  ["hints", "hints"],
  ["tutorSteps", "tutor_steps"],
  ["solves", "solves"],
  ["asks", "asks"],
] as const;

const READ_COLUMNS = [
  "id",
  "board_id",
  "problem_latex",
  "skill",
  "course",
  "origin",
  "parent_id",
  "outcome",
  ...COUNT_COLUMNS.map(([, column]) => column),
  "mistakes",
  "active_ms",
  "started_at",
  "updated_at",
  "finished_at",
].join(",");

/** One row as the store writes it (snake_case; no user_id, created_at or updated_at). */
interface AttemptRow {
  id: string;
  board_id: string | null;
  problem_latex: string;
  skill: string;
  course: string | null;
  origin: AttemptOrigin;
  parent_id: string | null;
  outcome: Outcome;
  lines_written: number;
  lines_right: number;
  lines_ringed: number;
  hints: number;
  tutor_steps: number;
  solves: number;
  asks: number;
  mistakes: Partial<Record<MistakeKind, number>>;
  active_ms: number;
  started_at: string;
  finished_at: string | null;
}

interface DbError {
  message?: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
}

// ------------------------------------------------------------------ errors

/** What a failed request means for the caller (see LearningStoreError). */
function classify(error: DbError | null | undefined, status: number | undefined): Code {
  const code = String(error?.code ?? "");
  // The table (or a column the store uses) is missing: the migration is not applied.
  if (code === "PGRST205" || code === "42P01" || code === "PGRST204" || code === "42703") return "unavailable";
  if (status === 401 || code === "42501" || /^PGRST30\d$/.test(code)) return "unauthorized";
  // 22xxx bad data, 23xxx a constraint, 21000 the same row twice in one statement, PGRST1xx a malformed request.
  if (/^2[123]/.test(code) || /^PGRST1\d\d$/.test(code)) return "invalid";
  // No answer, a gateway, a timeout, an overloaded or restarting database, a lost connection,
  // a serialization failure or deadlock: all may pass.
  if (
    status === 0 ||
    status === 408 ||
    status === 429 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    /^PGRST00\d$/.test(code) ||
    /^(08|53|57)/.test(code) ||
    code === "40001" ||
    code === "40P01"
  ) {
    return "network";
  }
  if (!code && status === undefined && /fetch|network|load failed|timed? ?out|abort/i.test(error?.message ?? "")) return "network";
  if (status === 400 && !code) return "invalid";
  return "unknown";
}

function toStoreError(error: DbError | null | undefined, status: number | undefined, what: string): LearningStoreError {
  const code = classify(error, status);
  const detail = (error?.message ?? "").trim() || (status ? `HTTP ${status}` : "no answer");
  return new LearningStoreError(code, `${what}: ${detail}`, { status: status || undefined, dbCode: error?.code || undefined, cause: error });
}

/** The signed-in student's id, or why there is none. */
async function sessionUserId(): Promise<string> {
  let result: Awaited<ReturnType<typeof supabase.auth.getSession>>;
  try {
    result = await supabase.auth.getSession();
  } catch (e) {
    throw new LearningStoreError("network", `Could not read the session: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
  }
  const id = result.data?.session?.user?.id;
  if (id) return id;
  const error = result.error as { name?: string; status?: number; message?: string } | null;
  // An expired session whose refresh could not reach the server: the student is still signed in.
  if (error && (error.name === "AuthRetryableFetchError" || error.status === 0 || (error.status ?? 0) >= 500)) {
    throw new LearningStoreError("network", `Could not refresh the session: ${error.message ?? "no answer"}`, { status: error.status, cause: error });
  }
  throw new LearningStoreError("unauthorized", "Not signed in.", error ? { cause: error } : {});
}

// ------------------------------------------------------------------ cleaning

function clampInt(value: unknown, max: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return n === Infinity ? max : 0;
  return Math.min(max, Math.max(0, Math.round(n)));
}

/**
 * Text Postgres takes: no NUL, no lone surrogate (JSON would carry it, the database refuses it), at
 * most `max` characters as `char_length` counts them (code points).
 */
function cleanText(value: string, max: number): string {
  let out = "";
  let n = 0;
  for (const ch of value) {
    if (n >= max) break;
    const c = ch.codePointAt(0) ?? 0;
    if (c === 0) continue;
    out += c >= 0xd800 && c <= 0xdfff ? "�" : ch;
    n++;
  }
  return out;
}

function uuidOrNull(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value) ? value.toLowerCase() : null;
}

/** An ISO timestamp the database accepts (2026 or later), else null. */
function timeOrNull(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const t = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(t) && t >= EARLIEST ? new Date(t).toISOString() : null;
}

function cleanMistakes(value: unknown): Partial<Record<MistakeKind, number>> {
  const out: Partial<Record<MistakeKind, number>> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  const source = value as Record<string, unknown>;
  for (const kind of MISTAKE_KINDS) {
    const n = clampInt(source[kind], MAX_MISTAKE_COUNT);
    if (n > 0) out[kind] = n;
  }
  return out;
}

function isOrigin(value: unknown): value is AttemptOrigin {
  return typeof value === "string" && (ATTEMPT_ORIGINS as readonly string[]).includes(value);
}

function isOutcome(value: unknown): value is Outcome {
  return typeof value === "string" && (OUTCOMES as readonly string[]).includes(value);
}

/** A record as a row, or why it cannot be one (nothing about it can be saved). */
function toRow(record: AttemptRecord): AttemptRow | string {
  const id = uuidOrNull(record.id);
  if (!id) return `attempt id is not a uuid (${String(record.id).slice(0, 40)})`;
  if (!isOrigin(record.origin)) return `attempt ${id}: unknown origin ${String(record.origin).slice(0, 40)}`;
  if (!isOutcome(record.outcome)) return `attempt ${id}: unknown outcome ${String(record.outcome).slice(0, 40)}`;
  const problem = cleanText(typeof record.problemLatex === "string" ? record.problemLatex.trim() : "", LEARNING_LIMITS.problemLatex);
  if (!problem) return `attempt ${id}: no problem`;
  const startedAt = timeOrNull(record.startedAt);
  if (!startedAt) return `attempt ${id}: start time missing or before 2026 (${String(record.startedAt).slice(0, 40)})`;
  const parentId = uuidOrNull(record.parentId);
  const row: AttemptRow = {
    id,
    board_id: uuidOrNull(record.boardId),
    problem_latex: problem,
    skill: isSkillId(record.skill) ? record.skill : "other",
    course: isCourseId(record.course) ? record.course : null,
    origin: record.origin,
    parent_id: parentId === id ? null : parentId,
    outcome: record.outcome,
    lines_written: 0,
    lines_right: 0,
    lines_ringed: 0,
    hints: 0,
    tutor_steps: 0,
    solves: 0,
    asks: 0,
    mistakes: cleanMistakes(record.mistakes),
    active_ms: clampInt(record.activeMs, LEARNING_LIMITS.maxActiveMs),
    started_at: startedAt,
    finished_at: timeOrNull(record.finishedAt),
  };
  for (const [field, column] of COUNT_COLUMNS) row[column] = clampInt(record[field], LEARNING_LIMITS.maxCount);
  return row;
}

/** A row as a record; null for a row this code cannot read (an origin or outcome it does not know). */
function fromRow(raw: unknown): AttemptRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== "string" || !row.id) return null;
  if (!isOrigin(row.origin) || !isOutcome(row.outcome)) return null;
  const startedAt = timeOrNull(row.started_at);
  if (!startedAt) return null;
  const record: AttemptRecord = {
    id: row.id,
    boardId: typeof row.board_id === "string" && row.board_id ? row.board_id : null,
    problemLatex: typeof row.problem_latex === "string" ? row.problem_latex : "",
    skill: isSkillId(row.skill) ? row.skill : "other",
    course: isCourseId(row.course) ? row.course : null,
    origin: row.origin,
    parentId: typeof row.parent_id === "string" && row.parent_id ? row.parent_id : null,
    outcome: row.outcome,
    linesWritten: 0,
    linesRight: 0,
    linesRinged: 0,
    hints: 0,
    tutorSteps: 0,
    solves: 0,
    asks: 0,
    mistakes: cleanMistakes(row.mistakes),
    activeMs: clampInt(row.active_ms, LEARNING_LIMITS.maxActiveMs),
    startedAt,
    updatedAt: timeOrNull(row.updated_at) ?? startedAt,
    finishedAt: timeOrNull(row.finished_at),
  };
  for (const [field, column] of COUNT_COLUMNS) record[field] = clampInt(row[column], LEARNING_LIMITS.maxCount);
  return record;
}

// ------------------------------------------------------------------ writing

/**
 * Ids this page has saved (or seen saved) for the signed-in student: a "Now you try" whose parent is
 * among them needs no lookup. Reset when the student changes.
 */
const known = { userId: "", ids: new Set<string>() };

function remember(userId: string, ids: Iterable<string>): void {
  if (known.userId !== userId || known.ids.size > 20_000) {
    known.userId = userId;
    known.ids = new Set();
  }
  for (const id of ids) known.ids.add(id);
}

/**
 * Rows in the order the database needs them: an attempt before the attempts that follow it. The
 * policy checks a `parent_id` against the rows that exist when the statement starts, so a parent and
 * its child in one upsert would refuse the child.
 */
function parentsFirst(rows: AttemptRow[]): AttemptRow[][] {
  const pending = new Map(rows.map((r) => [r.id, r]));
  const layers: AttemptRow[][] = [];
  while (pending.size > 0) {
    const layer = [...pending.values()].filter((r) => !r.parent_id || !pending.has(r.parent_id));
    if (layer.length === 0) {
      // A loop of parents: the board never makes one, and the database refuses it.
      layers.push([...pending.values()]);
      break;
    }
    for (const r of layer) pending.delete(r.id);
    layers.push(layer);
  }
  return layers;
}

/**
 * A "Now you try" can only point at an attempt that was saved. When the attempt it follows never
 * was (its own save was refused), the link is dropped and the attempt is kept: one extra read, only
 * for parents this page has not saved itself.
 */
async function dropUnsavedParents(userId: string, rows: AttemptRow[]): Promise<void> {
  const inBatch = new Set(rows.map((r) => r.id));
  if (known.userId !== userId) remember(userId, []);
  const unknown = [...new Set(rows.map((r) => r.parent_id).filter((p): p is string => !!p && !inBatch.has(p) && !known.ids.has(p)))];
  if (unknown.length === 0) return;
  const found = new Set<string>();
  for (let i = 0; i < unknown.length; i += WRITE_CHUNK) {
    const ids = unknown.slice(i, i + WRITE_CHUNK);
    const { data, error, status } = await supabase.from(TABLE).select("id").in("id", ids);
    if (error) throw toStoreError(error, status, "Could not check the attempts these follow");
    for (const r of Array.isArray(data) ? (data as Array<{ id?: unknown }>) : []) if (typeof r.id === "string") found.add(r.id.toLowerCase());
  }
  remember(userId, found);
  for (const r of rows) if (r.parent_id && !inBatch.has(r.parent_id) && !found.has(r.parent_id) && !known.ids.has(r.parent_id)) r.parent_id = null;
}

async function upsert(rows: AttemptRow[]): Promise<LearningStoreError | null> {
  const { error, status } = await supabase.from(TABLE).upsert(rows, { onConflict: "id" });
  return error ? toStoreError(error, status, `Could not save ${rows.length} learning attempt(s)`) : null;
}

/**
 * Writes `rows`; when the database refuses a value, halves the batch until the refused rows are
 * alone, so one bad record never costs the others. Adds the refused rows' ids to `refusedIds` and
 * returns the first refusal; throws anything else.
 */
async function writeIsolating(rows: AttemptRow[], refusedIds: Set<string>): Promise<LearningStoreError | null> {
  const error = await upsert(rows);
  if (!error) return null;
  if (error.code !== "invalid") throw error;
  if (rows.length === 1) {
    refusedIds.add(rows[0].id);
    return error;
  }
  const mid = Math.ceil(rows.length / 2);
  const first = await writeIsolating(rows.slice(0, mid), refusedIds);
  const second = await writeIsolating(rows.slice(mid), refusedIds);
  return first ?? second;
}

/**
 * Upsert by id (the attempt's latest state wins). Throws on failure, so the caller can retry.
 *
 * Records that cannot be saved at all (no uuid, an unknown origin or outcome, no problem, a start
 * time before 2026) and rows the database refuses are skipped and reported at the end as one
 * "invalid" error, after everything else was written. Any other failure throws at once, and
 * saving the same records again is safe.
 */
export async function saveAttempts(records: readonly AttemptRecord[]): Promise<void> {
  if (records.length === 0) return;
  let refused: LearningStoreError | null = null;
  // The same attempt twice in a batch: its last state wins (one upsert cannot touch a row twice).
  const rows = new Map<string, AttemptRow>();
  for (const record of records) {
    const row = toRow(record);
    if (typeof row === "string") {
      refused ??= new LearningStoreError("invalid", `Learning attempt not saved: ${row}`);
      continue;
    }
    rows.delete(row.id);
    rows.set(row.id, row);
  }
  if (rows.size > 0) {
    const userId = await sessionUserId();
    const all = [...rows.values()];
    await dropUnsavedParents(userId, all);
    const refusedIds = new Set<string>();
    for (const layer of parentsFirst(all)) {
      // A parent refused in an earlier layer was not saved: its followers keep their record, not the link.
      for (const r of layer) if (r.parent_id && refusedIds.has(r.parent_id)) r.parent_id = null;
      for (let i = 0; i < layer.length; i += WRITE_CHUNK) {
        const chunk = layer.slice(i, i + WRITE_CHUNK);
        const error = await writeIsolating(chunk, refusedIds);
        refused ??= error;
        remember(
          userId,
          chunk.filter((r) => !refusedIds.has(r.id)).map((r) => r.id),
        );
      }
    }
  }
  if (refused) throw refused;
}

// ------------------------------------------------------------------ reading

/**
 * The student's attempts, newest first: the last `sinceDays` days, at most `limit`. Empty when the
 * table is not there yet. Rows this code cannot read (an origin or outcome from a newer version)
 * are left out, and a skill it does not know reads as `other`.
 */
export async function loadAttempts(opts: { sinceDays?: number; limit?: number } = {}): Promise<AttemptRecord[]> {
  const sinceDays = typeof opts.sinceDays === "number" && !Number.isNaN(opts.sinceDays) ? opts.sinceDays : LEARNING_LIMITS.readDays;
  const limit = typeof opts.limit === "number" && !Number.isNaN(opts.limit) ? Math.max(0, Math.floor(opts.limit)) : LEARNING_LIMITS.readLimit;
  if (limit === 0) return [];
  const userId = await sessionUserId();
  const since = new Date(Math.max(EARLIEST, Date.now() - sinceDays * DAY_MS)).toISOString();

  const out: AttemptRecord[] = [];
  const seen = new Set<string>();
  // Pages of at most READ_PAGE rows. A row saved while paging moves the later ones down by one, so
  // a page may repeat the previous page's last row: kept once.
  for (let from = 0; out.length < limit; ) {
    const size = Math.min(READ_PAGE, limit - out.length);
    const { data, error, status } = await supabase
      .from(TABLE)
      .select(READ_COLUMNS)
      .eq("user_id", userId)
      .gte("started_at", since)
      .order("started_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + size - 1);
    if (error) {
      const failure = toStoreError(error, status, "Could not read the learning record");
      if (failure.code === "unavailable") return [];
      throw failure;
    }
    const page: unknown[] = Array.isArray(data) ? data : [];
    for (const raw of page) {
      const record = fromRow(raw);
      if (record && !seen.has(record.id)) {
        seen.add(record.id);
        out.push(record);
      }
    }
    if (page.length < size) break;
    from += page.length;
  }
  return out.slice(0, limit);
}
