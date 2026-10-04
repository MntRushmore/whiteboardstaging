/**
 * The learning store against a fake Supabase client: how records become rows and back, what is
 * cleaned, how batches are split and ordered, and what each failure is called (the tracker retries
 * only "network" and "unknown").
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { COURSE_IDS } from "@/lib/onboarding/courseIds";
import { ATTEMPT_ORIGINS, LEARNING_LIMITS, MISTAKE_KINDS, OUTCOMES, SKILL_IDS, type AttemptRecord } from "../contracts";

type Row = Record<string, unknown>;
interface Reply {
  data?: unknown;
  error?: { code?: string; message?: string } | null;
  status?: number;
}
interface Query {
  table: string;
  columns: string;
  eq: Array<[string, unknown]>;
  gte: Array<[string, unknown]>;
  in: Array<[string, unknown[]]>;
  order: Array<[string, boolean]>;
  range?: [number, number];
}

const fake = vi.hoisted(() => ({
  session: { data: { session: { user: { id: "u-1" } } }, error: null } as unknown,
  getSessionThrows: null as Error | null,
  /** (rows, options) -> reply for each upsert */
  upsert: (() => ({ status: 201 })) as (rows: Row[], opts: unknown) => Reply,
  /** query -> reply for each select */
  select: (() => ({ data: [], status: 200 })) as (q: unknown) => Reply,
  upserts: [] as Array<{ table: string; rows: Row[]; opts: unknown }>,
  selects: [] as unknown[],
}));

vi.mock("@/lib/supabase", () => {
  function builder(table: string, columns: string) {
    const q = { table, columns, eq: [] as unknown[], gte: [] as unknown[], in: [] as unknown[], order: [] as unknown[], range: undefined as unknown };
    const b = {
      eq: (c: string, v: unknown) => (q.eq.push([c, v]), b),
      gte: (c: string, v: unknown) => (q.gte.push([c, v]), b),
      in: (c: string, v: unknown[]) => (q.in.push([c, [...v]]), b),
      order: (c: string, o: { ascending: boolean }) => (q.order.push([c, o.ascending]), b),
      range: (from: number, to: number) => ((q.range = [from, to]), b),
      then: (resolve: (r: unknown) => unknown, reject: (e: unknown) => unknown) => {
        fake.selects.push(q);
        const r = fake.select(q);
        return Promise.resolve({ data: r.data ?? null, error: r.error ?? null, status: r.status ?? 200 }).then(resolve, reject);
      },
    };
    return b;
  }
  return {
    supabase: {
      auth: {
        getSession: () => (fake.getSessionThrows ? Promise.reject(fake.getSessionThrows) : Promise.resolve(fake.session)),
      },
      from: (table: string) => ({
        upsert: (rows: Row[], opts: unknown) => {
          const copy = rows.map((r) => ({ ...r }));
          fake.upserts.push({ table, rows: copy, opts });
          const r = fake.upsert(copy, opts);
          return Promise.resolve({ data: null, error: r.error ?? null, status: r.status ?? (r.error ? 400 : 201) });
        },
        select: (columns: string) => builder(table, columns),
      }),
    },
  };
});

// Imported after the mock; a fresh module per test (the store remembers saved ids per page).
let store: typeof import("../store");

const NOW = Date.parse("2026-10-04T12:00:00Z");
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function record(n: number, over: Partial<AttemptRecord> = {}): AttemptRecord {
  return {
    id: uuid(n),
    boardId: "b0000000-0000-4000-8000-000000000001",
    problemLatex: "2x+3=11",
    skill: "two_step_equations",
    course: "algebra1",
    origin: "student",
    parentId: null,
    outcome: "first_try",
    linesWritten: 3,
    linesRight: 3,
    linesRinged: 0,
    hints: 0,
    tutorSteps: 0,
    solves: 0,
    asks: 0,
    mistakes: {},
    activeMs: 42_000,
    startedAt: "2026-10-04T11:00:00.000Z",
    updatedAt: "2026-10-04T11:05:00.000Z",
    finishedAt: "2026-10-04T11:05:00.000Z",
    ...over,
  };
}

