/**
 * Ask's store (src/lib/server/ask/store.ts) over a fake supabase-js (`fakeDb.ts`), swapped in through
 * `askStoreDeps`: turns saved as the student and only once per client id, the history read for the
 * board's owner only, what the tutor knows, the memory written by the server alone and only when
 * it changed, and nothing ever thrown.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.LOG_LEVEL = "silent";
});

import { LIVE_MODELS } from "@/lib/live/contracts";
import { skillDef } from "@/lib/learning/contracts";
import { UpstreamError } from "@/lib/server/openrouter";
import {
  askStoreDeps,
  clearLearnerMemory,
  deleteKidMemory,
  deleteLearnerMemory,
  earlierSessionAttempts,
  EMPTY_ASK_CONTEXT,
  fetchKidMemory,
  fetchLearnerMemory,
  firstName,
  LAST_SESSION_GAP_MS,
  loadAskContext,
  readAskHistory,
  readLearnerMemory,
  recentSkillNames,
  rememberFromTurn,
  saveAskTurns,
  turnRows,
} from "../store";
import { eqOf, fakeDb, type FakeAnswer, type FakeDb, type FakeQuery } from "./fakeDb";

const BOARD = "b1000000-0000-4000-8000-000000000001";
const USER = "00000000-0000-4000-8000-000000000001";
const KID = "00000000-0000-4000-8000-000000000002";
const caller = { token: "aaaa.bbbb.cccc", userId: USER };

const real = { ...askStoreDeps };
let userDb: FakeDb;
let serviceDb: FakeDb | null;
let tokens: string[];
const chatJson = vi.fn();

function useDbs(user: (q: FakeQuery) => FakeAnswer | Promise<FakeAnswer>, service?: (q: FakeQuery) => FakeAnswer) {
  userDb = fakeDb(user);
  serviceDb = service ? fakeDb(service) : null;
}

beforeEach(() => {
  tokens = [];
  useDbs(() => ({ data: [] }), () => ({ data: null }));
  askStoreDeps.user = (token: string) => {
    tokens.push(token);
    return userDb.client;
  };
  askStoreDeps.service = () => serviceDb?.client ?? null;
  askStoreDeps.chatJson = chatJson as unknown as typeof askStoreDeps.chatJson;
  askStoreDeps.models = () => ({ askMemory: LIVE_MODELS.askMemory, askMemoryFallback: LIVE_MODELS.askMemoryFallback }) as ReturnType<typeof askStoreDeps.models>;
  chatJson.mockReset();
});

afterEach(() => {
  Object.assign(askStoreDeps, real);
});

// ------------------------------------------------------------------ saving

describe("turnRows", () => {
  it("trims and caps, files the tutor's reply under the student's client id, cleans notes and kinds", () => {
    const rows = turnRows(BOARD, [
      { role: "user", text: "  what is 3/4 + 1/8?  ", clientId: "c_123" },
      { role: "tutor", text: "x".repeat(5000), notes: ["  1 problem couldn't be checked.  ", "", "y".repeat(300)], wrote: ["write_problems", "graph", "graph", "Bad Kind", "<script>"] },
    ]);
    expect(rows).toEqual([
      { board_id: BOARD, role: "user", body: "what is 3/4 + 1/8?", notes: [], wrote: [], client_id: "c_123" },
      { board_id: BOARD, role: "tutor", body: "x".repeat(4000), notes: ["1 problem couldn't be checked.", "y".repeat(200)], wrote: ["write_problems", "graph"], client_id: "c_123:tutor" },
    ]);
  });

  it("leaves out a turn with no text, and a client id the database would refuse", () => {
    const rows = turnRows(BOARD, [
      { role: "user", text: "hi", clientId: "has spaces" },
      { role: "tutor", text: "   " },
      { role: "tutor", text: "Hello!" },
    ]);
    expect(rows).toEqual([
      { board_id: BOARD, role: "user", body: "hi", notes: [], wrote: [], client_id: null },
      { board_id: BOARD, role: "tutor", body: "Hello!", notes: [], wrote: [], client_id: null },
    ]);
  });
});

describe("saveAskTurns", () => {
  const turns = [
    { role: "user" as const, text: "what is 7 x 8?", clientId: "m1" },
    { role: "tutor" as const, text: "What is 7 x 4? Double it!", wrote: ["write_problems"] },
  ];

  it("inserts as the student, skipping duplicates, and answers the ids in order", async () => {
    // answered out of order: the ids still come back in the turns' order
    useDbs(() => ({ data: [{ id: "t-user", client_id: "m1" }, { id: "t-tutor", client_id: "m1:tutor" }].reverse() }));
    expect(await saveAskTurns(caller, BOARD, turns)).toEqual(["t-user", "t-tutor"]);
    expect(tokens).toEqual([caller.token]);
    const [insert] = userDb.calls;
    expect(insert).toMatchObject({ table: "ask_messages", op: "upsert", select: "id,client_id", options: { onConflict: "board_id,client_id", ignoreDuplicates: true }, signal: true });
    // never the owner, the id or the time: the database's
    for (const row of insert.rows as Array<Record<string, unknown>>) expect(Object.keys(row).sort()).toEqual(["board_id", "body", "client_id", "notes", "role", "wrote"]);
  });

  it("a retry: nothing inserted, the ids already saved are read back", async () => {
    useDbs((q) => (q.op === "upsert" ? { data: [] } : { data: [{ id: "old-tutor", client_id: "m1:tutor" }, { id: "old-user", client_id: "m1" }] }));
    expect(await saveAskTurns(caller, BOARD, turns)).toEqual(["old-user", "old-tutor"]);
    const read = userDb.calls[1];
    expect(read).toMatchObject({ table: "ask_messages", op: "select" });
    expect(eqOf(read, "board_id")).toBe(BOARD);
    expect(read.filters).toContainEqual(["client_id", "in", ["m1", "m1:tutor"]]);
  });

  it("turns without a client id: the ids in the order inserted", async () => {
    useDbs(() => ({ data: [{ id: "a", client_id: null }, { id: "b", client_id: null }] }));
    expect(await saveAskTurns(caller, BOARD, [{ role: "user", text: "one" }, { role: "tutor", text: "two" }])).toEqual(["a", "b"]);
  });

  it("null when the insert fails (RLS: not the student's board), when an id never comes back, or when it throws", async () => {
    useDbs(() => ({ error: { code: "42501", message: "new row violates row-level security policy" } }));
    expect(await saveAskTurns(caller, BOARD, turns)).toBeNull();
    useDbs((q) => (q.op === "upsert" ? { data: [] } : { data: [] }));
    expect(await saveAskTurns(caller, BOARD, turns)).toBeNull();
    useDbs(() => new Error("network down"));
    expect(await saveAskTurns(caller, BOARD, turns)).toBeNull();
    askStoreDeps.user = () => {
      throw new Error("bad env");
    };
    expect(await saveAskTurns(caller, BOARD, turns)).toBeNull();
  });

  it("a board id that is not a uuid saves nothing and asks nothing; no text is nothing to save", async () => {
    expect(await saveAskTurns(caller, "local-board", turns)).toBeNull();
    expect(await saveAskTurns(caller, BOARD, [{ role: "user", text: "  " }])).toEqual([]);
    expect(userDb.calls).toEqual([]);
  });
});

// ------------------------------------------------------------------ the history

describe("readAskHistory", () => {
  const rows = [
    { id: "t3", role: "tutor", body: "Nice!", notes: ["note"], wrote: ["graph"], created_at: "2026-10-11T10:00:02Z" },
    { id: "t2", role: "user", body: "2x = 6, so x = 3", notes: [], wrote: [], created_at: "2026-10-11T10:00:01Z" },
  ];

  it("the board's newest turns, oldest first, after checking the board is the caller's", async () => {
    useDbs((q) => (q.table === "whiteboards" ? { data: { id: BOARD } } : { data: rows }));
    const read = await readAskHistory(caller, BOARD);
    expect(read).toEqual({
      kind: "turns",
      turns: [
        { id: "t2", role: "user", text: "2x = 6, so x = 3", notes: [], wrote: [], at: "2026-10-11T10:00:01Z" },
        { id: "t3", role: "tutor", text: "Nice!", notes: ["note"], wrote: ["graph"], at: "2026-10-11T10:00:02Z" },
      ],
    });
    const turns = userDb.calls.find((c) => c.table === "ask_messages")!;
    expect(turns.order).toEqual({ column: "seq", ascending: false });
    expect(turns.limit).toBe(60);
    expect(eqOf(turns, "board_id")).toBe(BOARD);
  });

  it("missing: not the caller's board (RLS shows none), or not a board id at all", async () => {
    useDbs((q) => (q.table === "whiteboards" ? { data: null } : { data: rows }));
    expect(await readAskHistory(caller, BOARD)).toEqual({ kind: "missing" });
    expect(await readAskHistory(caller, "not-a-uuid")).toEqual({ kind: "missing" });
  });

  it("no table yet is no turns; any other failure is failed", async () => {
    useDbs((q) => (q.table === "whiteboards" ? { data: { id: BOARD } } : { error: { code: "PGRST205", message: "Could not find the table" } }));
    expect(await readAskHistory(caller, BOARD)).toEqual({ kind: "turns", turns: [] });
    useDbs((q) => (q.table === "whiteboards" ? { data: { id: BOARD } } : { error: { code: "57014", message: "canceling statement" } }));
    expect(await readAskHistory(caller, BOARD)).toEqual({ kind: "failed" });
    useDbs((q) => (q.table === "whiteboards" ? { error: { code: "PGRST301", message: "JWT expired" } } : { data: [] }));
    expect(await readAskHistory(caller, BOARD)).toEqual({ kind: "failed" });
    useDbs(() => new Error("boom"));
    expect(await readAskHistory(caller, BOARD)).toEqual({ kind: "failed" });
  });
});

// ------------------------------------------------------------------ what the tutor knows

describe("loadAskContext", () => {
  const attempts = [
    { skill: "divide_fractions", outcome: "with_help", lines_written: 3 },
    // a tutor problem never touched says nothing
    { skill: "percents", outcome: "unfinished", lines_written: 0 },
    { skill: "other", outcome: "first_try", lines_written: 2 },
    { skill: "divide_fractions", outcome: "first_try", lines_written: 2 },
    { skill: "times_tables", outcome: "in_progress", lines_written: 1 },
    { skill: "no_such_skill", outcome: "first_try", lines_written: 1 },
  ];

  it("name, grade, course, notes and recent skills, read in parallel as the student", async () => {
    useDbs((q) => {
      if (q.table === "profiles") return { data: { display_name: "Maya Lopez", grade: 6, course: null } };
      if (q.table === "learner_memory") return { data: { notes: ["Likes shorter hints", "Mom helps at night", 7], updated_at: "2026-10-11T09:00:00.123456+00:00" } };
      return { data: attempts };
    });
    expect(await loadAskContext(caller)).toEqual({
      name: "Maya",
      nameWords: ["Maya", "Lopez"],
      grade: 6,
      course: null,
      memory: ["Likes shorter hints"],
      memoryAt: "2026-10-11T09:00:00.123456+00:00",
      recent: ["Dividing fractions", "Times tables"],
    });
    // the notes with their row's stamp: the memory write's compare-and-set
    expect(userDb.calls.find((c) => c.table === "learner_memory")?.select).toBe("notes,updated_at");
    expect(userDb.calls.map((c) => c.table).sort()).toEqual(["learner_memory", "learning_attempts", "profiles"]);
    for (const c of userDb.calls) expect(eqOf(c, "user_id")).toBe(USER);
    expect(userDb.calls.find((c) => c.table === "learning_attempts")?.order).toEqual({ column: "started_at", ascending: false });
  });

  it("an unknown grade or course is none; one read failing leaves the others", async () => {
    useDbs((q) => {
      if (q.table === "profiles") return { data: { display_name: "kid@example.com", grade: 12, course: "algebra1" } };
      if (q.table === "learner_memory") return { error: { code: "PGRST205", message: "no table" } };
      return new Error("timeout");
    });
    expect(await loadAskContext(caller)).toEqual({ name: null, nameWords: [], grade: null, course: "algebra1", memory: [], memoryAt: null, recent: [] });
  });

  it("for the hello (lastSession): only an earlier session's skills — not the board being opened, not the last half hour", async () => {
    const now = Date.parse("2026-10-12T15:00:00Z");
    const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
    const rows = [
      { skill: "add_within_10", outcome: "first_try", lines_written: 2, board_id: BOARD, started_at: at(0.15) },
      { skill: "add_within_20", outcome: "first_try", lines_written: 2, board_id: "b-other", started_at: at(29) },
      { skill: "times_tables", outcome: "with_help", lines_written: 3, board_id: BOARD, started_at: at(24 * 60) },
      { skill: "divide_fractions", outcome: "with_help", lines_written: 3, board_id: null, started_at: at(31) },
      { skill: "percents", outcome: "first_try", lines_written: 1, board_id: "b-other", started_at: "not a time" },
    ];
    expect(earlierSessionAttempts(rows, BOARD, now).map((r) => r.skill)).toEqual(["divide_fractions"]);
    expect(LAST_SESSION_GAP_MS).toBe(30 * 60_000);
    useDbs((q) => (q.table === "learning_attempts" ? { data: rows } : { data: null }));
    expect((await loadAskContext(caller, { lastSession: { boardId: BOARD, now } })).recent).toEqual(["Dividing fractions"]);
    expect(userDb.calls.find((c) => c.table === "learning_attempts")?.select).toBe("skill,outcome,lines_written,board_id,started_at");
    // the ask route's read keeps what they are working on now: context for the answer
    expect((await loadAskContext(caller)).recent).toEqual(["add_within_10", "add_within_20", "times_tables", "divide_fractions", "percents"].map((id) => skillDef(id)!.name));
  });

  it("never throws: the empty context", async () => {
    askStoreDeps.user = () => {
      throw new Error("bad env");
    };
    expect(await loadAskContext(caller)).toEqual(EMPTY_ASK_CONTEXT);
  });

  it("firstName and recentSkillNames", () => {
    expect(firstName("  Zoë  Smith ")).toBe("Zoë");
    expect(firstName("O'Neil")).toBe("O'Neil");
    expect(firstName("kid4")).toBeNull();
    expect(firstName(null)).toBeNull();
    const many = ["add_within_10", "add_within_20", "times_tables", "long_division", "percents", "proportions"].map((skill) => ({ skill, outcome: "first_try", lines_written: 1 }));
    expect(recentSkillNames(many)).toHaveLength(5);
  });
});

// ------------------------------------------------------------------ remembering

describe("rememberFromTurn", () => {
  const AT = "2026-10-11T09:00:00.123456+00:00";
  const exchange = { message: "I always mix up the bottom numbers when I add fractions", reply: "Let's find a common denominator first.", memory: ["Likes shorter hints"], memoryAt: AT };

  it("asks the memory models, then writes the cleaned notes with the service role, only over the row it read", async () => {
    useDbs(() => ({ data: [] }), () => ({ data: [{ user_id: USER }] }));
    chatJson.mockResolvedValue({ data: { notes: ["Likes shorter hints", "Mixes up the bottom numbers when adding fractions", "Their teacher Mrs. Lee says so"] }, model: LIVE_MODELS.askMemory });
    await rememberFromTurn(caller, exchange);
    expect(chatJson).toHaveBeenCalledTimes(1);
    const [primary, fallback, opts] = chatJson.mock.calls[0];
    expect([primary, fallback]).toEqual([LIVE_MODELS.askMemory, LIVE_MODELS.askMemoryFallback]);
    expect(opts.title).toBe("Agathon Live - ask memory");
    expect(JSON.stringify(opts.messages)).toContain("Likes shorter hints");
    expect(JSON.stringify(opts.messages)).toContain("bottom numbers");
    // written by the server, never as the student
    expect(userDb.calls).toEqual([]);
    expect(serviceDb!.calls).toHaveLength(1);
    // compare-and-set: an update of A's row only while its updated_at is the one read
    expect(serviceDb!.calls[0]).toMatchObject({
      table: "learner_memory",
      op: "update",
      select: "user_id",
      signal: true,
      rows: { notes: ["Likes shorter hints", "Mixes up the bottom numbers when adding fractions"] },
    });
    expect(eqOf(serviceDb!.calls[0], "user_id")).toBe(USER);
    expect(eqOf(serviceDb!.calls[0], "updated_at")).toBe(AT);
  });

  it("no row when read: an insert that does nothing when a row has appeared since (never an overwrite)", async () => {
    useDbs(() => ({ data: [] }), () => ({ data: [{ user_id: USER }] }));
    chatJson.mockResolvedValue({ data: { notes: ["Mixes up the bottom numbers when adding fractions"] }, model: LIVE_MODELS.askMemory });
    await rememberFromTurn(caller, { ...exchange, memory: [], memoryAt: null });
    expect(serviceDb!.calls).toHaveLength(1);
    expect(serviceDb!.calls[0]).toMatchObject({
      table: "learner_memory",
      op: "upsert",
      select: "user_id",
      options: { onConflict: "user_id", ignoreDuplicates: true },
      rows: { user_id: USER, notes: ["Mixes up the bottom numbers when adding fractions"] },
    });
  });

  it("the row changed since it was read (a grown-up cleared it, or another turn wrote first): nothing written, nothing retried", async () => {
    // the update matched no row (cleared: gone; another turn: a new updated_at)
    useDbs(() => ({ data: [] }), () => ({ data: [] }));
    chatJson.mockResolvedValue({ data: { notes: ["Likes shorter hints", "Mixes up the bottom numbers when adding fractions"] }, model: LIVE_MODELS.askMemory });
    await expect(rememberFromTurn(caller, exchange)).resolves.toBeUndefined();
    expect(serviceDb!.calls.map((c) => c.op)).toEqual(["update"]);
    // and with no row read, a row there now: the insert does nothing, and that is the end of it
    await expect(rememberFromTurn(caller, { ...exchange, memory: [], memoryAt: null })).resolves.toBeUndefined();
    expect(serviceDb!.calls.map((c) => c.op)).toEqual(["update", "upsert"]);
  });

  it("a trivial exchange asks no model and writes nothing", async () => {
    await rememberFromTurn(caller, { ...exchange, message: "thanks!" });
    await rememberFromTurn(caller, { ...exchange, message: "12" });
    expect(chatJson).not.toHaveBeenCalled();
    expect(serviceDb!.calls).toEqual([]);
  });

  it("unchanged notes write nothing", async () => {
    chatJson.mockResolvedValue({ data: { notes: ["likes shorter hints."] }, model: LIVE_MODELS.askMemory });
    await rememberFromTurn(caller, exchange);
    expect(serviceDb!.calls).toEqual([]);
  });

  it("an update that drops more than 3 notes at once is not written", async () => {
    const memory = ["Likes shorter hints", "Gets stuck on borrowing", "Likes dinosaurs", "Wants to try first", "A picture helps"];
    chatJson.mockResolvedValue({ data: { notes: [] }, model: LIVE_MODELS.askMemory });
    await rememberFromTurn(caller, { ...exchange, memory });
    expect(serviceDb!.calls).toEqual([]);
    chatJson.mockResolvedValue({ data: { notes: memory.slice(2) } });
    await rememberFromTurn(caller, { ...exchange, memory });
    expect(serviceDb!.calls).toHaveLength(1);
  });

  it("never throws: no service role, a model failure, a write failure", async () => {
    askStoreDeps.service = () => null;
    await expect(rememberFromTurn(caller, exchange)).resolves.toBeUndefined();
    expect(chatJson).not.toHaveBeenCalled();

    useDbs(() => ({ data: [] }), () => ({ error: { code: "23514", message: "check" } }));
    askStoreDeps.service = () => serviceDb!.client;
    chatJson.mockRejectedValue(new UpstreamError(504, "slow"));
    await expect(rememberFromTurn(caller, exchange)).resolves.toBeUndefined();
    chatJson.mockResolvedValue({ data: { notes: ["Likes shorter hints", "Likes soccer"] } });
    await expect(rememberFromTurn(caller, exchange)).resolves.toBeUndefined();
    expect(serviceDb!.calls).toHaveLength(1);
  });
});

// ------------------------------------------------------------------ reading and clearing

describe("the memory: read and clear", () => {
  it("the caller's own, with their token", async () => {
    useDbs(() => ({ data: { notes: ["Likes shorter hints", "Lives in Ohio"], updated_at: "2026-10-10T09:00:00Z" } }));
    expect(await fetchLearnerMemory(caller)).toEqual({ notes: ["Likes shorter hints"], updatedAt: "2026-10-10T09:00:00Z" });
    expect(await readLearnerMemory(caller)).toEqual({ notes: ["Likes shorter hints"], updatedAt: "2026-10-10T09:00:00Z" });
    expect(tokens).toEqual([caller.token, caller.token]);
  });

  it("no row is no notes; no table is no notes; a failure is null (read) or empty (readLearnerMemory)", async () => {
    useDbs(() => ({ data: null }));
    expect(await fetchLearnerMemory(caller)).toEqual({ notes: [], updatedAt: null });
    useDbs(() => ({ error: { code: "42P01", message: "relation does not exist" } }));
    expect(await fetchLearnerMemory(caller)).toEqual({ notes: [], updatedAt: null });
    useDbs(() => ({ error: { code: "57014", message: "timeout" } }));
    expect(await fetchLearnerMemory(caller)).toBeNull();
    expect(await readLearnerMemory(caller)).toEqual({ notes: [], updatedAt: null });
  });

  it("clears the caller's own row with their token (the owner's delete policy)", async () => {
    expect(await deleteLearnerMemory(caller)).toBe(true);
    expect(userDb.calls[0]).toMatchObject({ table: "learner_memory", op: "delete" });
    expect(eqOf(userDb.calls[0], "user_id")).toBe(USER);
    useDbs(() => ({ error: { code: "57014", message: "timeout" } }));
    expect(await deleteLearnerMemory(caller)).toBe(false);
    await expect(clearLearnerMemory(caller)).resolves.toBeUndefined();
  });

  it("a kid's, for their grown-up: the service role (the route checked the kid is theirs)", async () => {
    useDbs(() => ({ data: null }), () => ({ data: { notes: ["Likes dinosaurs"], updated_at: null } }));
    expect(await fetchKidMemory(KID)).toEqual({ notes: ["Likes dinosaurs"], updatedAt: null });
    expect(eqOf(serviceDb!.calls[0], "user_id")).toBe(KID);
    expect(await deleteKidMemory(KID)).toBe(true);
    expect(serviceDb!.calls[1]).toMatchObject({ table: "learner_memory", op: "delete" });
    expect(userDb.calls).toEqual([]);
    askStoreDeps.service = () => null;
    expect(await fetchKidMemory(KID)).toBeNull();
    expect(await deleteKidMemory(KID)).toBe(false);
  });
});
