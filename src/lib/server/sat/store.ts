/**
 * SAT mode's reads and writes (docs/SAT-MODE.md, docs/SAT-V2.md, 20261022000000_sat_mode.sql,
 * 20261023000000_sat_reviews.sql), for the /api/sat/* routes. Everything runs AS THE STUDENT (their
 * own token, RLS: live questions, their own answers, passes and reviews) except taking a free tutor pass, which is the service role's
 * (`sat_take_tutor_pass`: the cap is a server setting, so no user may call it).
 *
 * `satStoreDeps` is the seam the tests replace (like `askStoreDeps`).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";
import { SAT_DOMAINS, SAT_LIMITS, SAT_QUESTION_COLUMNS, SatQuestionSchema, type SatDomain, type SatQuestion, type SatTutorResponse } from "@/lib/sat/contracts";
import type { BankEntry } from "@/lib/sat/pick";
import type { ReviewRow, ReviewSchedule } from "@/lib/sat/reviews";
import { serviceClient, userClient } from "@/lib/server/billing";

const log = logger.child({ module: "sat" });

export const satStoreDeps = {
  /** a client that acts as the student (RLS applies) */
  user: (token: string): SupabaseClient => userClient(token),
  /** the service role, or null without SUPABASE_SERVICE_ROLE_KEY */
  service: (): SupabaseClient | null => serviceClient(),
  now: (): number => Date.now(),
};

/** A read that failed: the route answers 502 (or 503 for a missing service role). */
export class SatStoreError extends Error {
  constructor(
    message: string,
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = "SatStoreError";
  }
}

type PgError = { message: string; code?: string | null } | null;

function fail(what: string, error: PgError): never {
  log.warn({ what, code: error?.code ?? null, error: error?.message?.slice(0, 200) }, "sat store failed");
  throw new SatStoreError(`${what}: ${error?.message ?? "no answer"}`, error?.code ?? null);
}

// ------------------------------------------------------------------ the bank's metadata

const BANK_TTL_MS = 60_000;
const PAGE = 1000;
let bankCache: { at: number; rows: BankEntry[] } | null = null;

/** Tests only. */
export function resetSatBankCache(): void {
  bankCache = null;
}

/**
 * The live bank's metadata (id, domain, skill, difficulty), read in pages and kept for a minute:
 * every signed-in student sees the same live rows, so one copy serves them all.
 */
export async function readBankMeta(token: string): Promise<BankEntry[]> {
  const now = satStoreDeps.now();
  if (bankCache && now - bankCache.at < BANK_TTL_MS) return bankCache.rows;
  const db = satStoreDeps.user(token);
  const rows: BankEntry[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("sat_questions")
      .select("id,domain,skill,difficulty")
      .eq("status", "live")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) fail("read the bank", error);
    const page = (data ?? []) as Array<{ id: string; domain: string; skill: string; difficulty: number }>;
    for (const r of page) if ((SAT_DOMAINS as readonly string[]).includes(r.domain)) rows.push({ id: r.id, domain: r.domain as SatDomain, skill: r.skill, difficulty: Number(r.difficulty) });
    if (page.length < PAGE) break;
  }
  bankCache = { at: now, rows };
  return rows;
}

// ------------------------------------------------------------------ questions

/** The v2 notes a row has no value for are left out of the answer (the contract's "optional"), never sent as null. */
function withoutEmptyNotes(row: unknown): unknown {
  if (!row || typeof row !== "object") return row;
  const out = { ...(row as Record<string, unknown>) };
  for (const k of ["nudge", "common_wrong"]) if (out[k] === null || out[k] === undefined) delete out[k];
  return out;
}

/** Full live rows for `ids`, in the order asked; a row that does not fit the contract is left out (logged). */
export async function readQuestions(token: string, ids: readonly string[]): Promise<SatQuestion[]> {
  if (!ids.length) return [];
  const { data, error } = await satStoreDeps.user(token).from("sat_questions").select(SAT_QUESTION_COLUMNS).eq("status", "live").in("id", [...ids]);
  if (error) fail("read questions", error);
  const byId = new Map<string, SatQuestion>();
  for (const row of (data ?? []) as unknown[]) {
    const parsed = SatQuestionSchema.safeParse(withoutEmptyNotes(row));
    if (parsed.success) byId.set(parsed.data.id, parsed.data);
    else log.error({ id: (row as { id?: string })?.id, issue: parsed.error.issues[0]?.message }, "a live SAT question does not fit the contract");
  }
  return ids.map((id) => byId.get(id)).filter((q): q is SatQuestion => Boolean(q));
}

// ------------------------------------------------------------------ answers

export type AttemptRow = { question_id: string; correct: boolean; created_at: string };

