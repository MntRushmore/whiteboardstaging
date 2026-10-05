import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveEngine } from "@/lib/live/contracts";
import {
  closedPending,
  LEARNING_SAVE,
  pendingKey,
  readPending,
  retryable,
  SaveScheduler,
  startBoardLearning,
  storeErrorCode,
  writePending,
  type BoardLearningDeps,
  type PendingStorage,
} from "../boardLearning";
import { LearningBus } from "../bus";
import type { AttemptRecord, LearningSignal, LineMark } from "../contracts";
import type { LearnerHint } from "../hint";

vi.mock("../skills", () => ({ classifyProblem: () => "two_step_equations" }));
vi.mock("../mistakes", () => ({ classifyMistake: () => null }));

const SEC = 1000;
const MIN = 60 * SEC;

const storeError = (code: string) => Object.assign(new Error(`store: ${code}`), { name: "LearningStoreError", code });

function memoryStorage(): PendingStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

function eventTarget() {
  const listeners = new Map<string, Set<(e: Event) => void>>();
  return {
    visibilityState: "visible",
    addEventListener: (type: string, fn: (e: Event) => void) => void (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(fn),
    removeEventListener: (type: string, fn: (e: Event) => void) => void listeners.get(type)?.delete(fn),
    fire: (type: string) => listeners.get(type)?.forEach((fn) => fn(new Event(type))),
    count: (type: string) => listeners.get(type)?.size ?? 0,
  };
}

const realTimers = {
  now: () => Date.now(),
  setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
  clearTimeout: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

function record(id: string, over: Partial<AttemptRecord> = {}): AttemptRecord {
  return {
    id,
    boardId: "board-1",
    problemLatex: "2x+3=11",
    skill: "two_step_equations",
    course: null,
    origin: "student",
    parentId: null,
    outcome: "in_progress",
    mistakes: {},
    activeMs: 1000,
    linesWritten: 1,
    linesRight: 1,
    linesRinged: 0,
    hints: 0,
    tutorSteps: 0,
    solves: 0,
    asks: 0,
    startedAt: "2026-10-04T15:00:00.000Z",
    updatedAt: "2026-10-04T15:00:10.000Z",
    finishedAt: null,
    ...over,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(Date.parse("2026-10-04T15:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("store errors", () => {
  it("are read by their code, duck-typed; only network and unknown are retried", () => {
    expect(storeErrorCode(storeError("network"))).toBe("network");
    expect(storeErrorCode(new Error("plain"))).toBe("unknown");
    expect(storeErrorCode("nope")).toBe("unknown");
    expect(retryable(storeError("network"))).toBe(true);
    expect(retryable(storeError("unknown"))).toBe(true);
    expect(retryable(new TypeError("Failed to fetch"))).toBe(true);
    for (const code of ["unavailable", "unauthorized", "invalid"]) expect(retryable(storeError(code))).toBe(false);
  });
});

describe("SaveScheduler", () => {
  let saves: number[];
  let fail: (() => Error) | null;
  let failed: Array<[string, boolean]>;
  let scheduler: SaveScheduler;
  const t0 = () => Date.parse("2026-10-04T15:00:00.000Z");
  const at = () => (Date.now() - t0()) / SEC;

  beforeEach(() => {
    saves = [];
    fail = null;
    failed = [];
    scheduler = new SaveScheduler({
      flush: async () => {
        saves.push(at());
        if (fail) throw fail();
      },
      timers: realTimers,
      onFailed: (code, halted) => failed.push([code, halted]),
    });
  });

  it("saves about 5 s after the last change", async () => {
    scheduler.changed();
    await vi.advanceTimersByTimeAsync(2 * SEC);
    scheduler.changed();
    await vi.advanceTimersByTimeAsync(4.9 * SEC);
    expect(saves).toEqual([]);
    await vi.advanceTimersByTimeAsync(0.2 * SEC);
    expect(saves).toEqual([7]);
    await vi.advanceTimersByTimeAsync(60 * SEC);
    expect(saves).toEqual([7]);
  });

  it("while the student keeps working: no change waits more than 15 s, and saves are 15 s apart", async () => {
    for (let i = 0; i < 25; i++) {
      scheduler.changed();
      await vi.advanceTimersByTimeAsync(2 * SEC);
    }
    // each 15 s after the first change it saves (16 s, 32 s): never sooner than 15 s after the last save
    expect(saves).toEqual([15, 31, 47]);
    await vi.advanceTimersByTimeAsync(30 * SEC);
    // the last change (48 s), saved 15 s after the last save
    expect(saves).toEqual([15, 31, 47, 62]);
  });

  it("a failure a retry can fix backs off: 15 s, 30 s, then 60 s; a success starts over", async () => {
    fail = () => storeError("network");
    scheduler.changed();
    await vi.advanceTimersByTimeAsync(5 * SEC);
    expect(saves).toEqual([5]);
    await vi.advanceTimersByTimeAsync(15 * SEC);
    expect(saves).toEqual([5, 20]);
    await vi.advanceTimersByTimeAsync(30 * SEC);
    expect(saves).toEqual([5, 20, 50]);
    fail = null;
    await vi.advanceTimersByTimeAsync(60 * SEC);
    expect(saves).toEqual([5, 20, 50, 110]);
    expect(failed).toEqual([
      ["network", false],
      ["network", false],
      ["network", false],
    ]);
    // backoff gone: the next change saves on the usual schedule (15 s after the last save)
    scheduler.changed();
    await vi.advanceTimersByTimeAsync(15 * SEC);
    expect(saves).toEqual([5, 20, 50, 110, 125]);
  });

  it("invalid: what could be saved was, and saving goes on", async () => {
    fail = () => storeError("invalid");
    scheduler.changed();
    await vi.advanceTimersByTimeAsync(5 * SEC);
    expect(scheduler.halted).toBeNull();
    expect(failed).toEqual([["invalid", false]]);
    fail = null;
    scheduler.changed();
    await scheduler.flushNow();
    expect(saves.length).toBeGreaterThanOrEqual(2);
  });

  it.each(["unavailable", "unauthorized"])("%s: no more tries this session", async (code) => {
    fail = () => storeError(code);
    scheduler.changed();
    await vi.advanceTimersByTimeAsync(5 * SEC);
    expect(scheduler.halted).toBe(code);
    expect(failed).toEqual([[code, true]]);
    scheduler.changed();
    await scheduler.flushNow();
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(saves).toEqual([5]);
  });

  it("flushNow saves at once, whatever the schedule, and never rejects", async () => {
    scheduler.changed();
    await scheduler.flushNow();
    expect(saves).toEqual([0]);
    fail = () => storeError("network");
    scheduler.changed();
    await expect(scheduler.flushNow()).resolves.toBeUndefined();
    expect(saves).toEqual([0, 0]);
  });

  it("stopped, it saves nothing more on its own", async () => {
    scheduler.changed();
    scheduler.stop();
    await vi.advanceTimersByTimeAsync(MIN);
    expect(saves).toEqual([]);
  });
});

describe("unsaved records on the device", () => {
  it("round trip, newest first, the latest of each, capped; a bad entry reads as none", () => {
    const storage = memoryStorage();
    writePending("u1", [record("a", { updatedAt: "2026-10-04T15:00:01.000Z" }), record("b", { updatedAt: "2026-10-04T15:00:03.000Z" }), record("a", { updatedAt: "2026-10-04T15:00:05.000Z", linesWritten: 4 })], storage);
    const back = readPending("u1", storage);
    expect(back.map((r) => [r.id, r.linesWritten])).toEqual([
      ["a", 4],
      ["b", 1],
    ]);
    expect(readPending("u2", storage)).toEqual([]);
    writePending("u1", Array.from({ length: 150 }, (_, i) => record(`r${i}`, { updatedAt: new Date(Date.UTC(2026, 9, 4, 15, 0, i)).toISOString() })), storage);
    expect(readPending("u1", storage)).toHaveLength(LEARNING_SAVE.pendingMax);
    expect(readPending("u1", storage)[0].id).toBe("r149");
    storage.setItem(pendingKey("u1"), "{not json");
    expect(readPending("u1", storage)).toEqual([]);
    storage.setItem(pendingKey("u1"), JSON.stringify([{ id: "x" }, record("ok")]));
    expect(readPending("u1", storage).map((r) => r.id)).toEqual(["ok"]);
    writePending("u1", [], storage);
    expect(storage.data.has(pendingKey("u1"))).toBe(false);
  });

  it("a storage that throws is no storage", () => {
    const broken: PendingStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readPending("u1", broken)).toEqual([]);
    expect(() => writePending("u1", [record("a")], broken)).not.toThrow();
    expect(readPending("u1", null)).toEqual([]);
  });

  it("a record a visit left in progress is over: unfinished, finished when last changed", () => {
    expect(closedPending(record("a"))).toMatchObject({ outcome: "unfinished", finishedAt: "2026-10-04T15:00:10.000Z" });
    const done = record("b", { outcome: "first_try", finishedAt: "2026-10-04T15:00:09.000Z" });
    expect(closedPending(done)).toBe(done);
  });
});

describe("startBoardLearning", () => {
  let bus: LearningBus;
  let storage: ReturnType<typeof memoryStorage>;
  let win: ReturnType<typeof eventTarget>;
  let doc: ReturnType<typeof eventTarget>;
  let saved: AttemptRecord[][];
  let saveError: Error | null;
  let loaded: AttemptRecord[];
  let hintInputs: AttemptRecord[][];
  let ids: number;

  function deps(over: Partial<BoardLearningDeps> = {}): Partial<BoardLearningDeps> {
    return {
      bus,
      readProfile: async () => ({ course: "algebra1", displayName: "Sam" }),
      save: async (records) => {
        saved.push([...records]);
        if (saveError) throw saveError;
      },
      load: async () => loaded,
      hint: (attempts): LearnerHint | undefined => {
        hintInputs.push([...attempts]);
        return attempts.length > 0 ? { weakSkills: [{ id: "two_step_equations", name: "Two-step equations" }], strongSkills: [], recurringMistakes: [] } : undefined;
      },
      engine: async () => ({}) as LiveEngine,
      sessionUserId: async () => "u1",
      newId: () => `att-${++ids}`,
      timers: realTimers,
      storage,
      window: win,
      document: doc,
      ...over,
    };
  }

  const line = (lineId: string, latex: string, mark: LineMark, over: Partial<Extract<LearningSignal, { type: "line" }>> = {}): LearningSignal => ({
    type: "line",
    at: Date.now(),
    boardId: "board-1",
    pageId: "page:1",
    problemKey: "page:1#ink:a",
    problemLatex: ["2x+3=11"],
    lineId,
    latex,
    kind: "equation",
    mark,
    solved: false,
    ...over,
  });

  beforeEach(() => {
    bus = new LearningBus();
    storage = memoryStorage();
    win = eventTarget();
    doc = eventTarget();
    saved = [];
    saveError = null;
    loaded = [];
    hintInputs = [];
    ids = 0;
  });

  it("the board's signals so far, then the new ones, become attempts: published, with the student's course, saved ~5 s later", async () => {
    const attempts: AttemptRecord[] = [];
    bus.onAttempt((r) => attempts.push(r));
    // said before the runtime loaded (buffered on the bus)
    bus.emit(line("a", "2x+3=11", null));
    bus.emit(line("b", "2x=8", "check"));
    const handle = startBoardLearning({ boardId: "board-1", userId: "u1" }, deps());
    await vi.advanceTimersByTimeAsync(0);
    expect(handle.profile()).toEqual({ course: "algebra1", displayName: "Sam" });
    expect(attempts.at(-1)).toMatchObject({ id: "att-1", course: "algebra1", linesWritten: 2, linesRight: 1, outcome: "in_progress" });
    bus.emit(line("c", "x=4", "check", { solved: true }));
    expect(attempts.at(-1)).toMatchObject({ outcome: "first_try" });
    expect(saved).toEqual([]);
    await vi.advanceTimersByTimeAsync(LEARNING_SAVE.debounceMs);
    expect(saved.map((b) => b.map((r) => r.outcome))).toEqual([["first_try"]]);
    handle.stop();
  });

  it("signals about another board are not this board's", async () => {
    const handle = startBoardLearning({ boardId: "board-1", userId: "u1" }, deps());
    await vi.advanceTimersByTimeAsync(0);
    bus.emit(line("a", "2x=8", "check", { boardId: "board-2" }));
    expect(handle.tracker()?.records()).toEqual([]);
    handle.stop();
  });

  it("what the last visit could not save is saved first (and was over)", async () => {
    writePending("u1", [record("old")], storage);
    const handle = startBoardLearning({ boardId: "board-1", userId: "u1" }, deps());
    await vi.advanceTimersByTimeAsync(LEARNING_SAVE.debounceMs);
    expect(saved).toEqual([[expect.objectContaining({ id: "old", outcome: "unfinished" })]]);
    expect(readPending("u1", storage)).toEqual([]);
    handle.stop();
  });

  it("a failed save keeps the records on the device and tries again later; the next visit saves them", async () => {
    saveError = storeError("network");
    const first = startBoardLearning({ boardId: "board-1", userId: "u1" }, deps());
    await vi.advanceTimersByTimeAsync(0);
    bus.emit(line("a", "2x=8", "check"));
    await vi.advanceTimersByTimeAsync(LEARNING_SAVE.debounceMs);
    expect(saved).toHaveLength(1);
    expect(readPending("u1", storage).map((r) => r.id)).toEqual(["att-1"]);
    await vi.advanceTimersByTimeAsync(LEARNING_SAVE.backoffMs[0]);
    expect(saved).toHaveLength(2);
    first.stop();
    await vi.advanceTimersByTimeAsync(0);
    // closed by the unmount, still not saved: kept, as it is now
    expect(readPending("u1", storage)).toEqual([expect.objectContaining({ id: "att-1", outcome: "unfinished" })]);
    saveError = null;
    saved = [];
    const next = startBoardLearning({ boardId: "board-1", userId: "u1" }, deps());
    await vi.advanceTimersByTimeAsync(LEARNING_SAVE.debounceMs);
    expect(saved).toEqual([[expect.objectContaining({ id: "att-1", outcome: "unfinished" })]]);
    expect(readPending("u1", storage)).toEqual([]);
    next.stop();
  });

  it("unauthorized: no more tries this session, the records kept for the next; invalid: not kept", async () => {
    saveError = storeError("unauthorized");
    const a = startBoardLearning({ boardId: "board-1", userId: "u1" }, deps());
    await vi.advanceTimersByTimeAsync(0);
    bus.emit(line("a", "2x=8", "check"));
    await vi.advanceTimersByTimeAsync(LEARNING_SAVE.debounceMs);
    bus.emit(line("b", "x=4", "check", { solved: true }));
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(saved).toHaveLength(1);
    expect(a.scheduler().halted).toBe("unauthorized");
    a.stop();
    expect(readPending("u1", storage).map((r) => r.id)).toEqual(["att-1"]);

    storage.data.clear();
    saveError = storeError("invalid");
    saved = [];
    const b = startBoardLearning({ boardId: "board-1", userId: "u1" }, deps());
    await vi.advanceTimersByTimeAsync(0);
    bus.emit(line("a", "2x=8", "check"));
    await vi.advanceTimersByTimeAsync(LEARNING_SAVE.debounceMs);
    b.stop();
    expect(readPending("u1", storage)).toEqual([]);
  });

  it("a board deleted since a visit left its attempts: they are saved without it, for the student signed in", async () => {
    const left = { ...record("old-1"), boardId: "board-gone" };
    writePending("u1", [left], storage);
    const tried: Array<Array<string | null>> = [];
    const handle = startBoardLearning({ boardId: "board-1", userId: "u1" }, deps({
      save: async (records) => {
        tried.push(records.map((r) => r.boardId));
        if (records.some((r) => r.boardId === "board-gone")) throw storeError("unauthorized");
        saved.push([...records]);
      },
    }));
    await vi.advanceTimersByTimeAsync(LEARNING_SAVE.debounceMs);
    expect(tried).toEqual([["board-gone"], [null]]);
    expect(handle.scheduler().halted).toBeNull();
    expect(readPending("u1", storage)).toEqual([]);
    handle.stop();
  });

  it("…but never into another account: another student signed in, they stay on the device", async () => {
    writePending("u1", [{ ...record("old-1"), boardId: "board-gone" }], storage);
    const handle = startBoardLearning({ boardId: "board-1", userId: "u1" }, deps({
      sessionUserId: async () => "someone-else",
      save: async () => {
        throw storeError("unauthorized");
      },
    }));
    await vi.advanceTimersByTimeAsync(LEARNING_SAVE.debounceMs);
    expect(handle.scheduler().halted).toBe("unauthorized");
    handle.stop();
    expect(readPending("u1", storage).map((r) => r.id)).toEqual(["old-1"]);
  });

  it("what earlier visits left stays on the device while its save is in flight", async () => {
    writePending("u1", [record("old-1")], storage);
    let release: () => void = () => undefined;
    const handle = startBoardLearning({ boardId: "board-1", userId: "u1" }, deps({
      save: (records) => {
        saved.push([...records]);
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      },
    }));
    await vi.advanceTimersByTimeAsync(LEARNING_SAVE.debounceMs);
    expect(saved).toHaveLength(1);
    // the tab hidden mid-save: the device still has it
    doc.visibilityState = "hidden";
    doc.fire("visibilitychange");
    expect(readPending("u1", storage).map((r) => r.id)).toEqual(["old-1"]);
    release();
    await vi.advanceTimersByTimeAsync(0);
    handle.stop();
  });

  it("a problem worked again after the board was left goes on with the same attempt", async () => {
    const first = startBoardLearning({ boardId: "board-1", userId: "u1" }, deps());
    await vi.advanceTimersByTimeAsync(0);
    bus.emit(line("a", "2x=5", "circle", { previousLatex: "2x+3=11" }));
    await vi.advanceTimersByTimeAsync(LEARNING_SAVE.debounceMs);
    first.stop();
    await vi.advanceTimersByTimeAsync(0);
    // the board opened again (a reload): the same problem, a new line of it
    const second = startBoardLearning({ boardId: "board-1", userId: "u1" }, deps());
    await vi.advanceTimersByTimeAsync(0);
    bus.emit(line("b", "x=4", "check", { solved: true }));
    await vi.advanceTimersByTimeAsync(LEARNING_SAVE.debounceMs);
    const last = saved.flat().at(-1)!;
    expect(last.id).toBe("att-1");
    expect(last).toMatchObject({ outcome: "self_corrected", linesWritten: 2, linesRinged: 1 });
    expect(new Set(saved.flat().map((r) => r.id))).toEqual(new Set(["att-1"]));
    second.stop();
  });

  it("the tab hidden: saved at once", async () => {
    const handle = startBoardLearning({ boardId: "board-1", userId: "u1" }, deps());
    await vi.advanceTimersByTimeAsync(0);
    bus.emit(line("a", "2x=8", "check"));
    doc.visibilityState = "hidden";
    doc.fire("visibilitychange");
    await vi.advanceTimersByTimeAsync(0);
    expect(saved.map((b) => b.map((r) => r.outcome))).toEqual([["in_progress"]]);
    handle.stop();
  });

  it("the page going away: its problems are over, kept on the device, saved at once", async () => {
    const handle = startBoardLearning({ boardId: "board-1", userId: "u1" }, deps());
    await vi.advanceTimersByTimeAsync(0);
    saveError = storeError("network");
    bus.emit(line("a", "2x=8", "check"));
    win.fire("pagehide");
    expect(readPending("u1", storage)).toEqual([expect.objectContaining({ outcome: "unfinished" })]);
    await vi.advanceTimersByTimeAsync(0);
    expect(saved.map((b) => b.map((r) => r.outcome))).toEqual([["unfinished"]]);
    handle.stop();
  });

  it("unmount: closed, saved, listeners gone, the learner hint cleared", async () => {
    loaded = [record("earlier", { outcome: "first_try", finishedAt: "2026-10-03T10:00:00.000Z" })];
    const handle = startBoardLearning({ boardId: "board-1", userId: "u1" }, deps());
    await vi.advanceTimersByTimeAsync(0);
    expect(bus.learner()).toBeDefined();
    bus.emit(line("a", "2x=8", "check"));
    handle.stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(saved.map((b) => b.map((r) => r.outcome))).toEqual([["unfinished"]]);
    expect(win.count("pagehide")).toBe(0);
    expect(doc.count("visibilitychange")).toBe(0);
    expect(bus.learner()).toBeUndefined();
    // nothing listens any more: the next board's signals wait for its own runtime
    bus.emit(line("b", "x=4", "check"));
    expect(handle.tracker()?.records()).toHaveLength(1);
  });

  it("the learner hint: loaded once at the start, from the record and the board's own attempts; again after three more finish, at most every few minutes", async () => {
    loaded = [record("earlier", { outcome: "first_try", finishedAt: "2026-10-03T10:00:00.000Z" })];
    const handle = startBoardLearning({ boardId: "board-1", userId: "u1" }, deps());
    await vi.advanceTimersByTimeAsync(0);
    expect(hintInputs.map((list) => list.map((r) => r.id))).toEqual([["earlier"]]);
    expect(bus.learner()?.weakSkills[0].id).toBe("two_step_equations");
    // three problems finished in under three minutes: the hint waits for the three minutes
    for (const k of ["p1", "p2", "p3"]) {
      bus.emit(line(`${k}-a`, "x=4", "check", { solved: true, problemKey: `page:1#ink:${k}` }));
      await vi.advanceTimersByTimeAsync(10 * SEC);
    }
    expect(hintInputs).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(LEARNING_SAVE.learnerEveryMs);
    expect(hintInputs).toHaveLength(2);
    expect(hintInputs[1].map((r) => r.id).sort()).toEqual(["att-1", "att-2", "att-3", "earlier"]);
    handle.stop();
  });

  it("idle attempts close on the minute's tick", async () => {
    const attempts: AttemptRecord[] = [];
    bus.onAttempt((r) => attempts.push(r));
    const handle = startBoardLearning({ boardId: "board-1", userId: "u1" }, deps());
    await vi.advanceTimersByTimeAsync(0);
    bus.emit(line("a", "2x=8", "check"));
    await vi.advanceTimersByTimeAsync(31 * MIN);
    expect(attempts.at(-1)).toMatchObject({ outcome: "unfinished" });
    handle.stop();
  });

  it("no profile (it failed): the record still runs, with no course", async () => {
    const attempts: AttemptRecord[] = [];
    bus.onAttempt((r) => attempts.push(r));
    const handle = startBoardLearning({ boardId: "board-1", userId: "u1" }, deps({ readProfile: async () => Promise.reject(new Error("offline")) }));
    await vi.advanceTimersByTimeAsync(0);
    bus.emit(line("a", "2x=8", "check"));
    expect(attempts.at(-1)).toMatchObject({ course: null });
    handle.stop();
  });

  it("stopped before it was ready: it never listens", async () => {
    const handle = startBoardLearning({ boardId: "board-1", userId: "u1" }, deps());
    handle.stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(handle.tracker()).toBeNull();
    bus.emit(line("a", "2x=8", "check"));
    expect(saved).toEqual([]);
  });
});