const ids = (rows: Row[]) => rows.map((r) => r.id);
const failWith = (code: string, status = 400): Reply => ({ error: { code, message: `boom ${code}` }, status });

async function caught(p: Promise<unknown>): Promise<InstanceType<typeof store.LearningStoreError>> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(store.LearningStoreError);
    return e as InstanceType<typeof store.LearningStoreError>;
  }
  throw new Error("expected a LearningStoreError");
}

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  fake.session = { data: { session: { user: { id: "u-1" } } }, error: null };
  fake.getSessionThrows = null;
  fake.upsert = () => ({ status: 201 });
  fake.select = () => ({ data: [], status: 200 });
  fake.upserts = [];
  fake.selects = [];
  store = await import("../store");
});

// ------------------------------------------------------------------ saving

describe("saveAttempts: records to rows", () => {
  it("writes snake_case rows by id, without the columns the database owns", async () => {
    await store.saveAttempts([record(1, { mistakes: { sign: 2 } })]);
    expect(fake.upserts).toHaveLength(1);
    const { table, rows, opts } = fake.upserts[0];
    expect(table).toBe("learning_attempts");
    expect(opts).toEqual({ onConflict: "id" });
    expect(rows[0]).toEqual({
      id: uuid(1),
      board_id: "b0000000-0000-4000-8000-000000000001",
      problem_latex: "2x+3=11",
      skill: "two_step_equations",
      course: "algebra1",
      origin: "student",
      parent_id: null,
      outcome: "first_try",
      lines_written: 3,
      lines_right: 3,
      lines_ringed: 0,
      hints: 0,
      tutor_steps: 0,
      solves: 0,
      asks: 0,
      mistakes: { sign: 2 },
      active_ms: 42_000,
      started_at: "2026-10-04T11:00:00.000Z",
      finished_at: "2026-10-04T11:05:00.000Z",
    });
    for (const owned of ["user_id", "created_at", "updated_at"]) expect(rows[0]).not.toHaveProperty(owned);
  });

  it("clamps counts, active time and mistakes to what the database takes", async () => {
    await store.saveAttempts([
      record(1, {
        linesWritten: -3,
        linesRight: 40_000,
        linesRinged: Number.NaN,
        hints: 2.6,
        tutorSteps: Infinity,
        activeMs: 5 * 60 * 60_000,
        mistakes: { sign: 12_000, arithmetic: 0, fractions: 1.4, nope: 3 } as AttemptRecord["mistakes"],
      }),
      record(2, { activeMs: -10 }),
    ]);
    const [a, b] = fake.upserts[0].rows;
    expect([a.lines_written, a.lines_right, a.lines_ringed, a.hints, a.tutor_steps]).toEqual([0, LEARNING_LIMITS.maxCount, 0, 3, LEARNING_LIMITS.maxCount]);
    expect(a.active_ms).toBe(LEARNING_LIMITS.maxActiveMs);
    expect(a.mistakes).toEqual({ sign: 9999, fractions: 1 });
    expect(b.active_ms).toBe(0);
  });

  it("cuts the problem to 500 characters as Postgres counts them, and makes it text Postgres takes", async () => {
    const long = "😀".repeat(600); // 1,200 UTF-16 units, 600 code points
    await store.saveAttempts([record(1, { problemLatex: long }), record(2, { problemLatex: "  x\u0000+1 = \ud800 2  " })]);
    const [a, b] = fake.upserts[0].rows;
    expect(Array.from(a.problem_latex as string)).toHaveLength(LEARNING_LIMITS.problemLatex);
    expect(a.problem_latex).toBe("😀".repeat(500));
    expect(b.problem_latex).toBe("x+1 = � 2");
  });

  it("files an unknown skill under other and forgets what it cannot store", async () => {
    await store.saveAttempts([
      record(1, {
        skill: "quantum_physics" as AttemptRecord["skill"],
        course: "calc" as AttemptRecord["course"],
        boardId: "not-a-board",
        parentId: uuid(1),
        finishedAt: "yesterday-ish",
      }),
    ]);
    const [row] = fake.upserts[0].rows;
    expect(row).toMatchObject({ skill: "other", course: null, board_id: null, parent_id: null, finished_at: null });
  });

  it("keeps the last state of an attempt that is in a batch twice", async () => {
    await store.saveAttempts([record(1, { outcome: "in_progress" }), record(2), record(1, { outcome: "with_help", hints: 2 })]);
    const rows = fake.upserts[0].rows;
    expect(ids(rows)).toEqual([uuid(2), uuid(1)]);
    expect(rows[1]).toMatchObject({ outcome: "with_help", hints: 2 });
  });

  it("skips records nothing of which can be saved, saves the rest, then says invalid", async () => {
    const e = await caught(
      store.saveAttempts([
        record(1),
        record(2, { id: "nope" }),
        record(3, { outcome: "done" as AttemptRecord["outcome"] }),
        record(4, { origin: "homework" as AttemptRecord["origin"] }),
        record(5, { problemLatex: "   " }),
        record(6, { startedAt: "2025-12-31T23:00:00Z" }),
        record(7, { startedAt: "garbage" }),
        record(8),
      ]),
    );
    expect(e.code).toBe("invalid");
    expect(ids(fake.upserts[0].rows)).toEqual([uuid(1), uuid(8)]);
  });

  it("does nothing for an empty batch", async () => {
    fake.getSessionThrows = new Error("should not be asked");
    await store.saveAttempts([]);
    expect(fake.upserts).toEqual([]);
  });
});

