/**
 * What /start saves once the account exists (`finishStart`): the answers through save_onboarding,
 * the kid's name over none, the first board on the plan's first skill with real problems, the
 * device markers that skip the old welcome and tour and send the plan screen next. Every branch,
 * twice (idempotence), and every failure (never thrown, never fatal).
 */
import { describe, expect, it, vi } from "vitest";
import { GRADE_PATHS } from "@/lib/learning/grades";
import { hasPractice, practiceProblems } from "@/lib/learning/practiceSet";
import { practiceMarkerKey } from "@/lib/learning/practiceMarker";
import { practiceTitle } from "@/lib/learning/progressView";
import { skillDef } from "@/lib/learning/contracts";
import { GRADE_STARTERS, STARTER_PROBLEMS } from "@/lib/onboarding/courses";
import { doneKey, readLocalDone, readTourMarker } from "@/lib/onboarding/marker";
import { PLAN_PATH, planDue, planKey, readPlanMarker } from "@/lib/onboarding/planMarker";
import { welcomeDecision } from "@/lib/onboarding/state";
import { EMPTY_ANSWERS, type StartAnswers } from "../contracts";
import { COURSE_FOCUS } from "../plan";
import { boardPath, FIRST_BOARD_TITLE, finishedKey, finishStart, firstBoardPlan, firstSkills, readStartFinished, START_MARKER_SKILL, START_PROBLEMS, type FinishDeps, type PracticeKit } from "../finish";
import { fakeDb, fakeStorage, type FakeStorage } from "./fakes";

const USER = "11111111-2222-4333-8444-555555555555";
const REAL_KIT: PracticeKit = { hasPractice, practiceProblems, practiceTitle };

const SAM: StartAnswers = {
  role: "parent",
  name: "Sam",
  choice: { kind: "grade", grade: 3 },
  focus: ["division_facts", "times_tables"],
  tried: { checked: true, solved: true },
  heardFrom: "tiktok",
};

function deps(storage: FakeStorage | null, over: Partial<FinishDeps> = {}): Partial<FinishDeps> & { welcomeEmail: ReturnType<typeof vi.fn> } {
  const welcomeEmail = vi.fn();
  return { storage, now: () => 1_760_000_000_000, seed: () => 42, practice: async () => REAL_KIT, welcomeEmail, ...over } as Partial<FinishDeps> & { welcomeEmail: ReturnType<typeof vi.fn> };
}

function practiceMarker(storage: FakeStorage, boardId: string) {
  const raw = storage.getItem(practiceMarkerKey(boardId));
  return raw ? (JSON.parse(raw) as { boardId: string; skill: string; problems: string[][]; createdAt: number }) : null;
}

