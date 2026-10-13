/**
 * Sign in, then finish: /start answers kept on the device (`pending.ts`) are saved to the account
 * that signs in next, when it has not been onboarded (`resumeStart`), with the real `finishStart`
 * against the fake database for the whole path.
 */
import { describe, expect, it, vi } from "vitest";
import { readLocalDone, readTourMarker } from "@/lib/onboarding/marker";
import { PLAN_PATH, readPlanMarker } from "@/lib/onboarding/planMarker";
import { fetchOnboardingProfile } from "@/lib/onboarding/storage";
import { hasPractice, practiceProblems } from "@/lib/learning/practiceSet";
import { practiceTitle } from "@/lib/learning/progressView";
import type { StartAnswers } from "../contracts";
import { finishStart, type FinishResult } from "../finish";
import { clearStartPending, hasStartPending, readStartPending, START_PENDING_KEY, START_PENDING_TTL_MS, writeStartPending } from "../pending";
import { resumeStart, type ResumeDeps } from "../resume";
import { fakeDb, fakeStorage, type FakeStorage } from "./fakes";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

const USER = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-2222-4333-8444-555555555555";
const NOW = 1_760_000_000_000;
const KID: StartAnswers = { role: "kid", name: "Ava", choice: { kind: "grade", grade: 1 }, focus: [], tried: { checked: true, solved: true }, heardFrom: null };
const FINISHED: FinishResult = { next: PLAN_PATH, boardId: "board-9", saved: true, name: "named", failed: [] };

function stubDeps(storage: FakeStorage, onboarded_at: string | null | "error" = null) {
  return {
    storage,
    now: () => NOW,
    readProfile: vi.fn(async () =>
      onboarded_at === "error" ? { ok: false as const, error: "offline" } : { ok: true as const, value: { course: null, grade: null, onboarded_at } },
    ),
    linkJourney: vi.fn(async () => undefined),
    finish: vi.fn(async () => FINISHED),
  } satisfies ResumeDeps;
}

describe("pending answers on the device", () => {
  it("written, read for any account (no id yet) or only its own, cleared", () => {
    const storage = fakeStorage();
    expect(hasStartPending(storage)).toBe(false);
    expect(writeStartPending(storage, KID, NOW, null)).toBe(true);
    expect(hasStartPending(storage)).toBe(true);
    expect(readStartPending(storage, USER, NOW)).toEqual({ answers: KID, createdAt: NOW });
    expect(readStartPending(storage, OTHER, NOW)).toEqual({ answers: KID, createdAt: NOW });
    writeStartPending(storage, KID, NOW, USER);
    expect(readStartPending(storage, USER, NOW)?.userId).toBe(USER);
    expect(readStartPending(storage, OTHER, NOW)).toBeNull();
    // another account's are left for it
    expect(hasStartPending(storage)).toBe(true);
    clearStartPending(storage);
    expect(hasStartPending(storage)).toBe(false);
  });

  it("too old, or unreadable: dropped", () => {
    const storage = fakeStorage();
    writeStartPending(storage, KID, NOW, null);
    expect(readStartPending(storage, USER, NOW + START_PENDING_TTL_MS + 1)).toBeNull();
    expect(hasStartPending(storage)).toBe(false);
    for (const junk of ["{", "null", '"x"', JSON.stringify({ answers: "nope", createdAt: NOW }), JSON.stringify({ answers: KID })]) {
      storage.setItem(START_PENDING_KEY, junk);
      expect(readStartPending(storage, USER, NOW), junk).toBeNull();
      expect(hasStartPending(storage)).toBe(false);
    }
  });

  it("no storage (private mode): nothing kept, nothing thrown", () => {
    expect(writeStartPending(null, KID, NOW)).toBe(false);
    expect(readStartPending(null, USER, NOW)).toBeNull();
    const refusing = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("full"); }, removeItem: () => { throw new Error("denied"); } };
    expect(writeStartPending(refusing, KID, NOW)).toBe(false);
    expect(hasStartPending(refusing)).toBe(false);
    expect(readStartPending(refusing, USER, NOW)).toBeNull();
    expect(() => clearStartPending(refusing)).not.toThrow();
  });
});

