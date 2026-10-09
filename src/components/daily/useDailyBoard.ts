"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { toast } from "sonner";
import { onPracticeRunEnd, practicePending } from "@/components/learning/usePracticeBoard";
import { learningBus } from "@/lib/learning/bus";
import type { LiveController } from "@/lib/live/contracts";
import { clientMetric } from "@/lib/logger";
import { reportUserError } from "@/lib/reportAppError";
import { DAILY_BOARD_COPY } from "@/lib/daily/copy";
import { localDay, type DailyRow } from "@/lib/daily/contracts";
import { dailyMarkerFor, type DailyMarker } from "@/lib/daily/dailyMarker";
import {
  countedKeys,
  doneOf,
  initialProgress,
  problemsShort,
  progressReducer,
  readDailyNote,
  starsOf,
  topUpProblems,
  writeDailyNote,
  type DailyNote,
  type DailyProgress,
} from "@/lib/daily/progress";
import { loadBoardCounted, loadDailyRows, saveDailyPractice } from "@/lib/daily/store";
import { dailyStreak, withProgress } from "@/lib/daily/streak";

/**
 * A Today's practice board's count (`DailyBoard`): the day's marker says which day and goal (only
 * on that day, and only for the student it was made for: `dailyMarkerFor`); the count starts from
 * this device's note and the saved row (`progressReducer` never counts a problem twice; when the row
 * holds more than the note, another device counted it, and the learning record says which
 * problems), goes up with each finished set problem the tracker publishes on the learning bus, and
 * is written back — to the note at once, to the row a moment later (debounced, and when the page
 * goes away). Reaching the goal on this visit is the celebration's moment; "Keep going" has the
 * tutor write three more on a new screen.
 *
 * A SET CUT SHORT IS FINISHED HERE. The set's problems are written by `PracticeBoard` after the
 * board opens; a reload while the tutor's hand is writing, a problem the engine leaves out, or a
 * board that was not ready can leave fewer on the board than the goal. Once nothing on the board is
 * left to do and the goal is still short (`problemsShort`), the tutor writes what is missing: the
 * set's own problems first, then more of its skills. Never while the set's own run is still to
 * come or writing (`practicePending`), and a few times a visit at most.
 */

/** Waits this long after the last change before saving (a burst of attempts is one save). */
export const SAVE_DEBOUNCE_MS = 1_200;
/** The goal's last tick has its own cheer on the board (about 2 s): the celebration comes right after. */
export const CELEBRATION_DELAY_MS = 1_900;
/** After the last problem on the board is done, a moment to see its tick before the rest of the set goes on. */
export const TOP_UP_DELAY_MS = 2_500;
/** Times a visit the board writes what its set is missing (a problem the engine leaves out is not tried again). */
export const MAX_TOP_UPS = 3;

export interface DailyBoardState {
  marker: DailyMarker | null;
  goal: number;
  done: number;
  stars: number;
  /** the celebration is showing */
  celebrating: boolean;
  /** the streak with today done (for "4 days in a row"), once the rows are read; 1 without them */
  streak: number;
  /** "Keep going" (or the rest of a set cut short) is writing */
  writing: boolean;
}

/** A problem on the board, by the key the count uses (`boardProblems`). */
export type BoardProblem = { key: string; lines: string[] };

function noteOf(marker: DailyMarker, p: DailyProgress, prev: DailyNote | null): DailyNote {
  return {
    boardId: marker.boardId,
    day: marker.day,
    done: doneOf(p),
    stars: starsOf(p),
    counted: countedKeys(p),
    skills: prev?.skills ?? [],
    ...(prev?.problems ? { problems: prev.problems } : {}),
    createdAt: prev?.createdAt ?? marker.createdAt,
  };
}

/** The set's skills: the note's, else the skills of what was worked on this board this visit. */
function setSkills(note: DailyNote | null, boardId: string): string[] {
  if (note?.skills.length) return note.skills;
  return [...new Set(learningBus.attempts().filter((a) => a.boardId === boardId).map((a) => a.skill as string))];
}

/**
 * The board's count for `userId`. `problemsOnBoard` lists the problems on every screen of the board
 * (`DailyBoard` reads them from the editor), for finishing a set cut short.
 */
