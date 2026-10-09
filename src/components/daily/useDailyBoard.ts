"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { toast } from "sonner";
import { learningBus } from "@/lib/learning/bus";
import type { LiveController } from "@/lib/live/contracts";
import { clientMetric } from "@/lib/logger";
import { reportUserError } from "@/lib/reportAppError";
import { DAILY_BOARD_COPY } from "@/lib/daily/copy";
import { localDay, type DailyRow } from "@/lib/daily/contracts";
import { readDailyMarker, type DailyMarker } from "@/lib/daily/dailyMarker";
import { countedIds, doneOf, initialProgress, progressReducer, readDailyNote, starsOf, writeDailyNote, type DailyNote, type DailyProgress } from "@/lib/daily/progress";
import { loadDailyRows, saveDailyPractice } from "@/lib/daily/store";
import { dailyStreak, withProgress } from "@/lib/daily/streak";

/**
 * A Today's practice board's count (`DailyBoard`): the day's marker says which day and goal; the
 * count starts from this device's note and the saved row (`progressReducer` never counts anything
 * twice), goes up with each finished set problem the tracker publishes on the learning bus, and is
 * written back — to the note at once, to the row a moment later (debounced, and when the page
 * goes away). Reaching the goal on this visit is the celebration's moment; "Keep going" has the
 * tutor write three more on a new screen.
 */

/** Waits this long after the last change before saving (a burst of attempts is one save). */
export const SAVE_DEBOUNCE_MS = 1_200;

export interface DailyBoardState {
  marker: DailyMarker | null;
  goal: number;
  done: number;
  stars: number;
  /** the celebration is showing */
  celebrating: boolean;
  /** the streak with today done (for "4 days in a row"), once the rows are read; 1 without them */
  streak: number;
  /** "Keep going" is writing */
  writing: boolean;
}

function noteOf(marker: DailyMarker, p: DailyProgress, prev: DailyNote | null): DailyNote {
  return {
    boardId: marker.boardId,
    day: marker.day,
    done: doneOf(p),
    stars: starsOf(p),
    counted: countedIds(p),
    skills: prev?.skills ?? [],
    ...(prev?.problems ? { problems: prev.problems } : {}),
    createdAt: prev?.createdAt ?? marker.createdAt,
  };
}