describe("saveAttempts: batches", () => {
  it("upserts in chunks of at most 200", async () => {
    await store.saveAttempts(Array.from({ length: 450 }, (_, i) => record(i + 1)));
    expect(fake.upserts.map((u) => u.rows.length)).toEqual([200, 200, 50]);
    expect(new Set(fake.upserts.flatMap((u) => ids(u.rows))).size).toBe(450);
  });

  it("writes an attempt before the ones that follow it", async () => {
    await store.saveAttempts([
      record(3, { origin: "now_you_try", parentId: uuid(2) }),
      record(2, { origin: "now_you_try", parentId: uuid(1) }),
      record(1, { outcome: "tutor_solved" }),
      record(4),
    ]);
    expect(fake.upserts.map((u) => ids(u.rows))).toEqual([[uuid(1), uuid(4)], [uuid(2)], [uuid(3)]]);
    expect(fake.selects).toEqual([]); // every parent was in the batch: nothing to look up
  });

  it("drops the link to an attempt that was never saved, keeps a saved one, and asks only once", async () => {
    fake.select = (q) => {
      const query = q as Query;
      const asked = query.in[0]?.[1] ?? [];
      return { data: asked.filter((id) => id === uuid(10)).map((id) => ({ id })), status: 200 };
    };
    await store.saveAttempts([
      record(1, { origin: "now_you_try", parentId: uuid(10) }),
      record(2, { origin: "now_you_try", parentId: uuid(11) }),
    ]);
    expect(fake.selects).toHaveLength(1);
    expect((fake.selects[0] as Query).in).toEqual([["id", [uuid(10), uuid(11)]]]);
    expect(fake.upserts[0].rows.map((r) => r.parent_id)).toEqual([uuid(10), null]);

    await store.saveAttempts([record(1, { origin: "now_you_try", parentId: uuid(10), outcome: "with_help" })]);
    expect(fake.selects).toHaveLength(1); // uuid(10) is known to exist now
    await store.saveAttempts([record(5, { origin: "now_you_try", parentId: uuid(1) })]);
    expect(fake.selects).toHaveLength(1); // saved by this page a moment ago
  });

  it("isolates a row the database refuses and saves every other one", async () => {
    const bad = uuid(37);
    fake.upsert = (rows) => (rows.some((r) => r.id === bad) ? failWith("23514") : { status: 201 });
    const e = await caught(store.saveAttempts(Array.from({ length: 64 }, (_, i) => record(i + 1))));
    expect(e.code).toBe("invalid");
    expect(e.dbCode).toBe("23514");
    const saved = fake.upserts.filter((u) => !u.rows.some((r) => r.id === bad)).flatMap((u) => ids(u.rows));
    expect(new Set(saved).size).toBe(63);
    expect(fake.upserts.length).toBeLessThanOrEqual(1 + 2 * Math.ceil(Math.log2(64))); // halving, not one request per row
  });

  it("keeps the followers of a refused attempt, without the link", async () => {
    fake.upsert = (rows) => (rows.some((r) => r.id === uuid(1)) ? failWith("23514") : { status: 201 });
    const e = await caught(store.saveAttempts([record(1), record(2, { origin: "now_you_try", parentId: uuid(1) })]));
    expect(e.code).toBe("invalid");
    const child = fake.upserts.find((u) => u.rows[0].id === uuid(2));
    expect(child?.rows[0].parent_id).toBeNull();
  });

  it("stops at the first failure a retry could fix, and throws it", async () => {
    let n = 0;
    fake.upsert = () => (++n === 2 ? { error: { message: "TypeError: Failed to fetch", code: "" }, status: 0 } : { status: 201 });
    const e = await caught(store.saveAttempts(Array.from({ length: 450 }, (_, i) => record(i + 1))));
    expect(e.code).toBe("network");
    expect(fake.upserts).toHaveLength(2);
  });
});

