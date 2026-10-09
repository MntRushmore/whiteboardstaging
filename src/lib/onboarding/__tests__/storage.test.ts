/**
 * Where onboarding keeps its state: the profile (read with RLS, written only through the
 * save_onboarding RPC), the first board (an ordinary insert) and this device (localStorage).
 */
import { describe, expect, it } from "vitest";
import {
  clearTourMarker,
  doneKey,
  isGuidedBoard,
  readLocalDone,
  readTourMarker,
  tourKey,
  writeLocalDone,
  writeTourMarker,
  type TourMarker,
} from "../marker";
import { planKey, readPlanMarker, writePlanMarker } from "../planMarker";
import { createFirstBoard, fetchOnboardingProfile, saveOnboarding, type OnboardingClient } from "../storage";

// ---------------------------------------------------------------- the profile, via a fake client

type Reply = { data: unknown; error: { message?: string; code?: string } | null };

function fakeClient(replies: { select?: Reply | Error; rpc?: Reply | Error; insert?: Reply | Error }) {
  const calls: Array<{ op: string; args: unknown[] }> = [];
  const settle = (r: Reply | Error | undefined) => (r instanceof Error ? Promise.reject(r) : Promise.resolve(r ?? { data: null, error: null }));
  const client: OnboardingClient = {
    from(table) {
      return {
        select(columns) {
          return {
            eq(column, value) {
              return {
                maybeSingle() {
                  calls.push({ op: "select", args: [table, columns, column, value] });
                  return settle(replies.select) as PromiseLike<{ data: Record<string, unknown> | null; error: null }>;
                },
              };
            },
          };
        },
        insert(rows) {
          return {
            select(columns) {
              return {
                single() {
                  calls.push({ op: "insert", args: [table, rows, columns] });
                  return settle(replies.insert) as PromiseLike<{ data: Record<string, unknown> | null; error: null }>;
                },
              };
            },
          };
        },
      };
    },
    rpc(fn, args) {
      calls.push({ op: "rpc", args: [fn, args] });
      return settle(replies.rpc);
    },
  };
  return { client, calls };
}

describe("reading the profile", () => {
  it("reads course, grade and onboarded_at of the student's own row", async () => {
    const { client, calls } = fakeClient({ select: { data: { course: "geometry", grade: null, onboarded_at: null }, error: null } });
    expect(await fetchOnboardingProfile(client, "u1")).toEqual({ ok: true, value: { course: "geometry", grade: null, onboarded_at: null } });
    expect(calls).toEqual([{ op: "select", args: ["profiles", "course, grade, onboarded_at", "user_id", "u1"] }]);
  });

  it("reads a grade, Kindergarten (0) included", async () => {
    const third = fakeClient({ select: { data: { course: "other", grade: 3, onboarded_at: null }, error: null } });
    expect(await fetchOnboardingProfile(third.client, "u1")).toEqual({ ok: true, value: { course: "other", grade: 3, onboarded_at: null } });
    const k = fakeClient({ select: { data: { course: "other", grade: 0, onboarded_at: null }, error: null } });
    expect(await fetchOnboardingProfile(k.client, "u1")).toEqual({ ok: true, value: { course: "other", grade: 0, onboarded_at: null } });
  });

  it("no row is null; an unknown course or grade reads as none", async () => {
    expect(await fetchOnboardingProfile(fakeClient({ select: { data: null, error: null } }).client, "u1")).toEqual({ ok: true, value: null });
    const odd = fakeClient({ select: { data: { course: "astrology", grade: 12, onboarded_at: "2026-09-28T00:00:00Z" }, error: null } });
    expect(await fetchOnboardingProfile(odd.client, "u1")).toEqual({ ok: true, value: { course: null, grade: null, onboarded_at: "2026-09-28T00:00:00Z" } });
    for (const grade of [-1, 2.5, "3", 9]) {
      const bad = fakeClient({ select: { data: { course: "other", grade, onboarded_at: null }, error: null } });
      expect(await fetchOnboardingProfile(bad.client, "u1")).toEqual({ ok: true, value: { course: "other", grade: null, onboarded_at: null } });
    }
  });

  it("a database without the migration (42703) or a network failure is an error, never a throw", async () => {
    const missing = fakeClient({ select: { data: null, error: { code: "42703", message: "column profiles.course does not exist" } } });
    expect(await fetchOnboardingProfile(missing.client, "u1")).toEqual({ ok: false, error: "column profiles.course does not exist" });
    const offline = fakeClient({ select: new TypeError("Failed to fetch") });
    expect(await fetchOnboardingProfile(offline.client, "u1")).toEqual({ ok: false, error: "Failed to fetch" });
  });
});

