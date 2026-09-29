"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { LiveController } from "@/lib/live/contracts";
import type { SpeechSource } from "@/lib/live/lecture/contracts";
import type { LectureErrorCode } from "@/lib/live/lecture/session";
import type { LectureCoarse, LectureLive, LectureLiveState, LectureRunner } from "./lectureRunner";
import type { LectureHandleStatus } from "./lectureView";

export type { LectureLive, LectureLiveState } from "./lectureRunner";

/**
 * Lecture mode on a board, for React: a `LectureRunner` per board (the logic, tested in node) and
 * the handle the page gives the button and the panel.
 *
 * The runner and everything under it (the session, the speech sources, the director's client) are
 * loaded on the first start (`lectureRuntime.ts`): until then the handle is "off" and costs the
 * board's first load nothing but this file. The handle only changes when the lecture's state does
 * (off → starting → listening ⇄ paused, an error): the page that holds it re-renders a handful of
 * times per lecture. What moves all the time — the words being heard, the timer — is in `live`, an
 * external store only the panel subscribes to (`useLectureLive`), so the board around it is not
 * re-rendered at every word.
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

/** Before the runner is loaded: off, and nothing moving. */
const OFF: LectureCoarse = { status: "off", error: null, source: null };
const noSubscribe = () => () => {};
const offCoarse = () => OFF;
const NO_LIVE: LectureLive = { subscribe: noSubscribe, get: () => null };

export function useLecture(boardId: string, controller: LiveController): LectureHandle {
  // one runner per board, made on the first start: moving to another board (or leaving) ends the lecture
  const [runner, setRunner] = useState<LectureRunner | null>(null);
  const loading = useRef<{ boardId: string; runner: Promise<LectureRunner> } | null>(null);
  const controllerRef = useRef(controller);
  useEffect(() => {
    controllerRef.current = controller;
    // the session always reaches the controller of the moment
    runner?.setController(controller);
  }, [runner, controller]);
  useEffect(() => {
    return () => {
      loading.current = null;
      setRunner(null);
    };
  }, [boardId]);
  useEffect(() => (runner ? () => runner.dispose() : undefined), [runner]);

  const load = useCallback((): Promise<LectureRunner> => {
    if (loading.current?.boardId !== boardId) {
      const made = import("./lectureRuntime").then(({ createLectureRunner }) => {
        const r = createLectureRunner(boardId);
        r.setController(controllerRef.current);
        // a board left while it loaded does not get it
        if (loading.current?.runner === made) setRunner(r);
        return r;
      });
      loading.current = { boardId, runner: made };
    }
    return loading.current.runner;
  }, [boardId]);

  const coarse = useSyncExternalStore(runner?.coarse.subscribe ?? noSubscribe, runner?.coarse.get ?? offCoarse, offCoarse);

  return useMemo(
    () => ({
      ...coarse,
      live: runner?.live ?? NO_LIVE,
      start: () => void load().then((r) => r.start()),
      confirmConsent: () => runner?.confirmConsent(),
      cancelConsent: () => runner?.cancelConsent(),
      stop: () => runner?.stop(),
      pause: () => runner?.pause(),
      resume: () => runner?.resume(),
      drawThat: () => runner?.drawThat(),
      startScripted: (lines, opts) => void load().then((r) => r.startScripted(lines, opts)),
    }),
    [coarse, runner, load],
  );
}

/** The panel's view of the lecture as it moves (re-renders at every word and every second). */
export function useLectureLive(lecture: Pick<LectureHandle, "live">): LectureLiveState | null {
  return useSyncExternalStore(lecture.live.subscribe, lecture.live.get, lecture.live.get);
}