describe("finishStart: a parent who picked a grade and two tricky skills", () => {
  it("saves the answers, names the profile, makes the first board on the first skill picked, and opens it next (the free board)", async () => {
    const storage = fakeStorage();
    const db = fakeDb();
    const d = deps(storage);
    const result = await finishStart(db.client, USER, SAM, d);

    expect(result).toEqual({ next: boardPath("board-1"), boardId: "board-1", saved: true, name: "named", failed: [] });
    expect(result.next).toBe("/board/board-1");
    // save_onboarding v2: a grade is the course "other" plus the grade; the source; done
    expect(db.calls.rpc).toEqual([{ fn: "save_onboarding", args: { p_course: "other", p_complete: true, p_grade: 3, p_heard_from: "tiktok" } }]);
    expect(db.profile).toMatchObject({ course: "other", grade: 3, heard_from: "tiktok", display_name: "Sam" });
    expect(db.profile.onboarded_at).toBeTruthy();
    // the name over none only: the update says so itself
    expect(db.calls.updates).toEqual([{ values: { display_name: "Sam" }, eq: ["user_id", USER], is: ["display_name", null] }]);
    // the board: "Practice: Division facts", four problems for it, left in the practice marker
    expect(db.calls.boards).toEqual([{ title: practiceTitle(skillDef("division_facts")!.name), data: {}, user_id: USER }]);
    expect(db.calls.boards[0].title).toBe("Practice: Division facts");
    const marker = practiceMarker(storage, "board-1");
    expect(marker?.skill).toBe("division_facts");
    expect(marker?.problems).toEqual(practiceProblems("division_facts", START_PROBLEMS, 42));
    expect(marker?.problems).toHaveLength(START_PROBLEMS);
    // the welcome email, after the save
    expect(d.welcomeEmail).toHaveBeenCalledTimes(1);
  });

  it("skips the old welcome and the three-tip tour on this device, and leaves the plan screen to the free board's end", async () => {
    const storage = fakeStorage();
    const db = fakeDb();
    await finishStart(db.client, USER, SAM, deps(storage));
    expect(readLocalDone(storage, USER)).toBe(true);
    expect(readTourMarker(storage, USER)).toBeNull();
    // the home does not send them to the plan screen: the free board is open first
    expect(readPlanMarker(storage, USER)).toBeNull();
    expect(planDue(readPlanMarker(storage, USER))).toBe(false);
  });

  it("the home's old welcome stays hidden for the account, on this device and on any other (onboarded_at)", async () => {
    const storage = fakeStorage();
    const db = fakeDb();
    await finishStart(db.client, USER, SAM, deps(storage));
    const profile = { course: "other" as const, grade: 3 as const, onboarded_at: db.profile.onboarded_at };
    // another device: no local marker, and even with the board not listed yet
    expect(welcomeDecision({ boards: 0, profile, localDone: false })).toBe("hide");
    expect(welcomeDecision({ boards: 1, profile, localDone: false })).toBe("hide");
    // this device: hidden before the profile is even read
    expect(welcomeDecision({ boards: "loading", profile: "loading", localDone: readLocalDone(storage, USER) })).toBe("hide");
    // (without /start, a new account with no boards would see it)
    expect(welcomeDecision({ boards: 0, profile: { ...profile, onboarded_at: null }, localDone: false })).toBe("show");
  });
});

describe("the first board's skill", () => {
  it("is the plan's: the first skill picked, else the first of the grade's path or the course's topics", () => {
    expect(firstSkills(SAM)).toEqual(["division_facts", "times_tables", "add_subtract_within_1000", "multiply_by_tens"]);
    expect(firstSkills({ ...SAM, focus: [] })).toEqual([...GRADE_PATHS[3]]);
    expect(firstSkills({ ...SAM, choice: { kind: "course", course: "geometry" }, focus: [] })).toEqual([...COURSE_FOCUS.geometry]);
    expect(firstSkills({ ...SAM, choice: { kind: "course", course: "geometry" }, focus: ["circles"] })[0]).toBe("circles");
    expect(firstSkills({ ...SAM, choice: { kind: "course", course: "other" }, focus: [] })).toEqual([]);
    expect(firstSkills({ ...SAM, choice: null, focus: [] })).toEqual([]);
  });

  it("'Not sure' on focus: the board is on the grade's first skill", async () => {
    const storage = fakeStorage();
    const db = fakeDb();
    await finishStart(db.client, USER, { ...SAM, focus: [] }, deps(storage));
    expect(db.calls.boards[0].title).toBe(practiceTitle(skillDef(GRADE_PATHS[3][0])!.name));
    expect(practiceMarker(storage, "board-1")?.skill).toBe(GRADE_PATHS[3][0]);
  });

  it("a picked skill with no practice problems is passed over for the next", () => {
    const kit: PracticeKit = { ...REAL_KIT, hasPractice: (s) => s !== "division_facts" && hasPractice(s) };
    expect(firstBoardPlan(SAM, kit, 7, USER)?.skill).toBe("times_tables");
    const empty: PracticeKit = { ...REAL_KIT, practiceProblems: (s, n, seed) => (s === "division_facts" ? [] : practiceProblems(s, n, seed)) };
    expect(firstBoardPlan(SAM, empty, 7, USER)?.skill).toBe("times_tables");
  });

  it("a grade whose skills all fail falls back to the grade's starters", () => {
    const none: PracticeKit = { ...REAL_KIT, hasPractice: () => false };
    const plan = firstBoardPlan({ ...SAM, choice: { kind: "grade", grade: 0 }, focus: [] }, none, 7, USER);
    expect(plan?.problems).toHaveLength(GRADE_STARTERS[0].length);
    expect(plan?.problems.map((p) => p.join())).toEqual(expect.arrayContaining(GRADE_STARTERS[0].map((s) => s.lines.join())));
    expect(plan?.skill).toMatch(/^(add|subtract)_within_10$/);
    expect(plan?.title).toMatch(/^Practice: (Adding|Taking away) to 10$/);
  });

  it("a high-school course: the first of the course's topics on the plan", async () => {
    const storage = fakeStorage();
    const db = fakeDb();
    const result = await finishStart(db.client, USER, { ...EMPTY_ANSWERS, role: "parent", choice: { kind: "course", course: "algebra1" } }, deps(storage));
    expect(result.failed).toEqual([]);
    expect(db.calls.rpc[0].args).toEqual({ p_course: "algebra1", p_complete: true });
    expect(db.calls.boards[0].title).toBe(practiceTitle(skillDef(COURSE_FOCUS.algebra1[0])!.name));
    const marker = practiceMarker(storage, "board-1");
    expect(marker?.skill).toBe(COURSE_FOCUS.algebra1[0]);
    expect(marker?.problems).toHaveLength(START_PROBLEMS);
  });

  it("a high-school course whose topics have no problems: its starters, named for the course", () => {
    const none: PracticeKit = { ...REAL_KIT, hasPractice: () => false };
    const plan = firstBoardPlan({ ...EMPTY_ANSWERS, choice: { kind: "course", course: "algebra1" } }, none, 7, USER);
    expect(plan?.title).toBe("Practice: Algebra 1");
    expect(plan?.skill).toBe(START_MARKER_SKILL);
    // the course's starters are the course's own, in full
    expect(plan?.problems.map((p) => p.join())).toEqual(expect.arrayContaining(STARTER_PROBLEMS.algebra1.map((s) => s.lines.join())));
    expect(plan?.problems).toHaveLength(STARTER_PROBLEMS.algebra1.length);
  });

  it("no grade and no course: 'Something else's starters, and a plain name", async () => {
    const storage = fakeStorage();
    const db = fakeDb();
    const result = await finishStart(db.client, USER, { ...EMPTY_ANSWERS, role: "kid" }, deps(storage));
    expect(result.boardId).toBe("board-1");
    expect(db.calls.rpc[0].args).toEqual({ p_course: null, p_complete: true });
    expect(db.calls.boards[0].title).toBe(FIRST_BOARD_TITLE);
    expect(practiceMarker(storage, "board-1")?.problems).toHaveLength(STARTER_PROBLEMS.other.length);
  });
});