describe("writing the profile (save_onboarding only)", () => {
  it("stores the course", async () => {
    const { client, calls } = fakeClient({ rpc: { data: { course: "algebra2", grade: null, heard_from: null, onboarded_at: null }, error: null } });
    expect(await saveOnboarding(client, { course: "algebra2" })).toEqual({ ok: true, value: { course: "algebra2", grade: null, onboarded_at: null } });
    expect(calls).toEqual([{ op: "rpc", args: ["save_onboarding", { p_course: "algebra2", p_complete: false }] }]);
  });

  it("stores a grade with the course 'other', and where they heard of us", async () => {
    const { client, calls } = fakeClient({ rpc: { data: { course: "other", grade: 0, heard_from: "tiktok", onboarded_at: null }, error: null } });
    expect(await saveOnboarding(client, { course: "other", grade: 0, heardFrom: "tiktok" })).toEqual({
      ok: true,
      value: { course: "other", grade: 0, onboarded_at: null },
    });
    expect(calls).toEqual([{ op: "rpc", args: ["save_onboarding", { p_course: "other", p_complete: false, p_grade: 0, p_heard_from: "tiktok" }] }]);
  });

  it("sends a grade or a source only with a value: without them it is v1's call (a database before the migration still saves)", async () => {
    const { client, calls } = fakeClient({ rpc: { data: { course: "geometry", onboarded_at: null }, error: null } });
    await saveOnboarding(client, { course: "geometry", grade: null, heardFrom: null });
    await saveOnboarding(client, { complete: true, heardFrom: "friend" });
    expect(calls.map((c) => c.args[1])).toEqual([
      { p_course: "geometry", p_complete: false },
      { p_course: null, p_complete: true, p_heard_from: "friend" },
    ]);
  });

  it("marks onboarding done, with or without a course", async () => {
    const at = "2026-09-28T12:00:00Z";
    const { client, calls } = fakeClient({ rpc: { data: { course: null, grade: null, onboarded_at: at }, error: null } });
    expect(await saveOnboarding(client, { complete: true })).toEqual({ ok: true, value: { course: null, grade: null, onboarded_at: at } });
    await saveOnboarding(client, { course: null, complete: true });
    expect(calls.map((c) => c.args[1])).toEqual([
      { p_course: null, p_complete: true },
      { p_course: null, p_complete: true },
    ]);
  });

  it("never sends a course, grade or source the database would refuse", async () => {
    const { client, calls } = fakeClient({ rpc: { data: { course: null, onboarded_at: null }, error: null } });
    await saveOnboarding(client, { course: "calculus" as never, grade: 9 as never, heardFrom: "radio" as never });
    await saveOnboarding(client, { grade: -1 as never });
    await saveOnboarding(client, { grade: 1.5 as never });
    expect(calls.map((c) => c.args[1])).toEqual([
      { p_course: null, p_complete: false },
      { p_course: null, p_complete: false },
      { p_course: null, p_complete: false },
    ]);
  });

  it("reports a refused or failed call instead of throwing", async () => {
    const refused = fakeClient({ rpc: { data: null, error: { code: "22023", message: "unknown course" } } });
    expect(await saveOnboarding(refused.client, { complete: true })).toEqual({ ok: false, error: "unknown course" });
    const offline = fakeClient({ rpc: new Error("offline") });
    expect(await saveOnboarding(offline.client, { complete: true })).toEqual({ ok: false, error: "offline" });
    const odd = fakeClient({ rpc: { data: "ok", error: null } });
    expect((await saveOnboarding(odd.client, { complete: true })).ok).toBe(false);
  });
});