describe("error codes", () => {
  const cases: Array<[string, Reply, string]> = [
    ["table missing (PostgREST 12)", failWith("PGRST205", 404), "unavailable"],
    ["table missing (Postgres)", failWith("42P01", 404), "unavailable"],
    ["a column missing", failWith("PGRST204", 400), "unavailable"],
    ["JWT expired", failWith("PGRST301", 401), "unauthorized"],
    ["401 with no code", { error: { message: "Unauthorized" }, status: 401 }, "unauthorized"],
    ["RLS refused (another user's board)", failWith("42501", 403), "unauthorized"],
    ["a check constraint", failWith("23514"), "invalid"],
    ["a foreign key", failWith("23503", 409), "invalid"],
    ["a value out of range", failWith("22003"), "invalid"],
    ["no answer", { error: { message: "TypeError: Load failed", code: "" }, status: 0 }, "network"],
    ["gateway timeout", { error: { message: "upstream timeout" }, status: 504 }, "network"],
    ["database starting", failWith("PGRST002", 503), "network"],
    ["statement timeout", failWith("57014", 500), "network"],
    ["too many requests", { error: { message: "slow down" }, status: 429 }, "network"],
    ["deadlock", failWith("40P01", 500), "network"],
    ["anything else", failWith("XX000", 500), "unknown"],
  ];
  for (const [name, reply, code] of cases) {
    it(`${name} -> ${code}`, async () => {
      fake.upsert = () => reply;
      const e = await caught(store.saveAttempts([record(1)]));
      expect(e.code).toBe(code);
      expect(e.message).toMatch(/learning attempt/);
    });
  }

  it("signed out: unauthorized, and nothing is sent", async () => {
    fake.session = { data: { session: null }, error: null };
    expect((await caught(store.saveAttempts([record(1)]))).code).toBe("unauthorized");
    expect((await caught(store.loadAttempts())).code).toBe("unauthorized");
    expect(fake.upserts).toEqual([]);
    expect(fake.selects).toEqual([]);
  });

  it("a session that could not be refreshed for lack of network is a network failure", async () => {
    fake.session = { data: { session: null }, error: { name: "AuthRetryableFetchError", status: 0, message: "Failed to fetch" } };
    expect((await caught(store.saveAttempts([record(1)]))).code).toBe("network");
    fake.session = { data: { session: null }, error: { name: "AuthApiError", status: 400, message: "Invalid Refresh Token" } };
    expect((await caught(store.saveAttempts([record(1)]))).code).toBe("unauthorized");
    fake.getSessionThrows = new Error("storage unavailable");
    expect((await caught(store.saveAttempts([record(1)]))).code).toBe("network");
  });

  it("LearningStoreError carries its code, status and database code", () => {
    const e = new store.LearningStoreError("invalid", "bad", { status: 400, dbCode: "23514" });
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("LearningStoreError");
    expect([e.code, e.status, e.dbCode, e.message]).toEqual(["invalid", 400, "23514", "bad"]);
  });
});

