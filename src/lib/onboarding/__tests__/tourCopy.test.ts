/**
 * The guided board's words, held to what a six-year-old reading alone needs: short, the board's
 * own button names, the hint of their starter in the first coach mark, and never "wrong".
 */
import { describe, expect, it } from "vitest";
import { LIVE_COPY } from "@/components/live/copy";
import { CHAT_COPY, CHAT_INK, CHAT_SUGGESTIONS, MORE_LIKE_THESE } from "@/components/chat/chatView";
import { initialTour, type TourHelp, type TourState } from "../state";
import { askCopy, helpCopy, TOUR_COPY, writeCopy, type CoachCopy } from "../tourCopy";

const HELPS: TourHelp[] = ["waiting", "asked", "empty", "unread", "slow"];
const HINT = "Try taking 3 from both sides.";

function writeStates(): Array<Pick<TourState, "step" | "outcome" | "unread" | "unjudged">> {
  const base = initialTour("write");
  return [
    base,
    { ...base, unread: true },
    { ...base, unjudged: true },
    { ...base, step: "result", outcome: "tick" },
    { ...base, step: "result", outcome: "ring" },
  ];
}

function everyCopy(): CoachCopy[] {
  const all: CoachCopy[] = [];
  for (const s of writeStates()) all.push(writeCopy(s, HINT), writeCopy(s, null));
  for (const h of HELPS) for (const solve of [false, true]) all.push(helpCopy("help", h, solve), helpCopy("helped", h, solve));
  for (const busy of [false, true]) for (const suggestion of [MORE_LIKE_THESE, null]) for (const step of ["ask", "asking"] as const) all.push(askCopy(step, { busy, suggestion, ink: CHAT_INK }));
  return all;
}

describe("the guided board's words", () => {
  it("are short: a title a child reads at a glance, at most two short sentences under it", () => {
    for (const c of everyCopy()) {
      expect(c.title.length, c.title).toBeLessThanOrEqual(56);
      expect(c.body.length, c.body).toBeLessThanOrEqual(110);
      expect(c.body.split(/[.!?](\s|$)/).filter((s) => s.trim()).length, c.body).toBeLessThanOrEqual(3);
    }
    for (const r of TOUR_COPY.finish.recap) expect(r.text.length).toBeLessThanOrEqual(40);
  });

  it("never say wrong, and never blame", () => {
    const words = [...everyCopy().flatMap((c) => [c.title, c.body]), TOUR_COPY.writingProblem, TOUR_COPY.finish.title, TOUR_COPY.finish.lede, ...TOUR_COPY.finish.recap.map((r) => r.text)];
    for (const w of words) expect(w, w).not.toMatch(/\bwrong\b|\bmistake\b|\bfail/i);
  });

  it("name the buttons exactly as the board shows them", () => {
    expect(helpCopy("help", "waiting").title).toContain(LIVE_COPY.ask.help);
    expect(helpCopy("help", "waiting", true).title).toContain(LIVE_COPY.ask.solve);
    expect(helpCopy("help", "empty").body).toContain(LIVE_COPY.ask.help);
    expect(askCopy("ask", { busy: false, suggestion: null, ink: CHAT_INK }).title).toContain(CHAT_COPY.button);
    // the suggestion it points at is one the panel offers
    expect(CHAT_SUGGESTIONS).toContain(MORE_LIKE_THESE);
    expect(askCopy("asking", { busy: false, suggestion: MORE_LIKE_THESE, ink: CHAT_INK }).title).toContain(MORE_LIKE_THESE);
    expect(TOUR_COPY.finish.recap.map((r) => r.text).join(" ")).toContain(LIVE_COPY.ask.help);
  });

  it("coach mark 1 carries the starter's hint, and explains each mark", () => {
    expect(writeCopy(initialTour("write"), HINT).body).toContain(HINT);
    expect(writeCopy(initialTour("write"), HINT).title).toMatch(/next step/);
    expect(writeCopy(initialTour("write"), null).title).not.toMatch(/under the problem/);
    expect(writeCopy({ ...initialTour("write"), unjudged: true }, HINT).body).toContain(HINT);
    expect(writeCopy({ ...initialTour("write"), step: "result", outcome: "tick" }, HINT).title).toMatch(/tick/);
    expect(writeCopy({ ...initialTour("write"), step: "result", outcome: "ring" }, HINT).title).toMatch(/ring/);
  });

  it("the button is outlined while the board waits for the student, solid once it has answered", () => {
    expect(writeCopy(initialTour("write"), HINT).waiting).toBe(true);
    expect(writeCopy({ ...initialTour("write"), step: "result", outcome: "tick" }, HINT).waiting).toBe(false);
    expect(helpCopy("help", "waiting").waiting).toBe(true);
    expect(helpCopy("helped", "asked").waiting).toBe(false);
    for (const c of everyCopy()) expect(c.button).toBe(TOUR_COPY.next);
  });

  it("says what each ask costs, in the panel's own number", () => {
    expect(askCopy("asking", { busy: false, suggestion: MORE_LIKE_THESE, ink: CHAT_INK }).body).toContain(`${CHAT_INK} ink`);
  });

  it("tells a stuck Help me apart: nothing to help with, unreadable, slow", () => {
    const bodies = HELPS.map((h) => helpCopy("help", h).body);
    expect(new Set(bodies).size).toBe(HELPS.length);
    expect(helpCopy("help", "slow").body).toMatch(/Next/);
  });

  it("says the tip number for screen readers", () => {
    expect(TOUR_COPY.tip(2, 3)).toBe("Tip 2 of 3");
  });
});
