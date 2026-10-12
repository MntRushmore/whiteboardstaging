/**
 * Ask's store against a LIVE Supabase stack (normally the local one), with the real supabase-js:
 * the calls the unit tests fake, as PostgREST and RLS answer them. Opt-in, like
 * src/__tests__/db-rls.integration.test.ts:
 *
 *   RUN_DB_TESTS=1 npx vitest run src/lib/server/ask/__tests__/store.integration.test.ts
 *
 * Needs migration 20261011000000_ask_v2.sql and SUPABASE_SERVICE_ROLE_KEY (two throwaway users are
 * made and deleted). The memory model is faked: no model is called.
 */
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDeleteUser, createSupabaseHttp, loadDotEnvLocal, provisionUser, resolveSupabaseEnv, waitForHealth } from "../../../../../scripts/lib/supabaseHttp.mjs";
import { askStoreDeps, deleteKidMemory, deleteLearnerMemory, fetchKidMemory, fetchLearnerMemory, loadAskContext, readAskHistory, rememberFromTurn, saveAskTurns } from "../store";

const enabled = process.env.RUN_DB_TESTS === "1";
const suite = enabled ? describe : describe.skip;

suite("Ask store (live Supabase)", () => {
  const real = { ...askStoreDeps };
  let url = "";
  let anonKey = "";
  let serviceKey = "";
  const users: Array<{ accessToken: string; userId: string }> = [];
  let boardA = "";
  let boardB = "";

  beforeAll(async () => {
    loadDotEnvLocal();
    const env = resolveSupabaseEnv(process.env);
    if (!env.url || !env.anonKey || !env.serviceKey) throw new Error("RUN_DB_TESTS=1 needs NEXT_PUBLIC_SUPABASE_URL, the anon key and SUPABASE_SERVICE_ROLE_KEY");
    url = env.url;
    anonKey = env.anonKey;
    serviceKey = env.serviceKey;
    if (!(await waitForHealth(url, { timeoutMs: 60_000, anonKey }))) throw new Error(`Supabase at ${url} is not healthy`);
    const tag = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    for (const who of ["a", "b"]) {
      users.push(await provisionUser({ url, anonKey, serviceKey, email: `ask-store-${tag}-${who}@example.com`, password: `Ask-${crypto.randomUUID()}` }));
    }
    for (const [i, u] of users.entries()) {
      const http = createSupabaseHttp({ url, anonKey, accessToken: u.accessToken, userId: u.userId });
      const res = await http.rest("POST", "whiteboards", { body: { title: "ask store", data: {}, user_id: u.userId }, prefer: "return=representation" });
      const id = (res.body as Array<{ id: string }>)[0]?.id;
      if (!id) throw new Error(`no board: ${JSON.stringify(res.body)}`);
      if (i === 0) boardA = id;
      else boardB = id;
    }
    const opts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
    askStoreDeps.user = (token: string) => createClient(url, anonKey, { ...opts, global: { headers: { Authorization: `Bearer ${token}` } } });
    askStoreDeps.service = () => createClient(url, serviceKey, opts);
  }, 120_000);

  afterAll(async () => {
    Object.assign(askStoreDeps, real);
    for (const u of users) await adminDeleteUser(url, serviceKey, u.userId);
  }, 60_000);

  const a = () => ({ token: users[0].accessToken, userId: users[0].userId });
  const b = () => ({ token: users[1].accessToken, userId: users[1].userId });

  it("saves an exchange once, however often it is retried, and reads it back oldest first", async () => {
    const turns = [
      { role: "user" as const, text: "what is 7 x 8?", clientId: "it_m1" },
      { role: "tutor" as const, text: "What is 7 x 4? Now double it.", notes: ["1 problem couldn't be checked."], wrote: ["write_problems"] },
    ];
    const first = await saveAskTurns(a(), boardA, turns);
    expect(first).toHaveLength(2);
    const retry = await saveAskTurns(a(), boardA, turns);
    expect(retry).toEqual(first);
    const read = await readAskHistory(a(), boardA);
    expect(read.kind).toBe("turns");
    if (read.kind !== "turns") return;
    expect(read.turns.map((t) => [t.id, t.role, t.text])).toEqual([
      [first![0], "user", "what is 7 x 8?"],
      [first![1], "tutor", "What is 7 x 4? Now double it."],
    ]);
    expect(read.turns[1]).toMatchObject({ notes: ["1 problem couldn't be checked."], wrote: ["write_problems"] });
  });

  it("B can neither save on A's board nor read it", async () => {
    expect(await saveAskTurns(b(), boardA, [{ role: "user", text: "hi there" }])).toBeNull();
    expect(await readAskHistory(b(), boardA)).toEqual({ kind: "missing" });
    expect(await readAskHistory(b(), boardB)).toEqual({ kind: "turns", turns: [] });
  });

  it("remembers through the service role, the owner reads and clears; a grown-up's path reads and clears too", async () => {
    askStoreDeps.chatJson = (async () => ({ data: { notes: ["Gets stuck on 7 x 8", "Mom helps at night"] }, model: "fake" })) as unknown as typeof askStoreDeps.chatJson;
    try {
      await rememberFromTurn(a(), { message: "I always forget 7 x 8", reply: "Try 7 x 4, then double it.", memory: [], memoryAt: null });
    } finally {
      askStoreDeps.chatJson = real.chatJson;
    }
    const memory = await fetchLearnerMemory(a());
    expect(memory?.notes).toEqual(["Gets stuck on 7 x 8"]);
    expect(typeof memory?.updatedAt).toBe("string");
    expect((await fetchLearnerMemory(b()))?.notes).toEqual([]);
    expect((await fetchKidMemory(a().userId))?.notes).toEqual(["Gets stuck on 7 x 8"]);

    const ctx = await loadAskContext(a());
    expect(ctx.memory).toEqual(["Gets stuck on 7 x 8"]);

    // B's token cannot clear A's row: the delete answers fine and touches nothing
    expect(await deleteLearnerMemory({ token: b().token, userId: a().userId })).toBe(true);
    expect((await fetchLearnerMemory(a()))?.notes).toEqual(["Gets stuck on 7 x 8"]);
    expect(await deleteLearnerMemory(a())).toBe(true);
    expect(await fetchLearnerMemory(a())).toEqual({ notes: [], updatedAt: null });
    expect(await deleteKidMemory(a().userId)).toBe(true);
  });

  it("compare-and-set: a clear made while a turn is in flight is never undone, and two turns never clobber each other", async () => {
    const notesFrom = (notes: string[]) => (async () => ({ data: { notes }, model: "fake" })) as unknown as typeof askStoreDeps.chatJson;
    const turn = (memory: string[], memoryAt: string | null) => rememberFromTurn(a(), { message: "I always forget 7 x 8 and 6 x 7", reply: "Try 7 x 4, then double it.", memory, memoryAt });
    try {
      askStoreDeps.chatJson = notesFrom(["Gets stuck on 7 x 8"]);
      await turn([], null);
      // a turn reads the notes (with their stamp)...
      const read = await loadAskContext(a());
      expect(read.memory).toEqual(["Gets stuck on 7 x 8"]);
      expect(typeof read.memoryAt).toBe("string");
      // ...a grown-up clears them while it is in flight...
      expect(await deleteLearnerMemory(a())).toBe(true);
      // ...and the turn's update finds no row with that stamp: nothing comes back
      askStoreDeps.chatJson = notesFrom(["Gets stuck on 7 x 8", "Gets stuck on 6 x 7"]);
      await turn(read.memory, read.memoryAt);
      expect(await fetchLearnerMemory(a())).toEqual({ notes: [], updatedAt: null });

      // two turns read the same row; the first to write wins, the second is skipped
      askStoreDeps.chatJson = notesFrom(["Gets stuck on 7 x 8"]);
      await turn([], null);
      const both = await loadAskContext(a());
      askStoreDeps.chatJson = notesFrom(["Gets stuck on 7 x 8", "Likes animal word problems"]);
      await turn(both.memory, both.memoryAt);
      askStoreDeps.chatJson = notesFrom(["Gets stuck on 7 x 8", "Gets stuck on 6 x 7"]);
      await turn(both.memory, both.memoryAt);
      expect((await fetchLearnerMemory(a()))?.notes).toEqual(["Gets stuck on 7 x 8", "Likes animal word problems"]);
      // a turn that read no row never overwrites the row there now
      askStoreDeps.chatJson = notesFrom(["Gets stuck on 6 x 7"]);
      await turn([], null);
      expect((await fetchLearnerMemory(a()))?.notes).toEqual(["Gets stuck on 7 x 8", "Likes animal word problems"]);
    } finally {
      askStoreDeps.chatJson = real.chatJson;
      await deleteLearnerMemory(a());
    }
  });
});