// ------------------------------------------------------------------ loading

function dbRow(n: number, over: Row = {}): Row {
  return {
    id: uuid(n),
    board_id: null,
    problem_latex: "x+1=2",
    skill: "one_step_equations",
    course: "algebra1",
    origin: "practice",
    parent_id: null,
    outcome: "self_corrected",
    lines_written: 2,
    lines_right: 2,
    lines_ringed: 1,
    hints: 0,
    tutor_steps: 0,
    solves: 0,
    asks: 1,
    mistakes: { sign: 1 },
    active_ms: 30_000,
    started_at: "2026-10-03T10:00:00.123456+00:00",
    updated_at: "2026-10-03T10:02:00+00:00",
    finished_at: "2026-10-03T10:02:00+00:00",
    ...over,
  };
}

describe("loadAttempts", () => {
  it("reads the student's own rows from the last 120 days, newest first, and maps them", async () => {
    fake.select = () => ({ data: [dbRow(1)], status: 200 });
    const out = await store.loadAttempts();
    const q = fake.selects[0] as Query;
    expect(q.table).toBe("learning_attempts");
    expect(q.columns.split(",")).toEqual(expect.arrayContaining(["id", "problem_latex", "lines_written", "mistakes", "started_at", "updated_at", "finished_at"]));
    expect(q.columns).not.toContain("user_id");
    expect(q.eq).toEqual([["user_id", "u-1"]]);
    expect(q.gte).toEqual([["started_at", new Date(NOW - 120 * 86_400_000).toISOString()]]);
    expect(q.order).toEqual([
      ["started_at", false],
      ["id", false],
    ]);
    expect(q.range).toEqual([0, 999]);
    expect(out).toEqual<AttemptRecord[]>([
      {
        id: uuid(1),
        boardId: null,
        problemLatex: "x+1=2",
        skill: "one_step_equations",
        course: "algebra1",
        origin: "practice",
        parentId: null,
        outcome: "self_corrected",
        linesWritten: 2,
        linesRight: 2,
        linesRinged: 1,
        hints: 0,
        tutorSteps: 0,
        solves: 0,
        asks: 1,
        mistakes: { sign: 1 },
        activeMs: 30_000,
        startedAt: "2026-10-03T10:00:00.123Z",
        updatedAt: "2026-10-03T10:02:00.000Z",
        finishedAt: "2026-10-03T10:02:00.000Z",
      },
    ]);
  });

  it("reads defensively: an unknown skill is other, a row with an unknown outcome or origin is left out", async () => {
    fake.select = () => ({
      data: [
        dbRow(1, { skill: "skill_from_the_future", course: "calc", mistakes: { sign: 2, nope: 4, fractions: 0 }, board_id: "b0000000-0000-4000-8000-000000000001" }),
        dbRow(2, { outcome: "aced_it" }),
        dbRow(3, { origin: "homework" }),
        dbRow(4, { started_at: null }),
        dbRow(5, { updated_at: null, finished_at: null, lines_written: "7", hints: null, mistakes: [] }),
        null,
        { nope: true },
      ],
      status: 200,
    });
    const out = await store.loadAttempts();
    expect(out.map((r) => r.id)).toEqual([uuid(1), uuid(5)]);
    expect(out[0]).toMatchObject({ skill: "other", course: null, mistakes: { sign: 2 }, boardId: "b0000000-0000-4000-8000-000000000001" });
    expect(out[1]).toMatchObject({ updatedAt: out[1].startedAt, finishedAt: null, linesWritten: 7, hints: 0, mistakes: {} });
  });

  it("pages under PostgREST's 1,000-row cap up to the limit, once per row", async () => {
    const all = Array.from({ length: 2600 }, (_, i) => dbRow(i + 1));
    let call = 0;
    fake.select = (q) => {
      const [from, to] = (q as Query).range ?? [0, 0];
      call++;
      // a row saved between the first and second page pushes every later row down by one
      const shift = call >= 2 ? 1 : 0;
      const source = shift ? [dbRow(9999), ...all] : all;
      return { data: source.slice(from, to + 1), status: 200 };
    };
    const out = await store.loadAttempts({ limit: 2500 });
    expect((fake.selects as Query[]).map((q) => q.range)).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2500],
    ]);
    expect(out).toHaveLength(2500);
    expect(new Set(out.map((r) => r.id)).size).toBe(2500);
  });

  it("stops at a short page and honours sinceDays and limit", async () => {
    fake.select = () => ({ data: [dbRow(1), dbRow(2), dbRow(3)], status: 200 });
    expect(await store.loadAttempts({ sinceDays: 7, limit: 2 })).toHaveLength(2);
    const q = fake.selects[0] as Query;
    expect(q.gte).toEqual([["started_at", new Date(NOW - 7 * 86_400_000).toISOString()]]);
    expect(q.range).toEqual([0, 1]);
    fake.selects = [];
    expect(await store.loadAttempts({ limit: 50 })).toHaveLength(3);
    expect(fake.selects).toHaveLength(1);
    fake.selects = [];
    expect(await store.loadAttempts({ limit: 0 })).toEqual([]);
    expect(fake.selects).toEqual([]);
  });

  it("never asks for rows from before the record began", async () => {
    await store.loadAttempts({ sinceDays: Infinity });
    expect((fake.selects[0] as Query).gte).toEqual([["started_at", "2026-01-01T00:00:00.000Z"]]);
  });

  it("is empty when the table is not there, and throws anything else", async () => {
    fake.select = () => failWith("PGRST205", 404);
    expect(await store.loadAttempts()).toEqual([]);
    fake.select = () => failWith("42P01", 404);
    expect(await store.loadAttempts()).toEqual([]);
    fake.select = () => ({ error: { message: "TypeError: Failed to fetch", code: "" }, status: 0 });
    const e = await caught(store.loadAttempts());
    expect(e.code).toBe("network");
    expect(e.message).toMatch(/learning record/);
    fake.select = () => failWith("42501", 403);
    expect((await caught(store.loadAttempts())).code).toBe("unauthorized");
  });
});