export function useDailyBoard(
  boardId: string,
  userId: string,
  controller: LiveController,
  problemsOnBoard: () => BoardProblem[],
): DailyBoardState & { dismiss: () => void; keepGoing: () => void } {
  // today's set, this student's: yesterday's board opened today is an ordinary board
  const [marker] = useState(() => dailyMarkerFor(boardId, { day: localDay(), userId }));
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
    void loadDailyRows(localDay()).then(async (read) => {
      if (!live) return;
      const row = read.rows.find((r) => r.day === marker.day);
      // a second board made the same day on another device: the row's count is not this board's
      if (row && (row.boardId === null || row.boardId === boardId)) {
        saved.current = { done: row.done, stars: row.stars };
        dispatch({ type: "restore", done: row.done, stars: row.stars });
        // counted where this device's note did not see it: which problems, from the learning
        // record, before anything is saved (a problem answered again here is not one more)
        if (row.done > (firstNote?.done ?? 0)) {
          const elsewhere = await loadBoardCounted(boardId);
          if (!live) return;
          if (elsewhere) dispatch({ type: "restore", done: elsewhere.done, stars: 0, counted: elsewhere.counted });
        }
      }
      setRows(read.rows);
    });
    return () => {
      live = false;
    };
  }, [marker, boardId, firstNote]);

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
      if (!row) {
        saved.current = before;
        return;
      }
      // the row's stars never go down: neither do the ones on screen
      dispatch({ type: "saved", stars: row.stars });
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

  // the goal reached on this visit: the celebration, once — just after the last tick's own cheer
  // (`Celebrations`, about 2 s), so the two never cover each other
  const [reached, setReached] = useState(false);
  useEffect(() => {
    if (!progress.reachedNow || !marker) return;
    dispatch({ type: "celebrated" });
    clientMetric("daily.complete", { goal: marker.goal, stars: starsOf(progress) });
    setReached(true);
  }, [progress, marker]);
  useEffect(() => {
    if (!reached) return;
    const t = setTimeout(() => {
      setReached(false);
      setCelebrating(true);
    }, CELEBRATION_DELAY_MS);
    return () => clearTimeout(t);
  }, [reached]);

  // ---------------------------------------------------------------- a set cut short

  // the set's own run ending (written or not) is a moment to look again
  const [runEnds, setRunEnds] = useState(0);
  useEffect(() => {
    if (!marker) return;
    return onPracticeRunEnd((id) => {
      if (id === boardId) setRunEnds((n) => n + 1);
    });
  }, [marker, boardId]);

  /** this visit's top-ups: how many, and the problems tried (one the engine left out is not tried again) */
  const topUps = useRef<{ count: number; tried: string[][] }>({ count: 0, tried: [] });

  const topUp = useCallback(
    (need: number, onBoard: BoardProblem[], counted: readonly string[]) => {
      const run = controller.runChatActions;
      if (!marker || !run) return;
      const tries = topUps.current;
      tries.count++;
      setWriting(true);
      const note = noteRef.current;
      const last = tries.count >= MAX_TOP_UPS;
      const failed = (code: string) => {
        if (!last) return;
        toast(DAILY_BOARD_COPY.topUpFailed);
        reportUserError({ kind: "live.practice", code, message: DAILY_BOARD_COPY.topUpFailed, boardId });
      };
      void import("@/lib/daily/plan")
        .then(async ({ bonusProblems }) => {
          // the set's own problems first (a write cut short), then more of its skills
          const { problems, fromSet } = topUpProblems(need, { planned: note?.problems ?? [], onBoard, counted, tried: tries.tried }, (n, exclude) =>
            bonusProblems(setSkills(note, boardId), Date.now(), n, exclude),
          );
          if (problems.length === 0) return failed("daily_topup_none");
          toast(DAILY_BOARD_COPY.topUpToast(problems.length));
          const report = await run([{ type: "write_problems", problems }], { origin: "practice" });
          // what went on is on the board now; what did not is not tried again
          tries.tried.push(...problems);
          clientMetric("daily.topup", { need, fromSet, written: report.problemsWritten });
          if (report.problemsWritten === 0) return failed("daily_topup_none_written");
          const more = problems.slice(fromSet);
          if (more.length > 0 && noteRef.current) {
            const next = { ...noteRef.current, problems: [...(noteRef.current.problems ?? []), ...more] };
            noteRef.current = next;
            writeDailyNote(next);
          }
        })
        .catch(() => failed("daily_topup_failed"))
        .finally(() => setWriting(false));
    },
    [marker, boardId, controller],
  );

  // once nothing on the board is left to do and the goal is still short: the rest of the set
  useEffect(() => {
    if (!marker || rows === null || writing || !controller.runChatActions || topUps.current.count >= MAX_TOP_UPS) return;
    if (practicePending(boardId)) return;
    // (a change before the moment is up starts it again: this effect runs on every count)
    const t = setTimeout(() => {
      const onBoard = problemsOnBoard();
      const need = problemsShort(progress, onBoard.map((p) => p.key));
      if (need > 0) topUp(need, onBoard, countedKeys(progress));
    }, TOP_UP_DELAY_MS);
    return () => clearTimeout(t);
  }, [marker, rows, writing, controller, progress, runEnds, boardId, problemsOnBoard, topUp]);

  const streak = marker && rows ? Math.max(1, dailyStreak(withProgress(rows, marker.day, { done, stars, goal: marker.goal, boardId }), localDay()).current) : 1;

  const dismiss = useCallback(() => setCelebrating(false), []);

  const keepGoing = useCallback(() => {
    setCelebrating(false);
    if (writing || !marker) return;
    setWriting(true);
    const note = noteRef.current;
    const skills = setSkills(note, boardId);
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
