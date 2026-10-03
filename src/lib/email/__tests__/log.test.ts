/**
 * Each email at most once (src/lib/email/log.ts): the claim-then-send order of `sendOnce`, and the
 * queries the supabase-js store sends to public.email_log.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { EMAIL_LOG_TABLE, sendOnce, supabaseEmailLog, type EmailLogKey, type EmailLogStore } from "@/lib/email/log";
import type { SendEmailInput, SendEmailResult } from "@/lib/email/resend";
import { memoryEmailLog, silentLog } from "./fakes";

const KEY: EmailLogKey = { userId: "11111111-2222-4333-8444-555555555555", kind: "welcome", ref: "" };
const MESSAGE: SendEmailInput = { to: "delivered@resend.dev", subject: "s", html: "<p>h</p>", text: "t", idempotencyKey: "welcome/x" };

function sender(...replies: SendEmailResult[]) {
  return vi.fn(async () => replies.shift() ?? { ok: true as const, id: "re_default" });
}

describe("sendOnce", () => {
  it("claims, sends, then records Resend's id", async () => {
    const { rows, store } = memoryEmailLog();
    const send = sender({ ok: true, id: "re_1" });
    expect(await sendOnce({ store, key: KEY, message: MESSAGE, send, log: silentLog() })).toEqual({ status: "sent", id: "re_1" });
    expect(send).toHaveBeenCalledWith(MESSAGE);
    expect(rows).toEqual([{ user_id: KEY.userId, kind: "welcome", ref: "", resend_id: "re_1", sent_at: expect.any(String) }]);
    // the claim happened before the send
    expect(vi.mocked(store.claim).mock.invocationCallOrder[0]).toBeLessThan(send.mock.invocationCallOrder[0]);
  });

  it("a second time is already_sent and sends nothing", async () => {
    const { store } = memoryEmailLog();
    const send = sender();
    await sendOnce({ store, key: KEY, message: MESSAGE, send, log: silentLog() });
    expect(await sendOnce({ store, key: KEY, message: MESSAGE, send, log: silentLog() })).toEqual({ status: "already_sent" });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("two at once: one sends, the other finds the claim", async () => {
    const { store } = memoryEmailLog();
    const send = sender();
    const both = await Promise.all([1, 2].map(() => sendOnce({ store, key: KEY, message: MESSAGE, send, log: silentLog() })));
    expect(both.map((o) => o.status).sort()).toEqual(["already_sent", "sent"]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("a failed send releases its claim, so the next attempt sends", async () => {
    const { rows, store } = memoryEmailLog();
    const send = sender({ ok: false, error: "timed out" }, { ok: true, id: "re_2" });
    expect(await sendOnce({ store, key: KEY, message: MESSAGE, send, log: silentLog() })).toEqual({ status: "failed", error: "timed out", released: true, httpStatus: undefined, retryAfterMs: undefined });
    expect(rows).toEqual([]);
    expect(await sendOnce({ store, key: KEY, message: MESSAGE, send, log: silentLog() })).toEqual({ status: "sent", id: "re_2" });
  });

  it("a send that throws counts as failed", async () => {
    const { store } = memoryEmailLog();
    const send = vi.fn(async () => {
      throw new Error("boom");
    });
    expect(await sendOnce({ store, key: KEY, message: MESSAGE, send, log: silentLog() })).toMatchObject({ status: "failed", error: "boom", released: true });
  });

  it("says so when the claim could not be released", async () => {
    const { store } = memoryEmailLog();
    store.release = vi.fn(async () => ({ error: "db down" }));
    const log = silentLog();
    const out = await sendOnce({ store, key: KEY, message: MESSAGE, send: sender({ ok: false, error: "x", status: 500 }), log });
    expect(out).toMatchObject({ status: "failed", released: false, httpStatus: 500 });
    expect(log.error).toHaveBeenCalled();
  });

  it("nothing is sent when the claim cannot be written", async () => {
    const store: EmailLogStore = { ...memoryEmailLog().store, claim: vi.fn(async () => ({ status: "error" as const, message: "relation does not exist" })) };
    const send = sender();
    expect(await sendOnce({ store, key: KEY, message: MESSAGE, send, log: silentLog() })).toEqual({ status: "log_error", error: "relation does not exist" });
    expect(send).not.toHaveBeenCalled();
    const throwing: EmailLogStore = { ...store, claim: vi.fn(async () => Promise.reject(new Error("network"))) };
    expect(await sendOnce({ store: throwing, key: KEY, message: MESSAGE, send, log: silentLog() })).toEqual({ status: "log_error", error: "network" });
  });

  it("sent is sent even when the id could not be stored (the claim stays, so never twice)", async () => {
    const { rows, store } = memoryEmailLog();
    store.record = vi.fn(async () => ({ error: "timeout" }));
    const log = silentLog();
    expect(await sendOnce({ store, key: KEY, message: MESSAGE, send: sender({ ok: true, id: "re_3" }), log })).toEqual({ status: "sent", id: "re_3" });
    expect(rows).toHaveLength(1);
    expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ resendId: "re_3" }), expect.stringMatching(/not stored/));
  });
});

/** A supabase-js query builder that records every call and resolves to `result`. */
function recordingClient(result: { data?: unknown; error?: { message: string; code?: string } | null }) {
  const calls: Array<[string, ...unknown[]]> = [];
  const builder: Record<string, unknown> = {};
  for (const method of ["insert", "update", "delete", "select", "eq", "is", "in", "not", "gte", "lt", "order", "limit"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  builder.then = (resolve: (v: unknown) => unknown) => resolve({ data: result.data ?? null, error: result.error ?? null });
  const client = {
    from: (table: string) => {
      calls.push(["from", table]);
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

describe("supabaseEmailLog", () => {
  it("claims with an insert of (user_id, kind, ref)", async () => {
    const { client, calls } = recordingClient({});
    expect(await supabaseEmailLog(client).claim(KEY)).toEqual({ status: "claimed" });
    expect(calls).toEqual([
      ["from", EMAIL_LOG_TABLE],
      ["insert", { user_id: KEY.userId, kind: "welcome", ref: "" }],
    ]);
  });

  it("reads a unique violation as taken, anything else as an error", async () => {
    expect(await supabaseEmailLog(recordingClient({ error: { message: "dup", code: "23505" } }).client).claim(KEY)).toEqual({ status: "taken" });
    expect(await supabaseEmailLog(recordingClient({ error: { message: "nope", code: "42P01" } }).client).claim(KEY)).toEqual({ status: "error", message: "nope" });
  });

  it("records the id and sent_at on the claimed row", async () => {
    const { client, calls } = recordingClient({});
    expect(await supabaseEmailLog(client).record(KEY, "re_9")).toEqual({ ok: true });
    expect(calls[1]).toEqual(["update", { resend_id: "re_9", sent_at: expect.any(String) }]);
    expect(calls.slice(2)).toEqual([
      ["eq", "user_id", KEY.userId],
      ["eq", "kind", "welcome"],
      ["eq", "ref", ""],
    ]);
  });

  it("releases only an unsent claim", async () => {
    const { client, calls } = recordingClient({});
    expect(await supabaseEmailLog(client).release(KEY)).toEqual({ ok: true });
    expect(calls).toContainEqual(["delete"]);
    expect(calls).toContainEqual(["is", "resend_id", null]);
  });

  it("lists the refs already logged, without a query for none", async () => {
    const { client, calls } = recordingClient({ data: [{ ref: "sub_1" }] });
    const store = supabaseEmailLog(client);
    expect(await store.loggedRefs("trial_reminder", [])).toEqual(new Set());
    expect(calls).toEqual([]);
    expect(await store.loggedRefs("trial_reminder", ["sub_1", "sub_2"])).toEqual(new Set(["sub_1"]));
    expect(calls).toContainEqual(["in", "ref", ["sub_1", "sub_2"]]);
    expect(calls).toContainEqual(["eq", "kind", "trial_reminder"]);
  });
});
