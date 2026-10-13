/**
 * The free board's rule (src/lib/billing/freeBoard.ts): one board for an account without a plan,
 * until 5 problems are done on it or its starter ink runs out; the plan screen for any other board;
 * and planGate's fail-open principles kept whole (a payer is never held, an admin looks around,
 * nothing is held without a checkout, just after checkout, or while the plan is unread).
 */
import { describe, expect, it } from "vitest";
import {
  DONE_OUTCOMES,
  FREE_BOARD_PROBLEMS,
  countDone,
  freeBoardApplies,
  freeBoardEnd,
  freeBoardEndKey,
  freeBoardGate,
  isDone,
  oldestBoard,
  problemKey,
  readFreeBoardEnd,
  writeFreeBoardEnd,
  type FreeBoardInput,
} from "@/lib/billing/freeBoard";
import { planGate } from "@/lib/billing/planGate";
import { hasPlan, type UnlimitedStatus } from "@/lib/billing/unlimited";
import { OUTCOMES, ATTEMPT_ORIGINS } from "@/lib/learning/contracts";

const FREE = "b-free";
const OTHER = "b-other";

/** An account with no plan, on the home, with its free board at 2 of 5 and starter ink left. */
const HOME: FreeBoardInput = {
  enabled: true,
  checkoutOpen: true,
  known: true,
  state: { status: "none" },
  justPaid: false,
  admin: false,
  freeBoardId: FREE,
  boardId: null,
  done: 2,
  ink: 60,
};
const home = (over: Partial<FreeBoardInput> = {}) => freeBoardGate({ ...HOME, ...over });
const board = (boardId: string, over: Partial<FreeBoardInput> = {}) => freeBoardGate({ ...HOME, boardId, ...over });

const ALL: UnlimitedStatus[] = ["none", "trialing", "repeat_trial", "active", "past_due", "canceled", "incomplete"];

