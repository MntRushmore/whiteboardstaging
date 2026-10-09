/**
 * Today's practice's markup: the home card in each state (Start, Continue, done), its stars, flame
 * and week; the board's pill and its celebration. Rendered to static HTML, so what a screen reader
 * gets and which buttons exist are checked without a browser.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { DAILY_BOARD_COPY, TODAY_COPY } from "@/lib/daily/copy";
import type { DailyStreak } from "@/lib/daily/contracts";
import { Celebration, ProgressPill } from "../DailyBoard";
import { StarRow, TodayView } from "../TodayCard";
import type { TodayActions, TodayState } from "../useToday";

const html = (node: React.ReactElement) => renderToStaticMarkup(node).replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
const actions: TodayActions = { busy: null, start: vi.fn(), continueToday: vi.fn(), practiseMore: vi.fn() };
const week = (states: DailyStreak["week"][number]["state"][]): DailyStreak["week"] => states.map((state, i) => ({ day: `2026-10-0${5 + i}`, state }));
const streak = (current: number, best = current): DailyStreak => ({ current, best, todayDone: false, week: week(["done", "done", "missed", "today", "future", "future", "future"]) });
const ready = (over: Partial<Extract<TodayState, { status: "ready" }>> = {}): Extract<TodayState, { status: "ready" }> => ({
  status: "ready",
  today: "2026-10-08",
  phase: "start",
  goal: 5,
  done: 0,
  stars: 0,
  boardId: null,
  streak: streak(2),
  justFinished: false,
  ...over,
});

describe("TodayCard", () => {
  it("not started: one big Start that says what it starts, 5 problems and about 10 minutes", () => {
    const out = html(<TodayView state={ready()} actions={actions} />);
    expect(out).toContain(TODAY_COPY.eyebrow);
    expect(out).toContain(TODAY_COPY.title(5));
    expect(out).toContain(TODAY_COPY.minutes(5));
    expect(out).toContain(`aria-label="${TODAY_COPY.startLabel(5)}"`);
    expect(out).not.toContain(TODAY_COPY.continue);
    expect(out).not.toContain(TODAY_COPY.more);
    expect(out).toMatch(/<section[^>]*aria-labelledby="today-practice-title"/);
  });

  it("started: Continue, how many are done, and the stars so far", () => {
    const out = html(<TodayView state={ready({ phase: "continue", done: 3, stars: 2, boardId: "b" })} actions={actions} />);
    expect(out).toContain(TODAY_COPY.progress(3, 5));
    expect(out).toContain(TODAY_COPY.minutesLeft(2));
    expect(out).toContain(`aria-label="${TODAY_COPY.continueLabel(3, 5)}"`);
    expect(out).toContain(`aria-label="${TODAY_COPY.starsLabel(2, 3, 5)}"`);
    expect(out.match(/data-star="star"/g)).toHaveLength(2);
    expect(out.match(/data-star="done"/g)).toHaveLength(1);
    expect(out.match(/data-star="empty"/g)).toHaveLength(2);
  });

  it("done: You did it, Come back tomorrow, and only a small Practise more", () => {
    const out = html(<TodayView state={ready({ phase: "done", done: 5, stars: 5, boardId: "b" })} actions={actions} />);
    expect(out).toContain(TODAY_COPY.doneTitle);
    expect(out).toContain(TODAY_COPY.doneLine);
    expect(out).toContain(TODAY_COPY.more);
    expect(out).not.toContain(TODAY_COPY.startLabel(5));
    expect(out.match(/<button\b/g)).toHaveLength(1);
  });

  it("the flame counts the streak in words, and this week is a labelled list with today marked", () => {
    const out = html(<TodayView state={ready({ streak: streak(4, 9) })} actions={actions} />);
    expect(out).toContain(TODAY_COPY.streak(4));
    expect(out).toContain(TODAY_COPY.best(9));
    expect(out).toMatch(/<ol[^>]*aria-label="This week"/);
    expect(out.match(/<li\b/g)).toHaveLength(7);
    expect(out).toContain('aria-label="Monday: done"');
    expect(out).toContain('aria-label="Wednesday: not done"');
    expect(out).toMatch(/data-state="today" data-today=""/);
  });

  it("no streak yet: an invitation, no number", () => {
    const out = html(<TodayView state={ready({ streak: { ...streak(0), best: 0 } })} actions={actions} />);
    expect(out).toContain(TODAY_COPY.streakNone);
    expect(out).not.toContain("Best:");
  });

  it("the rows could not be read: still Start, just no streak", () => {
    const out = html(<TodayView state={ready({ streak: null })} actions={actions} />);
    expect(out).toContain(TODAY_COPY.startLabel(5));
    expect(out).not.toContain("This week");
  });

  it("star slots never outnumber the goal", () => {
    const out = html(<StarRow goal={5} done={8} stars={7} />);
    expect(out.match(/data-star=/g)).toHaveLength(5);
    expect(out).toContain(`aria-label="${TODAY_COPY.starsLabel(5, 5, 5)}"`);
  });
});

describe("DailyBoard", () => {
  const spot = { top: 23, right: 72, inline: true };

  it("the pill: the stars and 3 of 5, read out as one, and it lets touches through (no buttons)", () => {
    const out = html(<ProgressPill goal={5} done={3} stars={2} spot={spot} />);
    expect(out).toContain(`aria-label="${DAILY_BOARD_COPY.pillLabel(2, 3, 5)}"`);
    expect(out).toContain(">3 of 5<");
    expect(out).toContain("top:23px;right:72px");
    expect(out).not.toContain("<button");
    expect(out).not.toContain("data-complete");
  });

  it("past the goal: 5 of 5 and the extra ones", () => {
    const out = html(<ProgressPill goal={5} done={7} stars={6} spot={spot} />);
    expect(out).toContain(">5 of 5<");
    expect(out).toContain(">+2<");
    expect(out).toContain('data-complete=""');
  });

  it("the celebration: You did it, the streak, Back home and Keep going, a close button", () => {
    const out = html(<Celebration goal={5} stars={4} streak={4} writing={false} onHome={vi.fn()} onKeepGoing={vi.fn()} onClose={vi.fn()} />);
    expect(out).toMatch(/role="dialog"[^>]*aria-labelledby="daily-celebrate-title"/);
    expect(out).toContain(DAILY_BOARD_COPY.title);
    expect(out).toContain(DAILY_BOARD_COPY.streak(4));
    expect(out).toContain(DAILY_BOARD_COPY.stars(4, 5));
    expect(out).toContain(DAILY_BOARD_COPY.home);
    expect(out).toContain(DAILY_BOARD_COPY.keepGoing);
    expect(out).toContain(`aria-label="${DAILY_BOARD_COPY.close}"`);
    expect(out.match(/<button\b/g)).toHaveLength(3);
  });

  it("a first day says so, and all five solved alone says that too", () => {
    const out = html(<Celebration goal={5} stars={5} streak={1} writing onHome={vi.fn()} onKeepGoing={vi.fn()} onClose={vi.fn()} />);
    expect(out).toContain(DAILY_BOARD_COPY.streak(1));
    expect(out).toContain(DAILY_BOARD_COPY.stars(5, 5));
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*aria-busy="true"/);
  });
});
