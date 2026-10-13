"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { clientMetric } from "@/lib/logger";
import { useInkSummary } from "@/lib/billing/useInkSummary";
import {
  DONE_OUTCOMES,
  countDone,
  freeBoardApplies,
  freeBoardGate,
  isDone,
  oldestBoard,
  readFreeBoardEnd,
  writeFreeBoardEnd,
  type DoneRow,
  type FreeBoardEnd,
  type FreeBoardView,
} from "@/lib/billing/freeBoard";
import { holdNewBoards } from "@/lib/billing/newBoards";
import { learningBus } from "@/lib/learning/bus";
import type { AttemptRecord } from "@/lib/learning/contracts";
import { browserStorage, type StorageLike } from "@/lib/onboarding/marker";
import { PLAN_PATH } from "@/lib/onboarding/planMarker";
import { usePlanInput } from "./usePlanGate";

/** A board as the home lists it: enough to find the oldest. */
export type FreeBoardListItem = { id: string; created_at: string | null };

export interface UseFreeBoardOptions {
  /** false on a page or moment the gate must leave alone: no user yet, the welcome, the guided board */
  enabled?: boolean;
  page: "home" | "board";
  /** the board page's board */
  boardId?: string;
  /** the home's boards once read (it has them already); undefined while loading or after a failed read */
  boards?: readonly FreeBoardListItem[];
  /** the board page: an AI call here is refused for ink right now (a Live 402, `liveStore.lastError`) */
  inkRefused?: boolean;
}

export interface FreeBoardState extends FreeBoardView {
  /** the problems could not be read: the banner shows no count (and nobody is held over it) */
  doneUnknown: boolean;
}

/** The account's oldest live board (RLS: own, not deleted); undefined when the read failed. */
async function readOldestBoard(): Promise<string | null | undefined> {
  try {
    const { data, error } = await supabase.from("whiteboards").select("id, created_at").order("created_at", { ascending: true }).order("id", { ascending: true }).limit(1);
    return error ? undefined : oldestBoard((data ?? []) as FreeBoardListItem[]);
  } catch {
    return undefined;
  }
}

/** The free board's finished attempts, as saved; null when the read failed. */
async function readDoneRows(boardId: string): Promise<DoneRow[] | null> {
  try {
    const { data, error } = await supabase.from("learning_attempts").select("id, problem_latex, outcome, origin").eq("board_id", boardId).in("outcome", [...DONE_OUTCOMES]).limit(200);
    if (error) return null;
    return ((data ?? []) as { id: string; problem_latex: string | null; outcome: string; origin: string }[]).map((r) => ({ id: r.id, problemLatex: r.problem_latex, outcome: r.outcome, origin: r.origin }));
  } catch {
    return null;
  }
}

/** The funnel's recorder, fetched once, when the free board first ends (not in the board's first load). */
let recorder: Promise<typeof import("@/lib/funnel/record")> | null = null;
const loadRecorder = () => (recorder ??= import("@/lib/funnel/record"));

/**
 * The free board is over: this device remembers it, and `free_board_done` is recorded once (the
 * device's mark says it was; the recorder itself sends a step at most once a page load). True
 * when it was new.
 */
export function noteFreeBoardEnded(userId: string, end: FreeBoardEnd, storage: StorageLike | null = browserStorage()): boolean {
  if (readFreeBoardEnd(storage, userId)) return false;
  writeFreeBoardEnd(storage, userId, end);
  clientMetric("free_board.done", { reason: end });
  void loadRecorder()
    .then((m) => m.recordFunnelStep("free_board_done", { reason: end }))
    .catch(() => {
      recorder = null;
    });
  return true;
}

/**
 * The paywall with the free board (`src/lib/billing/freeBoard.ts`), for the home and the boards:
 *  - `locked` sends the student to the plan screen (another board, or the free board used up);
 *  - `free` keeps them: the board page is the free board; the home holds new boards (making one
 *    goes to the plan screen, `newBoards.ts`) and shows the free board's progress;
 *  - on the free board, `usedUp` turns on the moment its 5th problem is done or its ink is refused:
 *    the page shows the sheet, and stays.
 *
 * Reads only for an account without a plan (`freeBoardApplies`): the board page asks for the
 * oldest board (the home has its list), and both ask for the free board's finished attempts; the
 * board page adds those its tracker publishes as they finish (`learningBus`), so the 5th counts at
 * once. The ink is the summary every page reads already. A read that fails holds nobody.
 */
