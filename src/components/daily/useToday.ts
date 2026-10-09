"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { clientMetric } from "@/lib/logger";
import { reportUserError } from "@/lib/reportAppError";
import { DAILY_GOAL, localDay, type DailyRow, type DailyStreak } from "@/lib/daily/contracts";
import { hasDailyMarker, writeDailyMarker } from "@/lib/daily/dailyMarker";
import { TODAY_COPY } from "@/lib/daily/copy";
import { findDailyMarker, readDailyNote, writeDailyNote } from "@/lib/daily/progress";
import { continueDailyBoard, DAILY_MARKER_SKILL, startDailyBoard, weekdayName, type StartDeps } from "@/lib/daily/start";
import { loadDailyRows, saveDailyPractice } from "@/lib/daily/store";
import { dailyStreak, isDayDone, withProgress } from "@/lib/daily/streak";
import { writePracticeMarker } from "@/lib/learning/practiceMarker";
import { asOnboardingClient, createFirstBoard } from "@/lib/onboarding/storage";
import { namedSkills, type PlanSkill } from "@/lib/daily/names";
import type { DailyPlanInput } from "@/lib/daily/plan";

/**
 * Today's practice on the home (TodayCard): what the day looks like — not started, started, done —
 * with the streak and this week, and the three ways in: Start (a new board with the day's set),
 * Continue (today's board) and Practise more (another set, once the day is done).
 *
 * Reads are the student's own rows plus this device's notes (a board whose row has not landed, a
 * count ahead of the last save). A read that fails still gives Start, never an error on the home.
 * The planner and its generators are fetched after the card is up, so Start is instant.
 */

export type TodayPhase = "start" | "continue" | "done";

export type TodayState =
  | { status: "loading" }
  | {
      status: "ready";
      today: string;
      phase: TodayPhase;
      goal: number;
      done: number;
      stars: number;
      /** today's board, once there is one */
      boardId: string | null;
      /** null when the rows could not be read */
      streak: DailyStreak | null;
      /** the set was finished in the last few minutes: the card cheers once */
      justFinished: boolean;
    };

/** A day finished this recently cheers on the home (the student came straight back from the board). */
const JUST_FINISHED_MS = 15 * 60_000;

/** Reads the day: the rows (with this device's notes folded in) and the streak. Never throws. */
async function readToday(): Promise<Extract<TodayState, { status: "ready" }>> {
  const today = localDay();
  const read = await loadDailyRows(today);
  const row: DailyRow | undefined = read.rows.find((r) => r.day === today);
  const marker = findDailyMarker(today);
  const boardId = row?.boardId ?? marker?.boardId ?? null;
  const note = boardId ? readDailyNote(boardId) : null;
  const goal = row?.goal ?? marker?.goal ?? DAILY_GOAL;
  const done = Math.max(row?.done ?? 0, note?.done ?? 0);
  const stars = Math.min(done, Math.max(row?.stars ?? 0, note?.stars ?? 0));
  const finished = isDayDone({ done, goal, completedAt: row?.completedAt ?? null });
  const completedMs = row?.completedAt ? Date.parse(row.completedAt) : Number.NaN;
  return {
    status: "ready",
    today,
    phase: finished ? "done" : boardId ? "continue" : "start",
    goal,
    done,
    stars,
    boardId,
    streak: read.ok ? dailyStreak(withProgress(read.rows, today, { done, stars, goal, boardId }), today) : null,
    justFinished: finished && Number.isFinite(completedMs) && Date.now() - completedMs < JUST_FINISHED_MS,
  };
}

const client = asOnboardingClient(supabase);

