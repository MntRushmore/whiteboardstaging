/**
 * SAT v2 (docs/SAT-V2.md): the mistake deck's schedule (src/lib/sat/reviews.ts), the bank's
 * optional notes in the contract (src/lib/sat/contracts.ts: lengths, a `why` only on a wrong
 * choice, `common_wrong` only for spr), and their mechanical checks (src/lib/sat/lint.ts: a nudge
 * that gives the answer away, a "wrong" grid-in that is right, LaTeX) with a failing note dropped
 * and the question kept.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SatQuestionSchema, type SatQuestion } from "@/lib/sat/contracts";
import { addDays } from "@/lib/sat/day";
import { dropFailingNotes, noteIssues, noteLeaks, numbersIn, questionIssues } from "@/lib/sat/lint";
import { countReviews, dueReviews, nextReview, type ReviewRow } from "@/lib/sat/reviews";

const SAMPLE = JSON.parse(readFileSync(join(__dirname, "..", "..", "..", "..", "docs", "sat", "sample-20.json"), "utf8")) as SatQuestion[];
const mcq = SAMPLE[0]; // "If 3x - 7 = 11, ..." key B ($6$)
const spr = SAMPLE[1];
const NOW = "2026-10-23T15:00:00.000Z";

describe("the mistake deck's schedule", () => {
  const row = (due_on: string, step: 1 | 2, cleared_at: string | null = null): ReviewRow => ({ question_id: mcq.id, due_on, step, cleared_at });

  it("a miss: step 1, due tomorrow (across a month end), whatever was there", () => {
    expect(nextReview(null, false, "2026-10-31", NOW)).toEqual({ due_on: "2026-11-01", step: 1, cleared_at: null });
    expect(nextReview(row("2026-10-25", 2), false, "2026-10-23", NOW)).toEqual({ due_on: "2026-10-24", step: 1, cleared_at: null });
    expect(nextReview(row("2026-10-20", 2, "2026-10-20T00:00:00Z"), false, "2026-10-23", NOW)).toEqual({ due_on: "2026-10-24", step: 1, cleared_at: null });
    // already due tomorrow at step 1: nothing to write
    expect(nextReview(row("2026-10-24", 1), false, "2026-10-23", NOW)).toBeNull();
  });

  it("right on a due review moves it on; right when not due, or with no review, changes nothing", () => {
    expect(nextReview(row("2026-10-23", 1), true, "2026-10-23", NOW)).toEqual({ due_on: "2026-10-26", step: 2, cleared_at: null });
    expect(nextReview(row("2026-10-20", 1), true, "2026-10-23", NOW)).toEqual({ due_on: "2026-10-26", step: 2, cleared_at: null });
    expect(nextReview(row("2026-10-23", 2), true, "2026-10-23", NOW)).toEqual({ due_on: "2026-10-23", step: 2, cleared_at: NOW });
    expect(nextReview(row("2026-10-24", 1), true, "2026-10-23", NOW)).toBeNull();
    expect(nextReview(row("2026-10-20", 2, "2026-10-20T00:00:00Z"), true, "2026-10-23", NOW)).toBeNull();
    expect(nextReview(null, true, "2026-10-23", NOW)).toBeNull();
  });

  it("due today first, oldest first; counts due and waiting, never the cleared", () => {
    const rows = [
      { question_id: "b", due_on: "2026-10-23", cleared_at: null },
      { question_id: "a", due_on: "2026-10-23", cleared_at: null },
      { question_id: "c", due_on: "2026-10-21", cleared_at: null },
      { question_id: "d", due_on: "2026-10-24", cleared_at: null },
      { question_id: "e", due_on: "2026-10-20", cleared_at: "2026-10-20T00:00:00Z" },
    ];
    expect(dueReviews(rows, "2026-10-23").map((r) => r.question_id)).toEqual(["c", "a", "b"]);
    expect(countReviews(rows, "2026-10-23")).toEqual({ reviews_due: 3, reviews_waiting: 1 });
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("the notes in the contract", () => {
  const ok = (q: unknown) => SatQuestionSchema.safeParse(q).success;
  const whys = (q: SatQuestion, f: (key: string) => string | undefined) => ({ ...q, choices: q.choices!.map((c) => (f(c.key) === undefined ? c : { ...c, why: f(c.key) })) });

  it("are optional: every v1 question still fits", () => {
    for (const q of SAMPLE) expect(ok(q), q.id).toBe(true);
  });

  it("fit within their lengths", () => {
    expect(ok({ ...mcq, nudge: "x".repeat(120) })).toBe(true);
    expect(ok({ ...mcq, nudge: "x".repeat(121) })).toBe(false);
    expect(ok({ ...mcq, nudge: "" })).toBe(false);
    expect(ok(whys(mcq, (k) => (k === "A" ? "y".repeat(140) : undefined)))).toBe(true);
    expect(ok(whys(mcq, (k) => (k === "A" ? "y".repeat(141) : undefined)))).toBe(false);
    expect(ok({ ...spr, common_wrong: [1, 2, 3].map((n) => ({ answer: String(n), why: "A slip." })) })).toBe(true);
    expect(ok({ ...spr, common_wrong: [1, 2, 3, 4].map((n) => ({ answer: String(n), why: "A slip." })) })).toBe(false);
    expect(ok({ ...spr, common_wrong: [{ answer: "1234567", why: "Too long." }] })).toBe(false);
    expect(ok({ ...mcq, solution: { ...mcq.solution, desmos_steps: null } })).toBe(true);
    expect(ok({ ...mcq, solution: { ...mcq.solution, desmos_steps: [{ text: "Type y = 3x + 4.", math: "y=3x+4" }] } })).toBe(true);
    expect(ok({ ...mcq, solution: { ...mcq.solution, desmos_steps: [] } })).toBe(false);
    expect(ok({ ...mcq, extra: 1 })).toBe(false);
  });

  it("a why only on a wrong choice; common_wrong only on a grid-in", () => {
    expect(ok(whys(mcq, (k) => (k === "B" ? "The right one." : undefined)))).toBe(false);
    expect(ok({ ...mcq, common_wrong: [] })).toBe(false);
  });
});

describe("the notes' checks", () => {
  it("reads numbers as values", () => {
    expect(numbersIn("Try $\\frac{3}{4}$ of 12, or -2.5 and .5 at x-3")).toEqual([0.75, 12, -2.5, 0.5, 3]);
  });

  it("a nudge that gives the answer away leaks; one that points the way does not", () => {
    const answerText = mcq.choices!.find((c) => c.key === "B")!.text;
    expect(noteLeaks(mcq, "What do both sides have in common?")).toBeNull();
    expect(noteLeaks(mcq, "Choice B looks right.")).toMatch(/names choice B/);
    expect(noteLeaks(mcq, "It's (B).")).toMatch(/names choice B/);
    expect(noteLeaks(mcq, "The answer is close.")).toMatch(/says what the answer is/);
    // a numeric key's value
    const value = Number(answerText.replace(/\$/g, ""));
    if (Number.isFinite(value)) expect(noteLeaks(mcq, `Check whether x is ${value}.`)).toMatch(/answer's value/);
    // a grid-in's value, but not a number the stem already gives
    const accepted = "accepted" in spr.answer ? spr.answer.accepted[0] : "";
    expect(noteLeaks(spr, `Is it ${accepted}?`)).toMatch(/answer's value/);
    const given = spr.stem.match(/\d+/)![0];
    if (!(spr.answer as { accepted: string[] }).accepted.includes(given)) expect(noteLeaks(spr, `Start from the ${given}.`)).toBeNull();
  });

  it("a common wrong grid-in must be a valid grid-in, really wrong, and listed once", () => {
    const right = (spr.answer as { accepted: string[] }).accepted[0];
    const q = { ...spr, common_wrong: [{ answer: right, why: "Right, oddly." }, { answer: "1 1/2", why: "Mixed." }, { answer: "-3", why: "Sign." }, { answer: "-6/2", why: "Same." }] };
    const issues = noteIssues(q);
    expect(issues).toEqual(expect.arrayContaining([expect.stringMatching(/is a right answer/), expect.stringMatching(/not a valid grid-in/), expect.stringMatching(/listed twice/)]));
  });

  it("a failing note is dropped and the question kept (status and checks untouched)", () => {
    const q: SatQuestion = {
      ...mcq,
      nudge: "Choice B is the one.",
      choices: mcq.choices!.map((c) => (c.key === "A" ? { ...c, why: "Used \\dfrac wrongly: $\\dfrac{1}{2}$." } : c.key === "C" ? { ...c, why: "Added 4 instead of subtracting it." } : c)),
      solution: { ...mcq.solution, desmos_steps: [{ text: "Type it", math: "$y=3x$" }] },
    };
    const { q: clean, dropped } = dropFailingNotes(q);
    expect(dropped.sort()).toEqual(["desmos_steps", "nudge", "why A"]);
    expect(clean.nudge).toBeUndefined();
    expect(clean.choices!.find((c) => c.key === "A")!.why).toBeUndefined();
    expect(clean.choices!.find((c) => c.key === "C")!.why).toBe("Added 4 instead of subtracting it.");
    expect(clean.solution.desmos_steps).toBeUndefined();
    expect(clean.status).toBe(mcq.status);
    expect(questionIssues(clean)).toEqual([]);
    expect(noteIssues(clean)).toEqual([]);
    // the input is not changed
    expect(q.nudge).toBe("Choice B is the one.");
    const sprQ = { ...spr, common_wrong: [{ answer: (spr.answer as { accepted: string[] }).accepted[0], why: "Right." }, { answer: "-1", why: "Sign slip." }] };
    expect(dropFailingNotes(sprQ).q.common_wrong).toEqual([{ answer: "-1", why: "Sign slip." }]);
  });
});
