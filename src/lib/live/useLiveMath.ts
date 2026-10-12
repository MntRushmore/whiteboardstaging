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
 * `LiveController` for the UI and the board chat.
 */
export function useLiveMath(editor: Editor, opts: UseLiveMathOptions): LiveController {
  const loopRef = useRef<LiveLoop | null>(null);
  const optsRef = useRef(opts);
  /** the Type it bar asked for its writer (`prepareTyped`): a loop made after that gets it too */
  const typedRef = useRef(false);
  // Effects run in declaration order: the ref is fresh before the loop is (re)created below.
  useEffect(() => {
    optsRef.current = opts;
  });

  const { boardId, mode, enabled, auto } = opts;

  useEffect(() => {
    const loop = createLiveLoop(editor, optsRef.current);
    loopRef.current = loop;
    loop.start();
    if (typedRef.current) loop.prepareTyped().catch(() => undefined);
    return () => {
      loop.stop();
      if (loopRef.current === loop) loopRef.current = null;
      resetLiveStore();
    };
  }, [editor, boardId]);

  useEffect(() => {
    loopRef.current?.setOptions({ boardId, mode, enabled, auto });
  }, [boardId, mode, enabled, auto]);

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    // Dev-only QA handle: `__agathonAskImage()` is what an ask would send (`chatImage`, policy and
    // all); `__agathonAskImage({ force: true })` captures whatever the screen holds.
    type Handle = (o?: { force?: boolean; timeoutMs?: number }) => Promise<string | null>;
    const w = window as unknown as { __agathonAskImage?: Handle };
    const handle: Handle = async (o = {}) => (o.force ? (await import("./ask/boardImage")).captureAskImage(editor, o) : ((await loopRef.current?.chatImage()) ?? null));
    w.__agathonAskImage = handle;
    return () => {
      if (w.__agathonAskImage === handle) delete w.__agathonAskImage;
    };
  }, [editor]);

  return useMemo<LiveController>(() => {
    // Every ask from the UI says so first (`LiveLoop.noteAsked`): its failures are shown, and with
    // Auto off its problem gets the marks Auto would have drawn. Auto's own actions skip this.
    const asked = (lineId?: string): LiveLoop | null => {
      loopRef.current?.noteAsked(lineId);
      return loopRef.current;
    };
    return {
      getTranscript: () => loopRef.current?.getTranscript() ?? { lines: [], summary: "Live is not ready." },
      placeMath: (args) => loopRef.current?.placeMath(args) ?? null,
      plotFunction: (args) => loopRef.current?.plotFunction(args) ?? null,
      requestCheck: (lineId) => asked(lineId)?.requestCheck(lineId),
      requestSolve: (lineId) => asked(lineId)?.requestSolve(lineId),
      requestHelp: () => asked()?.requestHelp() ?? false,
      escalate: (lineId) => asked(lineId)?.escalate(lineId),
      dismissHint: (hintId) => loopRef.current?.dismissHint(hintId),
      clearMarks: () => loopRef.current?.clearMarks(),
      retypeLine: (lineId, latex) => loopRef.current?.retypeLine(lineId, latex),
      chatScreen: () => loopRef.current?.chatScreen() ?? { empty: true, student: [], tutor: [], problems: [] },
      // Ask's picture of the screen (null when the LaTeX says it all); its code loads on first use
      chatImage: async () => (await loopRef.current?.chatImage()) ?? null,
      // `from`: where the problems it writes come from, for the learning record (the chat's own by default)
      runChatActions: async (actions, from) => {
        const loop = loopRef.current;
        if (!loop) throw new Error("The board is not ready yet.");
        return loop.runChatActions(actions, from);
      },
      // Lecture mode: the loop runs whatever the Live switch and the help mode say (see `lectureHost`)
      lectureScreen: () => loopRef.current?.lectureScreen() ?? { empty: true, topic: null, drawn: [], room: 1, active: [] },
      runLectureActions: async (actions, opts) => {
        const loop = loopRef.current;
        if (!loop) throw new Error("The board is not ready yet.");
        return loop.runLectureActions(actions, opts);
      },
      saveLectureTranscript: (text) => loopRef.current?.saveLectureTranscript(text),
      // Type it: writing a line is the kid working, not asking (no `asked`: Auto stays theirs). The
      // writer loads with the bar (`prepareTyped`), never with the board.
      prepareTyped: async () => {
        typedRef.current = true;
        await loopRef.current?.prepareTyped();
      },
      writeTyped: (args) => loopRef.current?.writeTyped(args) ?? { ok: false, reason: "off" },
      typedSpot: (opts) => loopRef.current?.typedSpot(opts) ?? null,
      typedLines: () => loopRef.current?.typedLines() ?? [],
    };
  }, []);
}