describe("the first board", () => {
  it("is an ordinary insert owned by the student, returning its id", async () => {
    const { client, calls } = fakeClient({ insert: { data: { id: "b1" }, error: null } });
    expect(await createFirstBoard(client, "u1", "2x + 3 = 11")).toEqual({ ok: true, value: "b1" });
    expect(calls).toEqual([{ op: "insert", args: ["whiteboards", [{ title: "2x + 3 = 11", data: {}, user_id: "u1" }], "id"] }]);
  });

  it("reports a failure", async () => {
    const denied = fakeClient({ insert: { data: null, error: { code: "42501", message: "new row violates row-level security policy" } } });
    expect(await createFirstBoard(denied.client, "u1", "t")).toEqual({ ok: false, error: "new row violates row-level security policy" });
    const empty = fakeClient({ insert: { data: {}, error: null } });
    expect((await createFirstBoard(empty.client, "u1", "t")).ok).toBe(false);
  });
});

// ---------------------------------------------------------------- this device

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

const throwing = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
  removeItem: () => {
    throw new Error("SecurityError");
  },
};

const MARKER: TourMarker = { boardId: "b1", course: "algebra1", starter: 2, step: "problem" };

describe("the guided-board marker", () => {
  it("round-trips per user", () => {
    const s = memoryStorage();
    writeTourMarker(s, "u1", MARKER);
    expect(readTourMarker(s, "u1")).toEqual(MARKER);
    expect(readTourMarker(s, "u2")).toBeNull();
    expect([...s.map.keys()]).toEqual([tourKey("u1")]);
  });

  it("marks only that board as guided, for that user", () => {
    const s = memoryStorage();
    writeTourMarker(s, "u1", MARKER);
    expect(isGuidedBoard(s, "u1", "b1")).toBe(true);
    expect(isGuidedBoard(s, "u1", "b2")).toBe(false);
    expect(isGuidedBoard(s, "u2", "b1")).toBe(false);
    expect(isGuidedBoard(s, undefined, "b1")).toBe(false);
    expect(isGuidedBoard(null, "u1", "b1")).toBe(false);
  });

  it("keeps the step as the tour moves on, and is gone once cleared", () => {
    const s = memoryStorage();
    writeTourMarker(s, "u1", MARKER);
    writeTourMarker(s, "u1", { ...MARKER, step: "help" });
    expect(readTourMarker(s, "u1")?.step).toBe("help");
    clearTourMarker(s, "u1");
    expect(readTourMarker(s, "u1")).toBeNull();
    expect(isGuidedBoard(s, "u1", "b1")).toBe(false);
  });

  it("keeps the student's Auto setting from before the tour, for its end", () => {
    const s = memoryStorage();
    writeTourMarker(s, "u1", { ...MARKER, autoBefore: false });
    expect(readTourMarker(s, "u1")).toEqual({ ...MARKER, autoBefore: false });
    const odd = memoryStorage({ [tourKey("u1")]: JSON.stringify({ ...MARKER, autoBefore: "no" }) });
    expect(readTourMarker(odd, "u1")).toEqual(MARKER);
  });

  it("keeps coach mark 1's tick, for coach mark 2 after a reload — only a real one", () => {
    const s = memoryStorage();
    writeTourMarker(s, "u1", { ...MARKER, step: "help", ticked: true });
    expect(readTourMarker(s, "u1")).toEqual({ ...MARKER, step: "help", ticked: true });
    for (const ticked of [false, "yes", 1, null]) {
      const odd = memoryStorage({ [tourKey("u1")]: JSON.stringify({ ...MARKER, ticked }) });
      expect(readTourMarker(odd, "u1"), String(ticked)).toEqual(MARKER);
    }
  });

  it("keeps the grade the welcome chose (Kindergarten included), and drops one that is not a grade", () => {
    const s = memoryStorage();
    writeTourMarker(s, "u1", { ...MARKER, course: "other", grade: 0 });
    expect(readTourMarker(s, "u1")).toEqual({ ...MARKER, course: "other", grade: 0 });
    writeTourMarker(s, "u1", { ...MARKER, course: "other", grade: 8 });
    expect(readTourMarker(s, "u1")?.grade).toBe(8);
    for (const grade of [9, -1, 2.5, "3", null]) {
      const odd = memoryStorage({ [tourKey("u1")]: JSON.stringify({ ...MARKER, grade }) });
      expect(readTourMarker(odd, "u1"), String(grade)).toEqual(MARKER);
    }
  });

  it("survives garbage: bad JSON, a missing board, an unknown step", () => {
    expect(readTourMarker(memoryStorage({ [tourKey("u1")]: "{not json" }), "u1")).toBeNull();
    expect(readTourMarker(memoryStorage({ [tourKey("u1")]: JSON.stringify({ step: "write" }) }), "u1")).toBeNull();
    const odd = readTourMarker(memoryStorage({ [tourKey("u1")]: JSON.stringify({ boardId: "b1", step: "result", starter: "x", course: 5 }) }), "u1");
    expect(odd).toEqual({ boardId: "b1", course: null, starter: 0, step: "problem" });
  });

  it("a tour paused on the old help-modes coach mark resumes on Help me", () => {
    const old = memoryStorage({ [tourKey("u1")]: JSON.stringify({ ...MARKER, step: "modes" }) });
    expect(readTourMarker(old, "u1")?.step).toBe("help");
  });

  it("never throws when storage is blocked (private mode, quota)", () => {
    expect(() => writeTourMarker(throwing, "u1", MARKER)).not.toThrow();
    expect(() => clearTourMarker(throwing, "u1")).not.toThrow();
    expect(readTourMarker(throwing, "u1")).toBeNull();
    expect(isGuidedBoard(throwing, "u1", "b1")).toBe(false);
  });
});

