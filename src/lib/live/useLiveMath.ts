"use client";

import { useEffect, useMemo, useRef } from "react";
import type { Editor } from "tldraw";
import type { LiveController, UseLiveMathOptions } from "./contracts";
import { createLiveLoop, type LiveLoop } from "./liveLoop";
import { resetLiveStore } from "./liveStore";

/**
 * Board-page entry point of the Live layer (spec §6). Subscribes once to the editor
 * store (source 'user', scope 'document'), owns the quiet gate, recognition, local
 * engine, policy, placement and LLM streams via `LiveLoop`, and returns a stable
 * `LiveController` for the UI and the voice tools.
 */
export function useLiveMath(editor: Editor, opts: UseLiveMathOptions): LiveController {
  const loopRef = useRef<LiveLoop | null>(null);
  const optsRef = useRef(opts);
  // Effects run in declaration order: the ref is fresh before the loop is (re)created below.
  useEffect(() => {
    optsRef.current = opts;
  });

  const { boardId, mode, enabled, voiceActive } = opts;

  useEffect(() => {
    const loop = createLiveLoop(editor, optsRef.current);
    loopRef.current = loop;
    loop.start();
    return () => {
      loop.stop();
      if (loopRef.current === loop) loopRef.current = null;
      resetLiveStore();
    };
  }, [editor, boardId]);

  useEffect(() => {
    loopRef.current?.setOptions({ boardId, mode, enabled, voiceActive });
  }, [boardId, mode, enabled, voiceActive]);

  return useMemo<LiveController>(
    () => ({
      getTranscript: () => loopRef.current?.getTranscript() ?? { lines: [], summary: "Live is not ready." },
      placeMath: (args) => loopRef.current?.placeMath(args) ?? null,
      plotFunction: (args) => loopRef.current?.plotFunction(args) ?? null,
      requestCheck: (lineId) => loopRef.current?.requestCheck(lineId),
      requestSolve: (lineId) => loopRef.current?.requestSolve(lineId),
      escalate: (lineId) => loopRef.current?.escalate(lineId),
      dismissHint: (hintId) => loopRef.current?.dismissHint(hintId),
      clearMarks: () => loopRef.current?.clearMarks(),
      retypeLine: (lineId, latex) => loopRef.current?.retypeLine(lineId, latex),
    }),
    [],
  );
}