describe("resumeStart", () => {
  it("nothing pending: nothing read, nothing done", async () => {
    const deps = stubDeps(fakeStorage());
    expect(await resumeStart(USER, deps)).toEqual({ kind: "none" });
    expect(deps.readProfile).not.toHaveBeenCalled();
  });

  it("an account that has not been onboarded: the answers are saved to it, then forgotten", async () => {
    const storage = fakeStorage();
    writeStartPending(storage, KID, NOW, null);
    const deps = stubDeps(storage);
    expect(await resumeStart(USER, deps)).toEqual({ kind: "finished", next: "/welcome/plan", result: FINISHED });
    expect(deps.linkJourney).toHaveBeenCalledWith(USER);
    expect(deps.finish).toHaveBeenCalledWith(USER, KID);
    expect(hasStartPending(storage)).toBe(false);
  });

  it("an onboarded account is left as it is: the answers are dropped", async () => {
    const storage = fakeStorage();
    writeStartPending(storage, KID, NOW, null);
    const deps = stubDeps(storage, "2026-09-01T00:00:00Z");
    expect(await resumeStart(USER, deps)).toEqual({ kind: "dropped" });
    expect(deps.finish).not.toHaveBeenCalled();
    expect(hasStartPending(storage)).toBe(false);
  });

  it("a profile that cannot be read: try again on the next page", async () => {
    const storage = fakeStorage();
    writeStartPending(storage, KID, NOW, null);
    const deps = stubDeps(storage, "error");
    expect(await resumeStart(USER, deps)).toEqual({ kind: "wait" });
    expect(deps.finish).not.toHaveBeenCalled();
    expect(hasStartPending(storage)).toBe(true);
  });

  it("answers kept for another account wait for it", async () => {
    const storage = fakeStorage();
    writeStartPending(storage, KID, NOW, OTHER);
    const deps = stubDeps(storage);
    expect(await resumeStart(USER, deps)).toEqual({ kind: "none" });
    expect(hasStartPending(storage)).toBe(true);
  });

  it("the answers are checked again on the way out of storage", async () => {
    const storage = fakeStorage();
    storage.setItem(START_PENDING_KEY, JSON.stringify({ answers: { ...KID, name: "<b>Ava</b>", email: "x@y.z", focus: ["nope"] }, createdAt: NOW }));
    const deps = stubDeps(storage);
    await resumeStart(USER, deps);
    expect(deps.finish).toHaveBeenCalledWith(USER, { ...KID, name: null, focus: [] });
  });
});

describe("Sign in, then finish (the whole path)", () => {
  it("'Already have an account? Sign in' on /start, then a sign-in: the account gets the plan, the board, and the plan screen next", async () => {
    const storage = fakeStorage();
    // the account screen's Sign in link
    writeStartPending(storage, KID, NOW, null);
    // the account that signs in: made before, never onboarded
    const db = fakeDb();
    const outcome = await resumeStart(USER, {
      storage,
      now: () => NOW,
      readProfile: (id) => fetchOnboardingProfile(db.client, id),
      linkJourney: async () => undefined,
      finish: (id, answers) =>
        finishStart(db.client, id, answers, { storage, now: () => NOW, seed: () => 1, practice: async () => ({ hasPractice, practiceProblems, practiceTitle }), welcomeEmail: () => undefined }),
    });
    expect(outcome).toMatchObject({ kind: "finished", next: "/welcome/plan" });
    expect(db.profile).toMatchObject({ course: "other", grade: 1, display_name: "Ava" });
    expect(db.profile.onboarded_at).toBeTruthy();
    expect(db.calls.boards).toEqual([{ title: "Practice: Adding to 20", data: {}, user_id: USER }]);
    expect(readLocalDone(storage, USER)).toBe(true);
    expect(readTourMarker(storage, USER)).toBeNull();
    expect(readPlanMarker(storage, USER)).toBe("pending");
    expect(hasStartPending(storage)).toBe(false);
  });
});