export function useDailyBoard(boardId: string, controller: LiveController): DailyBoardState & { dismiss: () => void; keepGoing: () => void } {
  const [marker] = useState(() => readDailyMarker(boardId));
  const [firstNote] = useState(() => (marker ? readDailyNote(boardId) : null));
  const noteRef = useRef<DailyNote | null>(firstNote);
  const [progress, dispatch] = useReducer(progressReducer, null, () => {
    const start = initialProgress(marker?.goal ?? 1);
    return firstNote ? progressReducer(start, { type: "restore", done: firstNote.done, stars: firstNote.stars, counted: firstNote.counted }) : start;
  });
  // null until the rows are read (or could not be): nothing is saved before, so a save never
  // races the read
  const [rows, setRows] = useState<DailyRow[] | null>(null);
  const [celebrating, setCelebrating] = useState(false);
  const [writing, setWriting] = useState(false);
  /** what the row holds, as far as this visit knows */
  const saved = useRef({ done: 0, stars: 0 });

  // the saved row: what other visits and devices counted
  useEffect(() => {
    if (!marker) return;
    let live = true;
    void loadDailyRows(localDay()).then((read) => {
      if (!live) return;
      const row = read.rows.find((r) => r.day === marker.day);
      // a second board made the same day on another device: the row's count is not this board's
      if (row && (row.boardId === null || row.boardId === boardId)) {
        saved.current = { done: row.done, stars: row.stars };
        dispatch({ type: "restore", done: row.done, stars: row.stars });
      }
      setRows(read.rows);
    });
    return () => {
      live = false;
    };
  }, [marker, boardId]);

  // every attempt the tracker publishes, and those published before this loaded
  useEffect(() => {
    if (!marker) return;
    for (const record of learningBus.attempts()) dispatch({ type: "attempt", record, boardId });
    return learningBus.onAttempt((record) => dispatch({ type: "attempt", record, boardId }));
  }, [marker, boardId]);

  const done = doneOf(progress);
  const stars = starsOf(progress);

  const latest = useRef({ done, stars });
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const save = useCallback(() => {
    if (pending.current) clearTimeout(pending.current);
    pending.current = null;
    if (!marker) return;
    const { done: d, stars: s } = latest.current;
    const before = saved.current;
    if (d <= before.done && s <= before.stars) return;
    saved.current = { done: Math.max(d, before.done), stars: Math.max(s, before.stars) };
    void saveDailyPractice({ day: marker.day, boardId, goal: marker.goal, done: d, stars: s }).then((row) => {
      // not saved: the next change (or visit) sends the higher numbers again
      if (!row) saved.current = before;
    });
  }, [marker, boardId]);

  // the note at once; the row after a quiet moment (once it has been read)
  useEffect(() => {
    latest.current = { done, stars };
    if (!marker) return;
    const note = noteOf(marker, progress, noteRef.current);
    noteRef.current = note;
    writeDailyNote(note);
    if (rows === null || (done <= saved.current.done && stars <= saved.current.stars)) return;
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(save, SAVE_DEBOUNCE_MS);
  }, [marker, progress, done, stars, rows, save]);

  // and whatever is waiting, when the page goes away
  useEffect(() => {
    const flush = () => {
      if (pending.current) save();
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [save]);

  // the goal reached on this visit: the celebration, once
  useEffect(() => {
    if (!progress.reachedNow || !marker) return;
    dispatch({ type: "celebrated" });
    setCelebrating(true);
    clientMetric("daily.complete", { goal: marker.goal, stars: starsOf(progress) });
  }, [progress, marker]);

  const streak = marker && rows ? Math.max(1, dailyStreak(withProgress(rows, marker.day, { done, stars, goal: marker.goal, boardId }), localDay()).current) : 1;

  const dismiss = useCallback(() => setCelebrating(false), []);

  const keepGoing = useCallback(() => {
    setCelebrating(false);
    if (writing || !marker) return;
    setWriting(true);
    const note = noteRef.current;
    const skills = note?.skills.length ? note.skills : [...new Set(learningBus.attempts().filter((a) => a.boardId === boardId).map((a) => a.skill as string))];
    const failed = (code: string) => {
      toast(DAILY_BOARD_COPY.bonusFailed);
      reportUserError({ kind: "live.practice", code, message: DAILY_BOARD_COPY.bonusFailed, boardId });
    };
    void import("@/lib/daily/plan")
      .then(async ({ bonusProblems, BONUS_PROBLEMS }) => {
        const problems = bonusProblems(skills, Date.now(), BONUS_PROBLEMS, note?.problems ?? []);
        if (problems.length === 0 || !controller.runChatActions) return failed("daily_bonus_none");
        toast(DAILY_BOARD_COPY.bonusToast);
        const report = await controller.runChatActions([{ type: "new_screen" }, { type: "write_problems", problems }], { origin: "practice" });
        clientMetric("daily.bonus", { written: report.problemsWritten });
        if (report.problemsWritten === 0) return failed("daily_bonus_none_written");
        if (noteRef.current) {
          const next = { ...noteRef.current, problems: [...(noteRef.current.problems ?? []), ...problems] };
          noteRef.current = next;
          writeDailyNote(next);
        }
      })
      .catch(() => failed("daily_bonus_failed"))
      .finally(() => setWriting(false));
  }, [writing, marker, boardId, controller]);

  return { marker, goal: marker?.goal ?? 0, done, stars, celebrating, streak, writing, dismiss, keepGoing };
}