describe("done on this device", () => {
  it("is per user and survives a failed profile write", () => {
    const s = memoryStorage();
    expect(readLocalDone(s, "u1")).toBe(false);
    writeLocalDone(s, "u1");
    expect(readLocalDone(s, "u1")).toBe(true);
    expect(readLocalDone(s, "u2")).toBe(false);
    expect(s.map.get(doneKey("u1"))).toBe("1");
  });

  it("is false without a user or storage, and never throws", () => {
    expect(readLocalDone(memoryStorage(), undefined)).toBe(false);
    expect(readLocalDone(null, "u1")).toBe(false);
    expect(readLocalDone(throwing, "u1")).toBe(false);
    expect(() => writeLocalDone(throwing, "u1")).not.toThrow();
  });
});

describe("the plan screen on this device", () => {
  it("is due once the tour is finished, and seen once it has shown, per user", () => {
    const s = memoryStorage();
    expect(readPlanMarker(s, "u1")).toBeNull();
    writePlanMarker(s, "u1", "pending");
    expect(readPlanMarker(s, "u1")).toBe("pending");
    expect(readPlanMarker(s, "u2")).toBeNull();
    writePlanMarker(s, "u1", "seen");
    expect(readPlanMarker(s, "u1")).toBe("seen");
    expect(s.map.get(planKey("u1"))).toBe("seen");
  });

  it("reads garbage, no user and blocked storage as never due, and never throws", () => {
    expect(readPlanMarker(memoryStorage({ [planKey("u1")]: "yes" }), "u1")).toBeNull();
    expect(readPlanMarker(memoryStorage(), undefined)).toBeNull();
    expect(readPlanMarker(null, "u1")).toBeNull();
    expect(readPlanMarker(throwing, "u1")).toBeNull();
    expect(() => writePlanMarker(throwing, "u1", "pending")).not.toThrow();
    expect(() => writePlanMarker(null, "u1", "pending")).not.toThrow();
  });
});
