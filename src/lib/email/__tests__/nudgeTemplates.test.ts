/**
 * The free trial's emails to the grown-up (src/lib/email/templates.ts): the first-practice nudge,
 * the progress email, and the progress added to the "trial ends" reminder. What each says, where it
 * links, and that a name is the only thing a user typed that gets in, escaped.
 */
import { describe, expect, it } from "vitest";
import {
  firstPracticeEmail,
  listOf,
  progressLines,
  trialProgressEmail,
  trialReminderEmail,
  whose,
  type LearnerProgress,
} from "@/lib/email/templates";

const SITE = "https://agathon.app";
const PORTAL = "https://billing.stripe.com/p/login/test_abc";
const TRIAL_END = new Date("2026-10-15T03:04:00Z"); // Wednesday, October 14, 11:04 PM EDT

const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
const visible = (html: string) =>
  html
    .replace(/<head>[\s\S]*?<\/head>/, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#847;|&zwnj;|&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ");

function p(over: Partial<LearnerProgress> = {}): LearnerProgress {
  return { name: "Maya", tried: 14, solved: 12, alone: 9, skills: ["Times tables", "Adding fractions"], streak: 3, practiceDays: 3, ...over };
}

describe("the little words", () => {
  it("lists, and says whose", () => {
    expect(listOf([])).toBe("");
    expect(listOf(["A"])).toBe("A");
    expect(listOf(["A", "B"])).toBe("A and B");
    expect(listOf(["A", "B", "C"])).toBe("A, B and C");
    expect(listOf(["A", "B", "C", "D", "E"])).toBe("A, B, C and 2 more");
    expect(whose(["Maya"])).toBe("Maya's");
    expect(whose(["Maya", "Leo"])).toBe("Maya and Leo's");
    expect(whose([])).toBeNull();
    expect(whose(["A", "B", "C"])).toBeNull();
  });

  it("says a learner's trial in short lines", () => {
    expect(progressLines(p())).toEqual(["12 problems solved, 9 without help", "Practiced: Times tables and Adding fractions", "Today's practice: 3 days in a row"]);
    expect(progressLines(p({ solved: 1, alone: 0, skills: [], streak: 1, practiceDays: 1 }))).toEqual(["1 problem solved", "Today's practice: done on 1 day"]);
    expect(progressLines(p({ solved: 1, alone: 1, skills: [], streak: 0, practiceDays: 0 }))).toEqual(["1 problem solved, without help"]);
    expect(progressLines(p({ solved: 4, alone: 4, skills: [], streak: 0, practiceDays: 0 }))).toEqual(["4 problems solved, all without help"]);
    expect(progressLines(p({ solved: 0, alone: 0, tried: 2, skills: ["Long division"], streak: 0, practiceDays: 0 }))).toEqual(["2 problems started", "Practiced: Long division"]);
    expect(progressLines(p({ solved: 0, alone: 0, tried: 0, skills: [], streak: 0, practiceDays: 0 }))).toEqual([]);
  });
});

describe("firstPracticeEmail", () => {
  const base = { names: ["Maya"], problems: 5, minutes: 10, siteUrl: SITE, manageUrl: PORTAL, planName: "Agathon Unlimited" };

  it("names the child, the size of the set, and opens the home", () => {
    const e = firstPracticeEmail(base);
    expect(e.subject).toBe("Maya's first practice is ready: 5 problems, about 10 minutes");
    expect(visible(e.html)).toContain("Maya writes each step by hand");
    expect(visible(e.html)).toContain("tap Today's practice on the home screen");
    expect(hrefs(e.html)).toEqual([`${SITE}/`, PORTAL]);
    expect(e.text).toContain(`Open Today's practice: ${SITE}/`);
    expect(visible(e.html)).not.toContain("!");
  });

  it("reads without a name, and for two or more children", () => {
    expect(firstPracticeEmail({ ...base, names: [] }).subject).toBe("Today's practice is ready: 5 problems, about 10 minutes");
    const two = firstPracticeEmail({ ...base, names: ["Maya", "Leo"] });
    expect(two.subject).toBe("Maya and Leo's first practice is ready: 5 problems, about 10 minutes");
    expect(two.text).toContain("Each child has a set of their own");
    expect(firstPracticeEmail({ ...base, names: ["A", "B", "C"] }).subject).toMatch(/^Today's practice is ready/);
  });

  it("escapes the name", () => {
    expect(firstPracticeEmail({ ...base, names: ["O'Neil"] }).html).toContain("O&#39;Neil");
  });
});

describe("trialProgressEmail", () => {
  const base = { progress: [p()], trialEnd: TRIAL_END, siteUrl: SITE, manageUrl: PORTAL, planName: "Agathon Unlimited" };

  it("says what each child did, when the trial ends, and how to stop", () => {
    const e = trialProgressEmail(base);
    expect(e.subject).toBe("Maya's first days on Agathon");
    const text = visible(e.html);
    expect(text).toContain("Here's what Maya has done so far:");
    expect(text).toContain("12 problems solved, 9 without help");
    expect(text).toContain("Today's practice: 3 days in a row");
    expect(text).toContain("The free trial runs until Wednesday, October 14.");
    expect(hrefs(e.html)).toEqual([PORTAL, `${SITE}/`]);
    expect(e.text).toContain("- Maya: 12 problems solved, 9 without help. Practiced: Times tables and Adding fractions. Today's practice: 3 days in a row.");
  });

  it("names two children together", () => {
    const e = trialProgressEmail({ ...base, progress: [p(), p({ name: "Leo" })] });
    expect(e.subject).toBe("Maya and Leo's first days on Agathon");
    expect(visible(e.html)).toContain("Here's what Maya and Leo have done so far:");
  });

  it("names nobody when a child has no safe name, and leaves out the quiet ones", () => {
    const e = trialProgressEmail({ ...base, progress: [p(), p({ name: null }), p({ name: "Leo", tried: 0, solved: 0, alone: 0, skills: [], streak: 0, practiceDays: 0 })] });
    expect(e.subject).toBe("Your first days on Agathon");
    expect(visible(e.html)).toContain("Here's what's been done so far:");
    expect(visible(e.html)).not.toContain("Leo");
  });

  it("refuses to be sent with nothing to say", () => {
    expect(() => trialProgressEmail({ ...base, progress: [p({ tried: 0, solved: 0, alone: 0, skills: [], streak: 0, practiceDays: 0 })] })).toThrow();
  });
});

describe("trialReminderEmail with progress", () => {
  const base = { trialEnd: TRIAL_END, manageUrl: PORTAL, siteUrl: SITE, planName: "Agathon Unlimited", monthlyUsd: 25 };

  it("adds what the family did, after the facts and before the way to cancel", () => {
    const e = trialReminderEmail({ ...base, progress: [p()] });
    const text = visible(e.html);
    const at = (s: string) => text.indexOf(s);
    expect(at("Nothing to do if you'd like to keep it.")).toBeLessThan(at("Here's what Maya has done so far:"));
    expect(at("12 problems solved, 9 without help")).toBeLessThan(at("To cancel, use"));
    expect(e.text).toContain("- Maya: 12 problems solved");
  });

  it("is unchanged without progress", () => {
    expect(trialReminderEmail({ ...base, progress: [] })).toEqual(trialReminderEmail(base));
    expect(trialReminderEmail({ ...base, progress: [p({ tried: 0, solved: 0, alone: 0, skills: [], streak: 0, practiceDays: 0 })] })).toEqual(trialReminderEmail(base));
  });
});