/** The plan's input for today, fetched once per day and kept (the record does not change under the home). */
function usePlanInput(userId: string, today: string | null, wanted: boolean) {
  const cache = useRef<{ day: string; input: Promise<DailyPlanInput> } | null>(null);
  const get = useCallback(
    (day: string): Promise<DailyPlanInput> => {
      if (cache.current?.day !== day) {
        const input = import("@/lib/daily/inputs").then(({ loadDailyPlanInput }) => loadDailyPlanInput(userId, day));
        // a failed fetch is tried again on the next tap
        input.catch(() => {
          if (cache.current?.input === input) cache.current = null;
        });
        cache.current = { day, input };
      }
      return cache.current.input;
    },
    [userId],
  );
  // after the card is up: the planner's chunk and the record, so Start does not wait for them
  useEffect(() => {
    if (!today || !wanted) return;
    const t = setTimeout(() => {
      void import("@/lib/daily/plan").catch(() => {});
      void get(today).catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [today, wanted, get]);
  return get;
}

export interface TodayActions {
  busy: "start" | "continue" | "more" | null;
  start: () => void;
  continueToday: () => void;
  practiseMore: () => void;
}

/**
 * "In today's set": a set not started yet is planned now (the same seed and record Start will use,
 * so the same set); a started one is named from this device's note. Null until known, or when it
 * cannot be (another device's board, a failed read): the card simply leaves it out.
 */
function usePreview(ready: Extract<TodayState, { status: "ready" }> | null, planInput: (day: string) => Promise<DailyPlanInput>): PlanSkill[] | null {
  const [preview, setPreview] = useState<{ key: string; skills: PlanSkill[] } | null>(null);
  const key = ready ? `${ready.today}:${ready.phase}:${ready.boardId ?? ""}` : "";
  useEffect(() => {
    if (!ready || ready.phase === "done") return;
    let live = true;
    if (ready.phase === "continue") {
      const note = ready.boardId ? readDailyNote(ready.boardId) : null;
      // a state update after the effect, as the planned branch does
      void Promise.resolve().then(() => live && setPreview({ key, skills: namedSkills(note?.skills ?? []) }));
    } else {
      void Promise.all([import("@/lib/daily/plan"), planInput(ready.today)]).then(
        ([{ planDailySet, planSkills }, input]) => live && setPreview({ key, skills: planSkills(planDailySet(input)) }),
        () => {},
      );
    }
    return () => {
      live = false;
    };
  }, [ready, key, planInput]);
  return preview && preview.key === key && preview.skills.length > 0 ? preview.skills : null;
}

export function useToday(userId: string): { state: TodayState; actions: TodayActions; preview: PlanSkill[] | null } {
  const router = useRouter();
  const [state, setState] = useState<TodayState>({ status: "loading" });
  const [busy, setBusyState] = useState<TodayActions["busy"]>(null);
  // read synchronously: two quick taps open one board
  const busyRef = useRef<TodayActions["busy"]>(null);
  const setBusy = useCallback((next: TodayActions["busy"]) => {
    busyRef.current = next;
    setBusyState(next);
  }, []);

  const refresh = useCallback(() => {
    let live = true;
    void readToday().then(
      (next) => {
        if (!live) return;
        setState(next);
        clientMetric("daily.card", { phase: next.phase, done: next.done, streak: next.streak?.current ?? null });
      },
      () => {
        // readToday never rejects; belt and braces, the card still offers Start
        if (live) setState({ status: "ready", today: localDay(), phase: "start", goal: DAILY_GOAL, done: 0, stars: 0, boardId: null, streak: null, justFinished: false });
      },
    );
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => refresh(), [refresh]);
  // back on the home from the board (a tab switch, the back button's cached page): read again
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && !busyRef.current) refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onVisible);
    };
  }, [refresh]);

  const ready = state.status === "ready" ? state : null;
  const planInput = usePlanInput(userId, ready?.today ?? null, Boolean(ready));
  const preview = usePreview(ready, planInput);

  const fail = useCallback(
    (code: string, description: string) => {
      toast.error(TODAY_COPY.failedTitle, { description });
      reportUserError({ kind: "live.practice", code, message: TODAY_COPY.failedTitle });
      setBusy(null);
    },
    [setBusy],
  );

  const start = useCallback(() => {
    if (busyRef.current) return;
    setBusy("start");
    const today = localDay();
    void Promise.all([import("@/lib/daily/plan"), planInput(today)])
      .then(async ([{ planDailySet }, input]) => {
        const plan = planDailySet(input);
        if (plan.problems.length === 0) return fail("daily_no_problems", TODAY_COPY.noProblems);
        const deps: StartDeps = {
          createBoard: (title) => createFirstBoard(client, userId, title),
          writePracticeMarker: (m) => writePracticeMarker(m),
          writeDailyMarker: (m) => writeDailyMarker(m),
          writeNote: (n) => writeDailyNote(n),
          save: (s) => saveDailyPractice(s),
          now: Date.now,
        };
        const result = await startDailyBoard(plan, TODAY_COPY.boardTitle(weekdayName(today)), deps);
        if (!result.ok) return fail(result.error === "no_problems" ? "daily_no_problems" : "daily_create_failed", TODAY_COPY.failedLine);
        const count = (why: string) => plan.problems.filter((p) => p.why === why).length;
        clientMetric("daily.start", { goal: plan.goal, next: count("next"), weak: count("weak"), review: count("review"), saved: result.saved, marked: result.marked });
        // busy stays set: the page is leaving
        router.push(`/board/${result.boardId}`);
      })
      .catch(() => fail("daily_start_failed", TODAY_COPY.failedLine));
  }, [planInput, fail, router, setBusy, userId]);

  const continueToday = useCallback(() => {
    if (busyRef.current || !ready?.boardId) return;
    setBusy("continue");
    const boardId = continueDailyBoard({ boardId: ready.boardId, day: ready.today, goal: ready.goal }, { hasDailyMarker, writeDailyMarker, now: Date.now });
    clientMetric("daily.continue", { done: ready.done, goal: ready.goal });
    router.push(`/board/${boardId}`);
  }, [ready, router, setBusy]);

  const practiseMore = useCallback(() => {
    if (busyRef.current) return;
    setBusy("more");
    const today = localDay();
    void Promise.all([import("@/lib/daily/plan"), planInput(today)])
      .then(async ([{ planDailySet }, input]) => {
        // another set from the same path and record: a new seed each time
        const plan = planDailySet({ ...input, salt: `more-${Date.now()}` });
        if (plan.problems.length === 0) return fail("daily_no_problems", TODAY_COPY.noProblems);
        const board = await createFirstBoard(client, userId, TODAY_COPY.moreBoardTitle(weekdayName(today)));
        if (!board.ok) return fail("daily_more_failed", TODAY_COPY.failedLine);
        writePracticeMarker({ boardId: board.value, skill: DAILY_MARKER_SKILL, problems: plan.problems.map((p) => [...p.lines]), createdAt: Date.now() });
        clientMetric("daily.more", { problems: plan.problems.length });
        router.push(`/board/${board.value}`);
      })
      .catch(() => fail("daily_more_failed", TODAY_COPY.failedLine));
  }, [planInput, fail, router, setBusy, userId]);

  return { state, actions: { busy, start, continueToday, practiseMore }, preview };
}
