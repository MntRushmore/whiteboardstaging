"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { LiveController } from "@/lib/live/contracts";
import { requestLecture } from "@/lib/live/lecture/client";
import type { SpeechSource } from "@/lib/live/lecture/contracts";
import type { LectureErrorCode } from "@/lib/live/lecture/session";
import { createScriptSource, createSpeechSource } from "@/lib/live/lecture/speech";
import { LECTURE_OFF, LectureRunner, type LectureLive, type LectureLiveState } from "./lectureRunner";
import { browserStorage, type LectureHandleStatus } from "./lectureView";

export type { LectureLive, LectureLiveState } from "./lectureRunner";

/**
 * Lecture mode on a board, for React: a `LectureRunner` per board (the logic, tested in node) and
 * the handle the page gives the button and the panel.
 *
 * The handle only changes when the lecture's state does (off → starting → listening ⇄ paused, an
 * error): the page that holds it re-renders a handful of times per lecture. What moves all the
 * time — the words being heard, the timer — is in `live`, an external store only the panel
 * subscribes to (`useLectureLive`), so the board around it is not re-rendered at every word.
 */

export interface LectureHandle {
  status: LectureHandleStatus;
  /** why the lecture ended in error (the panel has words for each) */
  error: LectureErrorCode | null;
  /** how it is listening: ElevenLabs, the browser's recognizer, or a script */
  source: SpeechSource["kind"] | null;
  /** the transcript, the timer, what was drawn: subscribe with `useLectureLive(lecture)` */
  live: LectureLive;
  /** first time on this device: status "consent" (the panel shows the note); confirm → starts */
  start(): void;
  confirmConsent(): void;
  cancelConsent(): void;
  stop(): void;
  pause(): void;
  resume(): void;
  drawThat(): void;
  /** dev/QA: run a scripted transcript instead of the microphone (no consent, no token) */
  startScripted(lines: Array<{ atMs: number; text: string }>, opts?: { speed?: number }): void;
}

export function useLecture(boardId: string, controller: LiveController): LectureHandle {
  // one runner per board: moving to another board (or leaving) ends the lecture
  const runner = useMemo(
    () =>
      new LectureRunner({
        boardId,
        openSpeech: () => createSpeechSource(),
        openScript: (lines, opts) => createScriptSource(lines, opts),
        request: (req, signal) => requestLecture(req, signal),
        storage: browserStorage,
      }),
    [boardId],
  );
  useEffect(() => () => runner.dispose(), [runner]);
  // the session always reaches the controller of the moment (set before any click can start one)
  useEffect(() => runner.setController(controller), [runner, controller]);

  const coarse = useSyncExternalStore(runner.coarse.subscribe, runner.coarse.get, () => LECTURE_OFF);

  return useMemo(
    () => ({
      ...coarse,
      live: runner.live,
      start: runner.start,
      confirmConsent: runner.confirmConsent,
      cancelConsent: runner.cancelConsent,
      stop: runner.stop,
      pause: runner.pause,
      resume: runner.resume,
      drawThat: runner.drawThat,
      startScripted: runner.startScripted,
    }),
    [coarse, runner],
  );
}

/** The panel's view of the lecture as it moves (re-renders at every word and every second). */
export function useLectureLive(lecture: Pick<LectureHandle, "live">): LectureLiveState | null {
  return useSyncExternalStore(lecture.live.subscribe, lecture.live.get, lecture.live.get);
}