export function useFreeBoard({ enabled = true, page, boardId: pageBoard, boards, inkRefused = false }: UseFreeBoardOptions): FreeBoardState {
  const router = useRouter();
  const { input, userId, state } = usePlanInput(enabled);
  const { summary } = useInkSummary();
  const applies = freeBoardApplies(input) && Boolean(userId);
  const boardId = page === "board" ? (pageBoard ?? null) : null;

  // which board is the free one: the home's list, or one small read on the board page
  const [oldest, setOldest] = useState<{ userId: string; id: string | null } | null>(null);
  useEffect(() => {
    if (page !== "board" || !applies || !userId) return;
    let live = true;
    void readOldestBoard().then((id) => {
      if (live && id !== undefined) setOldest({ userId, id });
    });
    return () => {
      live = false;
    };
  }, [page, applies, userId, boardId]);
  const listed = useMemo(() => (boards ? oldestBoard(boards) : undefined), [boards]);
  const freeBoardId = page === "home" ? listed : oldest && oldest.userId === userId ? oldest.id : undefined;

  // its problems done: the saved ones, and (on the board) those finished on this visit
  const countOn = applies && freeBoardId && (page === "home" || freeBoardId === boardId) ? freeBoardId : null;
  const [saved, setSaved] = useState<{ boardId: string; rows: DoneRow[] | null } | null>(null);
  useEffect(() => {
    if (!countOn) return;
    let live = true;
    void readDoneRows(countOn).then((rows) => {
      if (live) setSaved({ boardId: countOn, rows });
    });
    return () => {
      live = false;
    };
  }, [countOn]);
  const [fresh, setFresh] = useState<{ boardId: string; rows: DoneRow[] } | null>(null);
  useEffect(() => {
    if (page !== "board" || !countOn) return;
    const take = (r: AttemptRecord) => {
      if (r.boardId !== countOn || !isDone(r)) return;
      const row: DoneRow = { id: r.id, problemLatex: r.problemLatex, outcome: r.outcome, origin: r.origin };
      // counted once, when it first finishes: the count never goes back down
      setFresh((prev) => (prev?.boardId === countOn ? (prev.rows.some((p) => p.id === r.id) ? prev : { boardId: countOn, rows: [...prev.rows, row] }) : { boardId: countOn, rows: [row] }));
    };
    learningBus.attempts().forEach(take);
    return learningBus.onAttempt(take);
  }, [page, countOn]);
  const savedRows = saved && saved.boardId === countOn ? saved : null;
  const freshRows = fresh && fresh.boardId === countOn ? fresh.rows : [];
  // a failed read counts what this visit finished (it holds nobody: the ink still bounds the cost)
  const done = savedRows ? countDone([...(savedRows.rows ?? []), ...freshRows]) : null;

  // an ink refusal on this board is remembered for the visit (the error itself clears on a retry)
  const [refusedOn, setRefusedOn] = useState<string | null>(null);
  if (inkRefused && boardId !== null && refusedOn !== boardId) setRefusedOn(boardId);
  const endedOnDevice = useMemo(() => readFreeBoardEnd(browserStorage(), userId), [userId]);
  // the board page showed this board free, with its problems read: its end here is the moment, not a redirect
  const [freeOn, setFreeOn] = useState<string | null>(null);

  const view = freeBoardGate({
    ...input,
    freeBoardId,
    boardId,
    done,
    ink: summary ? summary.balance : null,
    inkRefused: boardId !== null && refusedOn === boardId,
    endedOnDevice,
    wasFree: boardId !== null && freeOn === boardId,
  });
  if (boardId !== null && freeOn !== boardId && view.gate === "free" && !view.usedUp && view.freeBoardId === boardId && done !== null) setFreeOn(boardId);

  const { gate, ended, usedUp } = view;
  useEffect(() => {
    if (gate !== "locked") return;
    clientMetric("plan.gate.locked", { page, status: state.status, free: ended ?? "other" });
    router.replace(PLAN_PATH);
  }, [gate, page, state.status, ended, router]);

  useEffect(() => {
    if (ended && userId && (gate === "locked" || usedUp)) noteFreeBoardEnded(userId, ended);
  }, [ended, userId, gate, usedUp]);

  // the home: one free board, so a new one goes to the plan screen (none yet: the first is the free one)
  const holding = page === "home" && gate === "free" && view.freeBoardId !== null;
  useEffect(() => {
    if (!holding) return;
    return holdNewBoards(() => {
      clientMetric("free_board.new_board", {});
      router.push(PLAN_PATH);
    });
  }, [holding, router]);

  return { ...view, doneUnknown: Boolean(savedRows && savedRows.rows === null) };
}