describe("the name", () => {
  it("no name (skipped), or one that is not a first name: the profile is not touched", async () => {
    for (const name of [null, "", "   ", "Sam123", "x".repeat(40)]) {
      const db = fakeDb();
      const result = await finishStart(db.client, USER, { ...SAM, name }, deps(fakeStorage()));
      expect(result.name, String(name)).toBe("none");
      expect(db.calls.updates).toEqual([]);
      expect(db.profile.display_name).toBeNull();
    }
  });

  it("a profile that already has a name keeps it", async () => {
    const db = fakeDb({ profile: { display_name: "Pat Parent" } });
    const result = await finishStart(db.client, USER, SAM, deps(fakeStorage()));
    expect(result.name).toBe("kept");
    expect(db.profile.display_name).toBe("Pat Parent");
    expect(result.failed).toEqual([]);
  });

  it("is written after save_onboarding (which makes a missing profile row)", async () => {
    const order: string[] = [];
    const db = fakeDb();
    const rpc = db.client.rpc.bind(db.client);
    const from = db.client.from.bind(db.client);
    const client = {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        await new Promise((r) => setTimeout(r, 5));
        order.push("save");
        return rpc(fn, args);
      },
      from: (table: string) => {
        const t = from(table);
        return { ...t, update: (v: Record<string, unknown>) => (order.push("name"), t.update(v)) };
      },
    } as unknown as typeof db.client;
    await finishStart(client, USER, SAM, deps(fakeStorage()));
    expect(order).toEqual(["save", "name"]);
  });
});