// ------------------------------------------------------------------ the database agrees with the contract

describe("the migration's lists and limits match the contract", () => {
  const sql = readFileSync(resolve(__dirname, "../../../../supabase/migrations/20261004000000_learning.sql"), "utf8");
  /** the quoted values of the first `in (...)` after `marker` */
  const listAfter = (marker: string): string[] => {
    const at = sql.indexOf(marker);
    expect(at, marker).toBeGreaterThan(-1);
    const list = /in \(([^)]*)\)/.exec(sql.slice(at))?.[1] ?? "";
    return [...list.matchAll(/'([^']*)'/g)].map((m) => m[1]);
  };

  it("course, origin, outcome and mistake kinds are the code's lists (a new value needs a migration first)", () => {
    expect(listAfter("constraint learning_attempts_course_known")).toEqual([...COURSE_IDS]);
    expect(listAfter("constraint learning_attempts_origin_known")).toEqual([...ATTEMPT_ORIGINS]);
    expect(listAfter("constraint learning_attempts_outcome_known")).toEqual([...OUTCOMES]);
    expect(listAfter("if k not in")).toEqual([...MISTAKE_KINDS]);
  });

  it("every skill id fits the skill format", () => {
    const format = /skill ~ '([^']+)'/.exec(sql)?.[1];
    expect(format).toBe("^[a-z0-9_]{1,40}$");
    for (const id of SKILL_IDS) expect(id).toMatch(new RegExp(format ?? "^$"));
  });

  it("the limits are LEARNING_LIMITS", () => {
    expect(sql).toContain(`char_length(problem_latex) between 1 and ${LEARNING_LIMITS.problemLatex}`);
    expect(sql).toContain(`active_ms between 0 and ${LEARNING_LIMITS.maxActiveMs}`);
    expect(sql.match(/between 0 and 32767/g)).toHaveLength(7);
    expect(LEARNING_LIMITS.maxCount).toBe(32_767);
    expect(sql).toContain("'^(0|[1-9][0-9]{0,3})$'"); // a mistake count: 0..9999, as LearnerHintSchema
  });
});