function memoryStorage() {
  const m = new Map<string, string>();
  return { map: m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

describe("the free board: an account without a plan", () => {
  it("stays on the home while its free board has problems and ink left, with the board and its progress", () => {
    expect(home()).toEqual({ gate: "free", freeBoardId: FREE, done: 2, goal: FREE_BOARD_PROBLEMS, ended: null, usedUp: false });
    for (let done = 0; done < FREE_BOARD_PROBLEMS; done++) expect(home({ done }).gate).toBe("free");
  });

  it("opens its free board, and sends any other board (a second one, a new one) to the plan screen", () => {
    expect(board(FREE)).toMatchObject({ gate: "free", freeBoardId: FREE, usedUp: false });
    expect(board(OTHER)).toMatchObject({ gate: "locked", freeBoardId: FREE, ended: null });
    // another board stays locked whatever the free board's state
    expect(board(OTHER, { done: 0, ink: 100 }).gate).toBe("locked");
    expect(board(OTHER, { done: null, ink: null }).gate).toBe("locked");
  });

  it("ends after 5 problems: the home and the board go to the plan screen", () => {
    expect(home({ done: 5 })).toMatchObject({ gate: "locked", ended: "problems" });
    expect(home({ done: 9 })).toMatchObject({ gate: "locked", ended: "problems" });
    expect(board(FREE, { done: 5 })).toMatchObject({ gate: "locked", ended: "problems", usedUp: false });
  });

  it("ends when the starter ink runs out (the balance at 0, or a call refused for ink)", () => {
    expect(home({ ink: 0 })).toMatchObject({ gate: "locked", ended: "ink" });
    expect(home({ ink: -3 })).toMatchObject({ gate: "locked", ended: "ink" });
    expect(board(FREE, { inkRefused: true })).toMatchObject({ gate: "locked", ended: "ink" });
    // a little ink is still ink
    expect(home({ ink: 1 }).gate).toBe("free");
  });

  it("says problems when both ran out together ('Nice work' beats 'out of ink')", () => {
    expect(home({ done: 5, ink: 0 }).ended).toBe("problems");
    expect(freeBoardEnd({ done: 5, ink: 0, inkRefused: true, endedOnDevice: "ink" })).toBe("problems");
  });

  it("on the free board itself, during the visit that used it up: the sheet's moment, not a redirect", () => {
    expect(board(FREE, { done: 5, wasFree: true })).toEqual({ gate: "free", freeBoardId: FREE, done: 5, goal: 5, ended: "problems", usedUp: true });
    expect(board(FREE, { inkRefused: true, wasFree: true })).toMatchObject({ gate: "free", ended: "ink", usedUp: true });
    expect(board(FREE, { ink: 0, wasFree: true })).toMatchObject({ gate: "free", ended: "ink", usedUp: true });
    // the moment is the free board's only: never on the home, never on another board
    expect(home({ done: 5, wasFree: true }).gate).toBe("locked");
    expect(board(OTHER, { done: 5, wasFree: true }).gate).toBe("locked");
    // not used up: wasFree changes nothing
    expect(board(FREE, { wasFree: true })).toMatchObject({ gate: "free", usedUp: false });
  });

  it("remembers an end this device saw: the home goes straight to the plan screen", () => {
    expect(home({ done: 1, endedOnDevice: "problems" })).toMatchObject({ gate: "locked", ended: "problems" });
    expect(home({ endedOnDevice: "ink" })).toMatchObject({ gate: "locked", ended: "ink" });
    expect(board(FREE, { endedOnDevice: "problems" }).gate).toBe("locked");
    // whatever the free board is now: a used-up board deleted does not make the next one free here
    expect(home({ freeBoardId: OTHER, done: 0, endedOnDevice: "problems" }).gate).toBe("locked");
  });

  it("with no board at all, lets the first be made (it becomes the free board), unless the ink is gone", () => {
    expect(home({ freeBoardId: null, done: null })).toMatchObject({ gate: "free", freeBoardId: null, ended: null });
    expect(home({ freeBoardId: null, done: null, ink: 0 })).toMatchObject({ gate: "locked", ended: "ink" });
    expect(home({ freeBoardId: null, done: null, endedOnDevice: "problems" }).gate).toBe("locked");
    // a board page with no live board of theirs: not theirs (or gone)
    expect(board(OTHER, { freeBoardId: null, done: null }).gate).toBe("locked");
  });

  it("a deleted free board: the next oldest is the free board", () => {
    const boards = [
      { id: "first", created_at: "2026-10-01T10:00:00Z" },
      { id: "second", created_at: "2026-10-02T10:00:00Z" },
      { id: "third", created_at: "2026-10-03T10:00:00Z" },
    ];
    expect(oldestBoard(boards)).toBe("first");
    const afterDelete = boards.filter((b) => b.id !== "first");
    const next = oldestBoard(afterDelete);
    expect(next).toBe("second");
    expect(board("second", { freeBoardId: next, done: 0 }).gate).toBe("free");
    expect(board("third", { freeBoardId: next }).gate).toBe("locked");
    expect(oldestBoard([])).toBeNull();
  });
});

describe("the free board fails open", () => {
  it("is checking (the page shows as usual, nothing held) while the free board is not known", () => {
    expect(home({ freeBoardId: undefined })).toMatchObject({ gate: "checking", freeBoardId: null, ended: null, usedUp: false });
    expect(board(FREE, { freeBoardId: undefined }).gate).toBe("checking");
    expect(board(OTHER, { freeBoardId: undefined }).gate).toBe("checking");
  });

  it("holds nobody over problems not read yet, or ink not read yet", () => {
    expect(home({ done: null }).gate).toBe("free");
    expect(home({ ink: null }).gate).toBe("free");
    expect(board(FREE, { done: null, ink: null }).gate).toBe("free");
    // but ink known to be gone needs no problem count
    expect(home({ done: null, ink: 0 }).gate).toBe("locked");
  });

  it("keeps planGate's principles: no checkout link, just back from checkout, a page left alone, the plan unread", () => {
    for (const over of [{ checkoutOpen: false }, { justPaid: true }, { enabled: false }] as Partial<FreeBoardInput>[]) {
      expect(home({ ...over, done: 9, ink: 0 }).gate).toBe("open");
      expect(board(OTHER, { ...over, done: 9, ink: 0 }).gate).toBe("open");
    }
    expect(home({ known: false, done: 9 }).gate).toBe("checking");
    expect(board(OTHER, { known: false }).gate).toBe("checking");
  });

  it("lets admins look around, and waits for is_admin() before holding anyone", () => {
    expect(board(OTHER, { admin: true }).gate).toBe("open");
    expect(home({ admin: true, done: 9 }).gate).toBe("open");
    expect(home({ admin: null }).gate).toBe("checking");
    expect(board(OTHER, { admin: null }).gate).toBe("checking");
  });

  it("never holds an account with a plan, whatever the free board says", () => {
    for (const status of ALL) {
      if (!hasPlan({ status })) continue;
      for (const boardId of [null, FREE, OTHER]) {
        for (const over of [{}, { done: 9 }, { ink: 0 }, { inkRefused: true }, { endedOnDevice: "problems" as const }, { freeBoardId: null }, { freeBoardId: undefined }, { admin: null }]) {
          const v = freeBoardGate({ ...HOME, state: { status }, boardId, ...over });
          expect(v.gate, `${status} ${boardId} ${JSON.stringify(over)}`).toBe("open");
          expect(v.usedUp).toBe(false);
        }
      }
    }
  });

  it("only ever narrows planGate's lock: whatever planGate opens or is checking stays so", () => {
    const flags = [true, false];
    for (const status of ALL)
      for (const enabled of flags)
        for (const checkoutOpen of flags)
          for (const known of flags)
            for (const justPaid of flags)
              for (const admin of [true, false, null])
                for (const boardId of [null, FREE, OTHER]) {
                  const input: FreeBoardInput = { ...HOME, state: { status }, enabled, checkoutOpen, known, justPaid, admin, boardId, done: 9, ink: 0, inkRefused: true };
                  const base = planGate(input);
                  const free = freeBoardGate(input).gate;
                  if (base !== "locked") expect(free).toBe(base);
                  else expect(["locked", "free", "checking"]).toContain(free);
                }
  });

  it("reads the free board only for an account it may hold", () => {
    const input = { enabled: true, checkoutOpen: true, known: true, state: { status: "none" as const }, justPaid: false };
    expect(freeBoardApplies(input)).toBe(true);
    expect(freeBoardApplies({ ...input, state: { status: "canceled" } })).toBe(true);
    expect(freeBoardApplies({ ...input, state: { status: "trialing" } })).toBe(false);
    expect(freeBoardApplies({ ...input, known: false })).toBe(false);
    expect(freeBoardApplies({ ...input, enabled: false })).toBe(false);
    expect(freeBoardApplies({ ...input, checkoutOpen: false })).toBe(false);
    expect(freeBoardApplies({ ...input, justPaid: true })).toBe(false);
  });
});

describe("which board is the free one", () => {
  it("is the oldest by created_at, then by id; a board with no date comes last", () => {
    expect(oldestBoard([{ id: "b", created_at: "2026-10-02T00:00:00Z" }, { id: "a", created_at: "2026-10-01T00:00:00Z" }])).toBe("a");
    expect(oldestBoard([{ id: "z", created_at: "2026-10-01T00:00:00Z" }, { id: "y", created_at: "2026-10-01T00:00:00.000+00:00" }])).toBe("y");
    expect(oldestBoard([{ id: "nodate", created_at: null }, { id: "dated", created_at: "2026-10-05T00:00:00Z" }])).toBe("dated");
    expect(oldestBoard([{ id: "nodate", created_at: null }])).toBe("nodate");
    expect(oldestBoard([{ id: "", created_at: "2026-10-01T00:00:00Z" }])).toBeNull();
  });
});

describe("what counts as a problem done", () => {
  it("an attempt the student or the tutor finished: every outcome but in_progress and unfinished", () => {
    for (const outcome of OUTCOMES) expect(isDone({ outcome, origin: "student" }), outcome).toBe((DONE_OUTCOMES as readonly string[]).includes(outcome));
    expect([...DONE_OUTCOMES].sort()).toEqual(OUTCOMES.filter((o) => o !== "in_progress" && o !== "unfinished").sort());
  });

  it("from every origin but the chat's worked examples (teach)", () => {
    for (const origin of ATTEMPT_ORIGINS) expect(isDone({ outcome: "first_try", origin }), origin).toBe(origin !== "teach");
  });

  it("counts each problem once and each attempt once", () => {
    const row = (id: string, problemLatex: string | null, outcome = "first_try", origin = "student") => ({ id, problemLatex, outcome, origin });
    expect(countDone([])).toBe(0);
    expect(countDone([row("1", "2+3"), row("2", "4x=8", "with_help"), row("3", "x^2=9", "tutor_solved")])).toBe(3);
    // the same problem twice (another device, a forgotten attempt), spaces aside
    expect(countDone([row("1", "2 + 3"), row("2", "2+3")])).toBe(1);
    // the same attempt twice (saved, and published again by the board): once
    expect(countDone([row("1", "2+3"), row("1", "2+3")])).toBe(1);
    // an attempt whose problem the tracker renamed is still one problem
    expect(countDone([row("1", "2+3"), row("1", "2+3=5")])).toBe(1);
    // no LaTeX: counted by its id
    expect(countDone([row("1", null), row("2", ""), row("2", "")])).toBe(2);
    // not finished, a worked example: not counted
    expect(countDone([row("1", "a", "in_progress"), row("2", "b", "unfinished"), row("3", "c", "tutor_solved", "teach")])).toBe(0);
    expect(problemKey("  x + 1 = 2 ")).toBe("p:x+1=2");
    expect(problemKey(null)).toBe("");
  });

  it("five done reach the goal", () => {
    const five = Array.from({ length: 5 }, (_, i) => ({ id: String(i), problemLatex: `${i}+1`, outcome: "first_try", origin: "now_you_try" }));
    expect(home({ done: countDone(five) }).ended).toBe("problems");
    expect(home({ done: countDone(five.slice(1)) }).ended).toBeNull();
  });
});

describe("the end as this device remembers it", () => {
  it("is per account, problems or ink, and nothing else", () => {
    const s = memoryStorage();
    expect(readFreeBoardEnd(s, "u1")).toBeNull();
    writeFreeBoardEnd(s, "u1", "problems");
    expect(readFreeBoardEnd(s, "u1")).toBe("problems");
    expect(readFreeBoardEnd(s, "u2")).toBeNull();
    expect(s.map.get(freeBoardEndKey("u1"))).toBe("problems");
    s.setItem(freeBoardEndKey("u2"), "yes");
    expect(readFreeBoardEnd(s, "u2")).toBeNull();
    expect(readFreeBoardEnd(null, "u1")).toBeNull();
    expect(readFreeBoardEnd(s, undefined)).toBeNull();
  });

  it("never throws over a blocked storage", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => undefined,
    };
    expect(readFreeBoardEnd(blocked, "u1")).toBeNull();
    expect(() => writeFreeBoardEnd(blocked, "u1", "ink")).not.toThrow();
  });
});
