/**
 * Ask's saved chat and memory, on the server (docs/ASK-V2.md, part "memory"; migration
 * `20261011000000_ask_v2.sql`: `ask_messages`, `learner_memory`).
 *
 * WHO WRITES WHAT. A board's turns are saved and read with the STUDENT'S OWN token (`userClient`), so
 * RLS holds every row to its owner and a board they own. The memory is read with their token too,
 * and cleared by its owner; it is written only with the service role (`serviceClient`), after a turn,
 * once the memory model's notes have passed `memoryNoteAllowed`: a student cannot write what the
 * tutor believes about them. A grown-up reads and clears a kid's memory through the route, which
 * checks the kid is theirs first (`fetchKidMemory`, `deleteKidMemory`, service role).
 *
 * NEVER THROWS. Every caller carries on without these: the chat goes on unsaved, the tutor answers
 * without what it remembers, the history route answers no turns. A failure is logged (with the
 * Postgres or PostgREST code, never the words of the chat) and answered as "nothing" (`null`, `[]`,
 * `false`), and each read gives up after STORE_TIMEOUT_MS. The routes that must tell "nothing" from
 * "could not read" (history, memory) use the `fetch…`/`delete…` forms, which answer null or false.
 *
 * `askStoreDeps` is the seam the tests replace (like `familyDeps`).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getLiveModels } from "@/lib/env";
import { ASK_LIMITS, type AskStoredTurn, type LearnerMemory } from "@/lib/live/ask/contracts";
import { skillDef } from "@/lib/learning/contracts";
import { isGrade } from "@/lib/learning/grades";
import { logger } from "@/lib/logger";
import { isCourseId } from "@/lib/onboarding/courseIds";
import { serviceClient, userClient } from "@/lib/server/billing";
import { chatJsonWithFallback } from "@/lib/server/openrouter";
import { AskMemoryReplySchema, askMemoryReasoning, buildAskMemoryMessages } from "@/lib/server/prompts/askMemory";
import { cleanMemoryNotes, droppedNotes, MAX_DROPPED_PER_TURN, memoryWorthy, sameNotes } from "./memoryNotes";

export { memoryNoteAllowed } from "./memoryNotes";

const log = logger.child({ module: "ask-store" });

export const ASK_TURNS_TABLE = "ask_messages";
export const LEARNER_MEMORY_TABLE = "learner_memory";

/** One read or write gives up after this long: the ask route waits for the context before it answers. */
export const STORE_TIMEOUT_MS = 3_000;
/** The memory model: one attempt per model, well inside `after()`'s time. */
export const MEMORY_ATTEMPT_MS = 8_000;
/** The database's caps on a saved turn (20261011000000_ask_v2.sql). */
export const TURN_LIMITS = { body: 4_000, notes: 8, note: 200, wrote: 12 } as const;
/** Recent skills read for the context: the newest attempts, then their distinct skills. */
export const RECENT_SKILLS = 5;
const RECENT_ATTEMPTS = 60;
/** Outcomes that mean the student worked the problem (an untouched tutor problem says nothing). */
const WORKED = new Set(["first_try", "self_corrected", "with_help", "tutor_solved"]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTION_KIND = /^[a-z][a-z0-9_]{0,39}$/;
const CLIENT_ID = /^[A-Za-z0-9_-]{1,64}$/;
/** The tutor's reply to a student's message is saved under the message's client id plus this. */
export const TUTOR_CLIENT_SUFFIX = ":tutor";

/** The table is not there (the migration is not applied), or a column it should have. */
const MISSING = new Set(["PGRST205", "PGRST204", "42P01", "42703"]);

export const askStoreDeps = {
  /** a client that acts as the student (RLS applies) */
  user: (token: string): SupabaseClient => userClient(token),
  /** the service role, or null without SUPABASE_SERVICE_ROLE_KEY */
  service: (): SupabaseClient | null => serviceClient(),
  chatJson: chatJsonWithFallback,
  models: () => getLiveModels(),
};

/** Who is asking, as the route knows them: the signed-in user's access token and id. */
export interface AskStoreCaller {
  token: string;
  userId: string;
}

/** One turn to save on a board. A tutor turn carries the notes and the kinds of action it wrote. */
export interface AskSaveTurn {
  role: "user" | "tutor";
  text: string;
  notes?: string[];
  /** the action kinds written on the board (`write_problems`, `graph`…), never their content */
  wrote?: string[];
  /** the client's id for a student turn: the same id is not saved twice (a retry) */
  clientId?: string;
}

interface DbError {
  code?: string;
  message?: string;
}

const timeout = () => AbortSignal.timeout(STORE_TIMEOUT_MS);
const codeOf = (error: DbError | null | undefined) => String(error?.code ?? "");
const errorText = (err: unknown) => (err instanceof Error ? `${err.name}: ${err.message}` : String(err)).slice(0, 200);
const missing = (error: DbError | null | undefined) => MISSING.has(codeOf(error));

/** Logs a failed request by its code and message (PostgREST's words, never the chat's). */
function failed(what: string, error: DbError | null | undefined, extra: Record<string, unknown> = {}): void {
  const level = missing(error) ? "info" : "warn";
  log[level]({ what, code: codeOf(error) || null, error: String(error?.message ?? "").slice(0, 200), ...extra }, missing(error) ? `${what}: no table (is 20261011000000_ask_v2.sql applied?)` : `${what} failed`);
}

// ------------------------------------------------------------------ saving turns

interface TurnRow {
  board_id: string;
  role: "user" | "tutor";
  body: string;
  notes: string[];
  wrote: string[];
  client_id: string | null;
}

const clipText = (text: string, max: number) => (text.length > max ? text.slice(0, max) : text);

/**
 * The rows as the database takes them: text trimmed and cut to its caps, notes and action kinds
 * cleaned and capped, a tutor turn without a client id filed under the student's message before it
 * (`<id>:tutor`), so a retried exchange is saved once. A turn with no text is left out.
 */
export function turnRows(boardId: string, turns: readonly AskSaveTurn[]): TurnRow[] {
  const out: TurnRow[] = [];
  let lastUserId: string | null = null;
  for (const turn of turns) {
    const body = clipText(String(turn.text ?? "").trim(), TURN_LIMITS.body).trim();
    const own = typeof turn.clientId === "string" && CLIENT_ID.test(turn.clientId) ? turn.clientId : null;
    const clientId = own ?? (turn.role === "tutor" && lastUserId ? `${lastUserId}${TUTOR_CLIENT_SUFFIX}` : null);
    if (turn.role === "user") lastUserId = own;
    if (!body || !/\S/.test(body)) continue;
    const notes = (turn.notes ?? [])
      .map((n) => clipText(String(n ?? "").replace(/\s+/g, " ").trim(), TURN_LIMITS.note).trim())
      .filter((n) => n.length > 0)
      .slice(0, TURN_LIMITS.notes);
    const wrote = [...new Set((turn.wrote ?? []).filter((k) => typeof k === "string" && ACTION_KIND.test(k)))].slice(0, TURN_LIMITS.wrote);
    out.push({ board_id: boardId, role: turn.role === "tutor" ? "tutor" : "user", body, notes, wrote, client_id: clientId });
  }
  return out;
}

/**
 * Saves a finished exchange on a board, as the student. Answers the saved rows' ids in order (a turn
 * already saved under its client id answers the id it was saved with; a turn with no text is left
 * out), or null when saving failed.
 */
export async function saveAskTurns(caller: AskStoreCaller, boardId: string, turns: readonly AskSaveTurn[]): Promise<string[] | null> {
  try {
    if (!UUID.test(boardId)) return null;
    const rows = turnRows(boardId, turns);
    if (!rows.length) return [];
    const db = askStoreDeps.user(caller.token);
    // ON CONFLICT (board_id, client_id) DO NOTHING: only the rows it inserted come back
    const { data, error } = await db
      .from(ASK_TURNS_TABLE)
      .upsert(rows, { onConflict: "board_id,client_id", ignoreDuplicates: true })
      .select("id,client_id")
      .abortSignal(timeout());
    if (error) {
      failed("save ask turns", error, { boardId, turns: rows.length });
      return null;
    }
    const inserted = (Array.isArray(data) ? data : []) as Array<{ id: string; client_id: string | null }>;
    const byClient = new Map<string, string>();
    const plain: string[] = [];
    for (const r of inserted) {
      if (r.client_id) byClient.set(r.client_id, r.id);
      else plain.push(r.id);
    }
    const already = rows.map((r) => r.client_id).filter((id): id is string => !!id && !byClient.has(id));
    if (already.length) {
      const found = await db.from(ASK_TURNS_TABLE).select("id,client_id").eq("board_id", boardId).in("client_id", already).abortSignal(timeout());
      if (found.error) {
        failed("read saved ask turns", found.error, { boardId });
        return null;
      }
      for (const r of (found.data ?? []) as Array<{ id: string; client_id: string | null }>) if (r.client_id) byClient.set(r.client_id, r.id);
    }
    let next = 0;
    const ids = rows.map((r) => (r.client_id ? byClient.get(r.client_id) : plain[next++]));
    if (ids.some((id) => !id)) {
      log.warn({ boardId, turns: rows.length, inserted: inserted.length }, "save ask turns: a saved turn's id did not come back");
      return null;
    }
    return ids as string[];
  } catch (err) {
    log.warn({ boardId, error: errorText(err) }, "save ask turns threw");
    return null;
  }
}

// ------------------------------------------------------------------ the history

const TURN_SELECT = "id,role,body,notes,wrote,created_at";

interface StoredRow {
  id: string;
  role: string;
  body: string;
  notes: unknown;
  wrote: unknown;
  created_at: string;
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** A row as the contract's AskStoredTurn. */
export function toStoredTurn(row: StoredRow): AskStoredTurn {
  return {
    id: String(row.id),
    role: row.role === "tutor" ? "tutor" : "user",
    text: String(row.body ?? ""),
    notes: strings(row.notes),
    wrote: strings(row.wrote),
    at: String(row.created_at),
  };
}

export type AskHistoryRead =
  /** not a board of the caller's (another's, a deleted one, none at all: the same answer) */
  | { kind: "missing" }
  /** the newest ASK_LIMITS.storedTurns, oldest first */
  | { kind: "turns"; turns: AskStoredTurn[] }
  | { kind: "failed" };

/**
 * A board's saved chat for the history route: the board must be the caller's (their token, RLS),
 * then its newest ASK_LIMITS.storedTurns, oldest first. Without the table, no turns.
 */
export async function readAskHistory(caller: AskStoreCaller, boardId: string): Promise<AskHistoryRead> {
  try {
    if (!UUID.test(boardId)) return { kind: "missing" };
    const db = askStoreDeps.user(caller.token);
    const [board, turns] = await Promise.all([
      db.from("whiteboards").select("id").eq("id", boardId).abortSignal(timeout()).maybeSingle(),
      db.from(ASK_TURNS_TABLE).select(TURN_SELECT).eq("board_id", boardId).order("seq", { ascending: false }).limit(ASK_LIMITS.storedTurns).abortSignal(timeout()),
    ]);
    if (board.error) {
      failed("read board for ask history", board.error, { boardId });
      return { kind: "failed" };
    }
    if (!board.data) return { kind: "missing" };
    if (turns.error) {
      failed("read ask history", turns.error, { boardId });
      return missing(turns.error) ? { kind: "turns", turns: [] } : { kind: "failed" };
    }
    const rows = (Array.isArray(turns.data) ? turns.data : []) as StoredRow[];
    return { kind: "turns", turns: rows.map(toStoredTurn).reverse() };
  } catch (err) {
    log.warn({ boardId, error: errorText(err) }, "read ask history threw");
    return { kind: "failed" };
  }
}

// ------------------------------------------------------------------ what the tutor knows

/**
 * What the tutor knows about the student when it answers, read on the server (never trusted from
 * the client): their name and grade (`profiles`), what it remembers (`learner_memory`), and what
 * they worked on lately (`learning_attempts`: up to 5 recent skill names, newest first).
 *
 * `name` is the display name's first word, for the hello's greeting (built here, without a model).
 * The Privacy Policy says AI requests never carry the display name: a prompt must not send it.
 */
export interface AskLearnerContext {
  name: string | null;
  /** 0..8 (K–8), null for a high-school course or not chosen */
  grade: number | null;
  /** a high-school course id when chosen (`algebra1`…) */
  course: string | null;
  memory: string[];
  recent: string[];
}

export const EMPTY_ASK_CONTEXT: AskLearnerContext = { name: null, grade: null, course: null, memory: [], recent: [] };

/** The display name's first word when it reads as a name ("Maya Lopez" → "Maya"); null for an email, digits or nothing. */
export function firstName(displayName: unknown): string | null {
  if (typeof displayName !== "string") return null;
  const first = displayName.trim().split(/\s+/)[0] ?? "";
  if (!first || first.includes("@")) return null;
  return /^\p{L}[\p{L}'’-]{0,29}$/u.test(first) ? first : null;
}

/** Distinct kid-friendly skill names of the worked attempts, newest first ("Other maths" and unknown skills left out). */
export function recentSkillNames(rows: ReadonlyArray<{ skill?: unknown; outcome?: unknown; lines_written?: unknown }>, max = RECENT_SKILLS): string[] {
  const out: string[] = [];
  for (const row of rows) {
    const worked = WORKED.has(String(row.outcome)) || Number(row.lines_written) > 0;
    if (!worked || typeof row.skill !== "string" || row.skill === "other") continue;
    const name = skillDef(row.skill)?.name;
    if (!name || out.includes(name)) continue;
    out.push(name);
    if (out.length >= max) break;
  }
  return out;
}

export async function loadAskContext(caller: AskStoreCaller): Promise<AskLearnerContext> {
  try {
    const db = askStoreDeps.user(caller.token);
    const settle = async <T>(what: string, run: () => PromiseLike<{ data: T | null; error: DbError | null }>): Promise<T | null> => {
      try {
        const { data, error } = await run();
        if (error) {
          failed(what, error);
          return null;
        }
        return data;
      } catch (err) {
        log.warn({ what, error: errorText(err) }, `${what} threw`);
        return null;
      }
    };
    const [profile, memory, attempts] = await Promise.all([
      settle<{ display_name?: unknown; grade?: unknown; course?: unknown }>("read profile for ask", () =>
        db.from("profiles").select("display_name,grade,course").eq("user_id", caller.userId).abortSignal(timeout()).maybeSingle(),
      ),
      settle<{ notes?: unknown }>("read learner memory", () => db.from(LEARNER_MEMORY_TABLE).select("notes").eq("user_id", caller.userId).abortSignal(timeout()).maybeSingle()),
      settle<Array<{ skill?: unknown; outcome?: unknown; lines_written?: unknown }>>("read recent skills for ask", () =>
        db
          .from("learning_attempts")
          .select("skill,outcome,lines_written")
          .eq("user_id", caller.userId)
          .order("started_at", { ascending: false })
          .limit(RECENT_ATTEMPTS)
          .abortSignal(timeout()),
      ),
    ]);
    const grade = profile?.grade;
    const course = profile?.course;
    return {
      name: firstName(profile?.display_name),
      grade: isGrade(grade) ? grade : null,
      course: isCourseId(course) ? course : null,
      memory: cleanMemoryNotes(strings(memory?.notes)),
      recent: recentSkillNames(Array.isArray(attempts) ? attempts : []),
    };
  } catch (err) {
    log.warn({ error: errorText(err) }, "load ask context threw");
    return EMPTY_ASK_CONTEXT;
  }
}

// ------------------------------------------------------------------ remembering

/**
 * After a turn (run with `after()`, never delaying the reply): the memory model reads the notes so
 * far and this exchange, and keeps, adds or drops notes (`prompts/askMemory.ts`). Skipped without a
 * model call for an exchange that cannot teach anything (`memoryWorthy`: "thanks", "ok", "12").
 * Written with the service role only when the cleaned notes changed, and never when one turn would
 * drop more than MAX_DROPPED_PER_TURN of them. Never throws.
 */
export async function rememberFromTurn(caller: AskStoreCaller, exchange: { message: string; reply: string; memory: readonly string[] }): Promise<void> {
  try {
    if (!memoryWorthy(exchange.message, exchange.reply)) return;
    const svc = askStoreDeps.service();
    if (!svc) {
      log.info("ask memory not written: no service role");
      return;
    }
    const prior = cleanMemoryNotes(exchange.memory);
    const models = askStoreDeps.models();
    const { data, model } = await askStoreDeps.chatJson(models.askMemory, models.askMemoryFallback, {
      messages: buildAskMemoryMessages({ notes: prior, message: exchange.message, reply: exchange.reply }),
      schema: AskMemoryReplySchema,
      maxTokens: 600,
      reasoningFor: askMemoryReasoning,
      attemptTimeoutMs: MEMORY_ATTEMPT_MS,
      title: "Agathon Live - ask memory",
    });
    const next = cleanMemoryNotes(data.notes);
    const offered = data.notes.length;
    if (sameNotes(next, prior)) {
      log.info({ model, notes: next.length }, "ask memory unchanged");
      return;
    }
    const dropped = droppedNotes(prior, next);
    if (dropped > MAX_DROPPED_PER_TURN) {
      log.warn({ model, before: prior.length, after: next.length, dropped }, "ask memory not written: the update dropped too many notes");
      return;
    }
    const { error } = await svc
      .from(LEARNER_MEMORY_TABLE)
      .upsert({ user_id: caller.userId, notes: next }, { onConflict: "user_id" })
      .abortSignal(timeout());
    if (error) {
      failed("write learner memory", error);
      return;
    }
    // counts only: the notes are about a child
    log.info({ model, before: prior.length, after: next.length, dropped, filtered: offered - next.length }, "ask memory updated");
  } catch (err) {
    log.warn({ error: errorText(err) }, "ask memory update failed");
  }
}

// ------------------------------------------------------------------ reading and clearing

const EMPTY_MEMORY: LearnerMemory = { notes: [], updatedAt: null };

function toMemory(row: { notes?: unknown; updated_at?: unknown } | null): LearnerMemory {
  if (!row) return EMPTY_MEMORY;
  return { notes: cleanMemoryNotes(strings(row.notes)), updatedAt: typeof row.updated_at === "string" ? row.updated_at : null };
}

async function fetchMemory(db: SupabaseClient, userId: string, what: string): Promise<LearnerMemory | null> {
  try {
    const { data, error } = await db.from(LEARNER_MEMORY_TABLE).select("notes,updated_at").eq("user_id", userId).abortSignal(timeout()).maybeSingle();
    if (error) {
      failed(what, error);
      return missing(error) ? EMPTY_MEMORY : null;
    }
    return toMemory(data as { notes?: unknown; updated_at?: unknown } | null);
  } catch (err) {
    log.warn({ what, error: errorText(err) }, `${what} threw`);
    return null;
  }
}

async function deleteMemory(db: SupabaseClient, userId: string, what: string): Promise<boolean> {
  try {
    const { error } = await db.from(LEARNER_MEMORY_TABLE).delete().eq("user_id", userId).abortSignal(timeout());
    if (error) {
      failed(what, error);
      return missing(error);
    }
    return true;
  } catch (err) {
    log.warn({ what, error: errorText(err) }, `${what} threw`);
    return false;
  }
}

/** The caller's own memory (their token), or null when it could not be read. */
export async function fetchLearnerMemory(caller: AskStoreCaller): Promise<LearnerMemory | null> {
  try {
    return await fetchMemory(askStoreDeps.user(caller.token), caller.userId, "read learner memory");
  } catch (err) {
    log.warn({ error: errorText(err) }, "read learner memory threw");
    return null;
  }
}

/** Clears the caller's own memory (their token: the owner's delete policy). False when it could not. */
export async function deleteLearnerMemory(caller: AskStoreCaller): Promise<boolean> {
  try {
    return await deleteMemory(askStoreDeps.user(caller.token), caller.userId, "clear learner memory");
  } catch (err) {
    log.warn({ error: errorText(err) }, "clear learner memory threw");
    return false;
  }
}

/** A kid's memory, for their grown-up: the ROUTE has checked the kid is theirs. Null when it could not be read (or no service role). */
export async function fetchKidMemory(kidId: string): Promise<LearnerMemory | null> {
  try {
    const svc = askStoreDeps.service();
    return svc ? await fetchMemory(svc, kidId, "read a kid's learner memory") : null;
  } catch (err) {
    log.warn({ error: errorText(err) }, "read a kid's learner memory threw");
    return null;
  }
}

/** Clears a kid's memory, for their grown-up: the ROUTE has checked the kid is theirs. */
export async function deleteKidMemory(kidId: string): Promise<boolean> {
  try {
    const svc = askStoreDeps.service();
    return svc ? await deleteMemory(svc, kidId, "clear a kid's learner memory") : false;
  } catch (err) {
    log.warn({ error: errorText(err) }, "clear a kid's learner memory threw");
    return false;
  }
}

export async function readLearnerMemory(caller: AskStoreCaller): Promise<LearnerMemory> {
  return (await fetchLearnerMemory(caller)) ?? EMPTY_MEMORY;
}

export async function clearLearnerMemory(caller: AskStoreCaller): Promise<void> {
  await deleteLearnerMemory(caller);
}