/** The student's newest answers (at most `limit`), newest first. */
export async function readAttempts(token: string, userId: string, limit: number = SAT_LIMITS.progressWindow): Promise<AttemptRow[]> {
  const { data, error } = await satStoreDeps
    .user(token)
    .from("sat_attempts")
    .select("question_id,correct,created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) fail("read answers", error);
  return (data ?? []) as AttemptRow[];
}

export type NewAttempt = { question_id: string; chosen: string; correct: boolean; used_tutor: boolean; seconds: number };

/** Save one answer as the student. `cap` when the account's daily cap refused it (23514). */
export async function insertAttempt(token: string, userId: string, row: NewAttempt): Promise<"ok" | "cap"> {
  const { error } = await satStoreDeps
    .user(token)
    .from("sat_attempts")
    .insert({ user_id: userId, profile_id: userId, ...row });
  if (!error) return "ok";
  if (error.code === "23514" && /sat_attempts_cap|too many/i.test(`${error.message} ${(error as { hint?: string }).hint ?? ""}`)) return "cap";
  fail("save an answer", error);
}

// ------------------------------------------------------------------ the mistake deck

/** At most this many open reviews are read (one per question at most, so the bank's size bounds it). */
const REVIEWS_WINDOW = 5000;

const asReview = (r: Record<string, unknown>): ReviewRow => ({
  question_id: String(r.question_id),
  due_on: String(r.due_on).slice(0, 10),
  step: Number(r.step) === 2 ? 2 : 1,
  cleared_at: r.cleared_at === null || r.cleared_at === undefined ? null : String(r.cleared_at),
});

/** The student's review of one question, or null. */
export async function readReview(token: string, userId: string, questionId: string): Promise<ReviewRow | null> {
  const { data, error } = await satStoreDeps
    .user(token)
    .from("sat_reviews")
    .select("question_id,due_on,step,cleared_at")
    .eq("user_id", userId)
    .eq("question_id", questionId)
    .limit(1);
  if (error) fail("read a review", error);
  const row = ((data ?? []) as Array<Record<string, unknown>>)[0];
  return row ? asReview(row) : null;
}

/** The student's open (not cleared) reviews, due soonest first. */
export async function readOpenReviews(token: string, userId: string): Promise<ReviewRow[]> {
  const { data, error } = await satStoreDeps
    .user(token)
    .from("sat_reviews")
    .select("question_id,due_on,step,cleared_at")
    .eq("user_id", userId)
    .is("cleared_at", null)
    .order("due_on", { ascending: true })
    .limit(REVIEWS_WINDOW);
  if (error) fail("read reviews", error);
  return ((data ?? []) as Array<Record<string, unknown>>).map(asReview);
}

/**
 * Write one question's new schedule as the student: an update when they already have a row, an
 * insert otherwise (a parallel insert that lost the race, 23505, is retried as the update).
 */
export async function writeReview(token: string, userId: string, questionId: string, schedule: ReviewSchedule, exists: boolean): Promise<void> {
  const db = satStoreDeps.user(token);
  const update = async () => {
    const { error } = await db.from("sat_reviews").update(schedule).eq("user_id", userId).eq("question_id", questionId);
    if (error) fail("update a review", error);
  };
  if (exists) return update();
  const { error } = await db.from("sat_reviews").insert({ user_id: userId, question_id: questionId, ...schedule });
  if (!error) return;
  if (error.code === "23505") return update();
  fail("save a review", error);
}

// ------------------------------------------------------------------ the free tutor

/** POST /api/sat/tutor: take (or find) today's pass for a question. `missing` for a question not in the live bank. */
export async function takeTutorPass(userId: string, questionId: string, day: string, cap: number): Promise<SatTutorResponse | "missing" | "no_service"> {
  const db = satStoreDeps.service();
  if (!db) return "no_service";
  const { data, error } = await db.rpc("sat_take_tutor_pass", { p_profile_id: userId, p_question_id: questionId, p_day: day, p_cap: cap });
  if (error) {
    if (error.code === "P0002") return "missing";
    fail("take a tutor pass", error);
  }
  const r = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!r || typeof r.allowed !== "boolean") fail("take a tutor pass", { message: "unexpected answer" });
  return { allowed: r.allowed, used_today: Number(r.used_today) || 0, cap: Number(r.cap ?? cap), unlimited: r.unlimited === true };
}

/** How many free tutor passes the student used on `day`. */
export async function countPasses(token: string, userId: string, day: string): Promise<number> {
  const { count, error } = await satStoreDeps
    .user(token)
    .from("sat_tutor_passes")
    .select("question_id", { count: "exact", head: true })
    .eq("profile_id", userId)
    .eq("day", day);
  if (error) fail("count tutor passes", error);
  return count ?? 0;
}

/** Whether the student has Agathon Unlimited (`sat_tutor_access`, which follows a kid to their grown-up's plan). */
export async function readUnlimited(token: string): Promise<boolean> {
  const { data, error } = await satStoreDeps.user(token).rpc("sat_tutor_access");
  if (error) fail("read the plan", error);
  const r = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  return r?.unlimited === true;
}