describe("failures are never fatal", () => {
  it("save_onboarding refused: the board is still made and opened, no welcome email", async () => {
    const storage = fakeStorage();
    const db = fakeDb({ saveError: true });
    const d = deps(storage);
    const result = await finishStart(db.client, USER, SAM, d);
    expect(result).toMatchObject({ next: boardPath("board-1"), boardId: "board-1", saved: false });
    expect(result.failed).toContain("save");
    expect(d.welcomeEmail).not.toHaveBeenCalled();
    // this device still skips the old welcome
    expect(readLocalDone(storage, USER)).toBe(true);
  });

  it("the name refused: noted, the rest done", async () => {
    const db = fakeDb({ nameError: true });
    const result = await finishStart(db.client, USER, SAM, deps(fakeStorage()));
    expect(result).toMatchObject({ saved: true, name: "failed", boardId: "board-1", failed: ["name"] });
  });

  it("the board refused: no board, nothing remembered, the plan screen next (and due, for the home)", async () => {
    const storage = fakeStorage();
    const db = fakeDb({ boardError: true });
    const result = await finishStart(db.client, USER, SAM, deps(storage));
    expect(result).toMatchObject({ next: PLAN_PATH, boardId: null, saved: true, failed: ["board"] });
    expect(readPlanMarker(storage, USER)).toBe("pending");
    expect(readStartFinished(storage, USER)).toBeNull();
    expect([...storage.data.keys()].some((k) => k.startsWith("agathon.practice."))).toBe(false);
  });

  it("the practice set failing to load is a failed board, not a throw", async () => {
    const db = fakeDb();
    const result = await finishStart(db.client, USER, SAM, deps(fakeStorage(), { practice: async () => Promise.reject(new Error("chunk failed")) }));
    expect(result).toMatchObject({ boardId: null, saved: true, failed: ["board"] });
    expect(db.calls.boards).toEqual([]);
  });

  it("no storage on the device (private mode): the board is made but opens blank", async () => {
    const db = fakeDb();
    const result = await finishStart(db.client, USER, SAM, deps(null));
    expect(result).toMatchObject({ boardId: "board-1", saved: true, failed: ["marker"] });
  });

  it("a client that throws: a result, never an exception", async () => {
    const db = fakeDb({ rpcThrows: true });
    const result = await finishStart(db.client, USER, SAM, deps(fakeStorage()));
    expect(result.next).toBe(boardPath("board-1"));
    expect(result.saved).toBe(false);
    expect(result.boardId).toBe("board-1");
  });

  it("a welcome email that throws changes nothing", async () => {
    const db = fakeDb();
    const result = await finishStart(db.client, USER, SAM, deps(fakeStorage(), { welcomeEmail: () => { throw new Error("no"); } }));
    expect(result.failed).toEqual([]);
  });
});

describe("idempotent", () => {
  it("run twice: one board, the same answer, the name written once", async () => {
    const storage = fakeStorage();
    const db = fakeDb();
    const first = await finishStart(db.client, USER, SAM, deps(storage));
    const second = await finishStart(db.client, USER, SAM, deps(storage));
    expect(db.calls.boards).toHaveLength(1);
    expect(second.boardId).toBe(first.boardId);
    expect(second.saved).toBe(true);
    expect(second.name).toBe("kept");
    expect(db.profile.display_name).toBe("Sam");
    // the RPC is safe to repeat: the first onboarded_at and heard_from stay
    expect(db.calls.rpc).toHaveLength(2);
    expect(readStartFinished(storage, USER)).toEqual({ boardId: "board-1", createdAt: 1_760_000_000_000 });
    expect(storage.getItem(finishedKey(USER))).toBeTruthy();
  });

  it("two at once share one run", async () => {
    const storage = fakeStorage();
    const db = fakeDb();
    const [a, b] = await Promise.all([finishStart(db.client, USER, SAM, deps(storage)), finishStart(db.client, USER, SAM, deps(storage))]);
    expect(a).toBe(b);
    expect(db.calls.boards).toHaveLength(1);
    expect(db.calls.rpc).toHaveLength(1);
  });

  it("a board that failed is tried again on the next run", async () => {
    const storage = fakeStorage();
    await finishStart(fakeDb({ boardError: true }).client, USER, SAM, deps(storage));
    const db = fakeDb();
    const again = await finishStart(db.client, USER, SAM, deps(storage));
    expect(again.boardId).toBe("board-1");
    expect(db.calls.boards).toHaveLength(1);
  });

  it("never sends the plan screen back once it showed", async () => {
    const storage = fakeStorage({ [planKey(USER)]: "seen", [doneKey(USER)]: "1" });
    await finishStart(fakeDb().client, USER, SAM, deps(storage));
    expect(readPlanMarker(storage, USER)).toBe("seen");
  });
});
