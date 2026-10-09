/**
 * Each email at most once: public.email_log (supabase/migrations/20261003030000_email_log.sql),
 * one row per (user, kind, ref), written only with the service role.
 *
 * Claim, then send, then record (`sendOnce`):
 *   1. claim   insert (user_id, kind, ref). The unique key makes this the lock: a second claim of
 *              the same email (a double click, two cron runs, two server instances) gets 23505 and
 *              stops there as `already_sent`.
 *   2. send    through Resend, with an Idempotency-Key derived from the same email.
 *   3. record  resend_id and sent_at on the claimed row.
 * When the send fails, the claim is deleted again (`release`, which only ever deletes a row with
 * no resend_id), so a later attempt can retry. Why claim first and not "send, then insert": two
 * concurrent requests would both see "not sent yet" and both send.
 *
 * What is left on a crash. A process killed between the claim and the record leaves a row with
 * resend_id null and sent_at null: that email counts as sent and is not retried by itself. Resend
 * still has it if it went out (look it up by recipient in the dashboard); if it did not, delete
 * the row and the next attempt sends it (docs/RUNBOOK-ops.md, "Email"). That window is one HTTP
 * call long; the opposite choice (retry stale claims) could send twice.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type pino from "pino";
import type { SendEmailInput, SendEmailResult } from "@/lib/email/resend";

export const EMAIL_LOG_TABLE = "email_log";

/** Kinds as the table's check allows them (`^[a-z][a-z0-9_]{0,39}$`). */
export type EmailKind = "welcome" | "trial_reminder" | "unlimited_started" | "first_practice" | "trial_progress" | "weekly_report" | "bug_reply";

/** One email: who, which kind, and what about (`''` for once-per-account emails). */
export type EmailLogKey = { userId: string; kind: EmailKind; ref: string };

export type ClaimResult = { status: "claimed" } | { status: "taken" } | { status: "error"; message: string };

export type EmailLogStore = {
  claim(key: EmailLogKey): Promise<ClaimResult>;
  /** Store Resend's id on the claimed row. */
  record(key: EmailLogKey, resendId: string): Promise<{ ok: true } | { error: string }>;
  /** Delete an unsent claim (resend_id still null) so a later attempt can retry. */
  release(key: EmailLogKey): Promise<{ ok: true } | { error: string }>;
  /** Of `refs`, the ones that already have a row of `kind` (claimed or sent), for a batch's first pass. */
  loggedRefs(kind: EmailKind, refs: string[]): Promise<Set<string> | { error: string }>;
};

const UNIQUE_VIOLATION = "23505";

/** The store over a service-role supabase-js client. */
export function supabaseEmailLog(client: SupabaseClient): EmailLogStore {
  const table = () => client.from(EMAIL_LOG_TABLE);
  return {
    async claim({ userId, kind, ref }) {
      const { error } = await table().insert({ user_id: userId, kind, ref });
      if (!error) return { status: "claimed" };
      if (error.code === UNIQUE_VIOLATION) return { status: "taken" };
      return { status: "error", message: error.message };
    },
    async record({ userId, kind, ref }, resendId) {
      const { error } = await table()
        .update({ resend_id: resendId, sent_at: new Date().toISOString() })
        .eq("user_id", userId)
        .eq("kind", kind)
        .eq("ref", ref);
      return error ? { error: error.message } : { ok: true };
    },
    async release({ userId, kind, ref }) {
      const { error } = await table().delete().eq("user_id", userId).eq("kind", kind).eq("ref", ref).is("resend_id", null);
      return error ? { error: error.message } : { ok: true };
    },
    async loggedRefs(kind, refs) {
      if (refs.length === 0) return new Set();
      const { data, error } = await table().select("ref").eq("kind", kind).in("ref", refs);
      if (error) return { error: error.message };
      return new Set((data ?? []).map((row: { ref: string }) => row.ref));
    },
  };
}

export type SendOnceOutcome =
  | { status: "sent"; id: string }
  | { status: "already_sent" }
  /** Resend refused or could not be reached; the claim was released (or could not be: `released: false`). */
  | { status: "failed"; error: string; httpStatus?: number; retryAfterMs?: number; released: boolean }
  /** The log could not be read or written before sending: nothing was sent. */
  | { status: "log_error"; error: string };

export type SendOnceInput = {
  store: EmailLogStore;
  key: EmailLogKey;
  message: SendEmailInput;
  send: (message: SendEmailInput) => Promise<SendEmailResult>;
  log: pino.Logger;
};

/** Claim, send, record (see the module comment). Never throws. */
export async function sendOnce({ store, key, message, send, log }: SendOnceInput): Promise<SendOnceOutcome> {
  const where = { kind: key.kind, ref: key.ref, userId: key.userId };
  let claim: ClaimResult;
  try {
    claim = await store.claim(key);
  } catch (err) {
    claim = { status: "error", message: err instanceof Error ? err.message : String(err) };
  }
  if (claim.status === "taken") return { status: "already_sent" };
  if (claim.status === "error") {
    log.error({ ...where, error: claim.message }, "email log: claim failed, nothing sent");
    return { status: "log_error", error: claim.message };
  }

  let result: SendEmailResult;
  try {
    result = await send(message);
  } catch (err) {
    result = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  if (!result.ok) {
    let released = true;
    try {
      const undo = await store.release(key);
      if ("error" in undo) {
        released = false;
        log.error({ ...where, error: undo.error }, "email log: could not release the claim of a failed send; delete the row to retry");
      }
    } catch (err) {
      released = false;
      log.error({ ...where, error: err instanceof Error ? err.message : String(err) }, "email log: could not release the claim of a failed send; delete the row to retry");
    }
    return { status: "failed", error: result.error, httpStatus: result.status, retryAfterMs: result.retryAfterMs, released };
  }

  try {
    const recorded = await store.record(key, result.id);
    // Sent either way: the claim row stays (resend_id null), so it is never sent twice.
    if ("error" in recorded) log.error({ ...where, resendId: result.id, error: recorded.error }, "email log: sent, but the Resend id was not stored");
  } catch (err) {
    log.error({ ...where, resendId: result.id, error: err instanceof Error ? err.message : String(err) }, "email log: sent, but the Resend id was not stored");
  }
  return { status: "sent", id: result.id };
}
