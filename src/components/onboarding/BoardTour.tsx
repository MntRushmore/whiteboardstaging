"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useEditor, type Editor } from "tldraw";
import type { AssistanceMode } from "@/hooks/useAssistanceMode";
import type { LiveController } from "@/lib/live/contracts";
import { problemMetaOf } from "@/lib/live/chat/cells";
import { clientMetric } from "@/lib/logger";
import { supabase } from "@/lib/supabase";
import { startersFor, type StarterProblem } from "@/lib/onboarding/courses";
import { browserStorage, clearTourMarker, readTourMarker, writeLocalDone, writeTourMarker } from "@/lib/onboarding/marker";
import type { Box } from "@/lib/onboarding/placement";
import { COACH_COUNT, coachNumber, initialTour, markKindOf, markerStepOf, questionWhyOf, tourReducer } from "@/lib/onboarding/state";
import { asOnboardingClient, saveOnboarding } from "@/lib/onboarding/storage";
import { CoachMark } from "./CoachMark";

/**
 * The guided first board (loaded with a dynamic import, only on the board the welcome created):
 * the tutor writes one starter problem from the student's course through the board chat's own
 * executor — the engine checks it and the tutor's hand writes it, no model and no ink — and
 * then three coach marks, one at a time: the pen (waits for the tutor's tick or ring on the
 * student's step), the help modes, and Ask. Finishing or closing it stores completion on the
 * profile (`save_onboarding`) and on this device, and it never shows again.
 */

export interface BoardTourProps {
  boardId: string;
  userId: string;
  controller: LiveController;
  onModeChange: (mode: AssistanceMode) => void;
  chatOpen: boolean;
  /** the tour is over (finished or skipped): the page unmounts it */
  onFinished: () => void;
}

const PEN = '[data-testid="tools.draw"]';
const MODES = '[aria-label="How much help"]';
const ASK = "[data-chat-toggle]";
/** how long a tutor's mark must stand before the first coach mark says what it means */
const MARK_SETTLE_MS = 900;

/** The problem already on this screen (a reload mid-tour): its lines, else null. */
function problemOnPage(editor: Editor): string[] | null {
  for (const s of editor.getCurrentPageShapes()) {
    const p = problemMetaOf(s.meta);
    if (p) return p.lines;
  }
  return null;
}

function matchStarter(starters: readonly StarterProblem[], lines: string[] | null): StarterProblem | null {
  if (!lines) return null;
  return starters.find((s) => s.lines.join(";") === lines.join(";")) ?? null;
}

/** Everything on the current screen, as one rect in client pixels (the problem and the student's work). */
function workRect(editor: Editor): Box | null {
  const b = editor.getCurrentPageBounds();
  if (!b) return null;
  const tl = editor.pageToScreen({ x: b.minX, y: b.minY });
  const br = editor.pageToScreen({ x: b.maxX, y: b.maxY });
  return { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y };
}

/** The problem's ink in client pixels, and the line under it where the student writes first. */
function problemAndNextLine(editor: Editor): Box | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of editor.getCurrentPageShapes()) {
    if (!problemMetaOf(s.meta)) continue;
    const b = editor.getShapePageBounds(s);
    if (!b) continue;
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  }
  if (!Number.isFinite(minX)) return null;
  const h = maxY - minY;
  const tl = editor.pageToScreen({ x: minX, y: minY });
  // two lines' worth below the problem: where the first step goes
  const br = editor.pageToScreen({ x: maxX + h, y: maxY + 2.5 * h });
  return { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y };
}

export default function BoardTour({ boardId, userId, controller, onModeChange, chatOpen, onFinished }: BoardTourProps) {
  const editor = useEditor();
  const marker = useMemo(() => readTourMarker(browserStorage(), userId), [userId]);
  const [state, dispatch] = useReducer(tourReducer, marker?.step ?? "problem", initialTour);
  const starters = useMemo(() => startersFor(marker?.course, marker?.starter ?? 0), [marker]);
  // the starter on the board (its hint goes in the first coach mark); a resumed tour finds it on the page
  const [starter, setStarter] = useState<StarterProblem | null>(() => matchStarter(starters, problemOnPage(editor)));
  const mounted = useRef(false);
  const writing = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // The tour starts in Feedback with the pen in hand; a resumed tour keeps the student's choices.
  useEffect(() => {
    if (marker?.step !== "problem" && marker !== null) return;
    onModeChange("feedback");
    editor.setCurrentTool("draw");
  }, [editor, marker, onModeChange]);

  // The starter problem, written once through the chat's executor (verified, the tutor's hand).
  useEffect(() => {
    if (state.step !== "problem" || writing.current) return;
    writing.current = true;
    const startedAt = Date.now();
    void (async () => {
      const already = problemOnPage(editor);
      if (already) {
        setStarter(matchStarter(starters, already));
        return;
      }
      if (!controller.runChatActions) return;
      for (const s of starters) {
        const report = await controller.runChatActions([{ type: "write_problems", problems: [[...s.lines]] }]);
        if (report.problemsWritten > 0) {
          setStarter(s);
          clientMetric("onboarding.tour.problem", { course: marker?.course ?? null, problem: s.lines.join("; "), ms: Date.now() - startedAt });
          return;
        }
      }
      clientMetric("onboarding.tour.problem", { course: marker?.course ?? null, problem: null, ms: Date.now() - startedAt });
    })()
      .catch((e) => clientMetric("onboarding.tour.problem.failed", { error: e instanceof Error ? e.message : String(e) }))
      .finally(() => {
        if (mounted.current) dispatch({ type: "problemReady" });
      });
  }, [state.step, editor, controller, starters, marker]);

  // Coach mark 1 waits for the tutor's mark on the student's line: a tick or a ring moves it on;
  // a question mark (the tutor could not read the line, or read it but found nothing to check)
  // changes what it says. The mark settles first — a line read half-written can be ringed and then
  // ticked a moment later — so only the last mark of a quick run is reported.
  const listening = state.step === "write" || state.step === "result";
  useEffect(() => {
    if (!listening) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = editor.store.listen(
      ({ changes }) => {
        for (const rec of Object.values(changes.added)) {
          if (rec.typeName !== "shape") continue;
          const mark = markKindOf(rec.meta);
          if (!mark) continue;
          const why = questionWhyOf(rec.meta) ?? undefined;
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            clientMetric("onboarding.tour.mark", { mark, why: why ?? null });
            dispatch({ type: "mark", mark, why });
          }, MARK_SETTLE_MS);
        }
      },
      { scope: "document", source: "all" },
    );
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [editor, listening]);

  // Coach mark 3: opening Ask finishes the tour.
  const wasOpen = useRef(chatOpen);
  useEffect(() => {
    if (chatOpen && !wasOpen.current && state.step === "ask") dispatch({ type: "askOpened" });
    wasOpen.current = chatOpen;
  }, [chatOpen, state.step]);

  // Remember where the tour is on this device, and record each step.
  const finished = useRef(false);
  useEffect(() => {
    clientMetric("onboarding.tour.step", { step: state.step, outcome: state.outcome });
    const step = markerStepOf(state.step);
    if (step && marker) {
      writeTourMarker(browserStorage(), userId, { ...marker, boardId, step });
      return;
    }
    if (state.step !== "done" || finished.current) return;
    finished.current = true;
    const storage = browserStorage();
    clearTourMarker(storage, userId);
    writeLocalDone(storage, userId);
    clientMetric(state.skipped ? "onboarding.tour.skip" : "onboarding.tour.done", { course: marker?.course ?? null });
    void saveOnboarding(asOnboardingClient(supabase), { complete: true }).then((res) => {
      if (!res.ok) clientMetric("onboarding.save.failed", { error: res.error });
    });
    onFinished();
  }, [state.step, state.outcome, state.skipped, marker, boardId, userId, onFinished]);

  const skip = useCallback(() => dispatch({ type: "skip" }), []);
  const next = useCallback(() => dispatch({ type: "next" }), []);
  const avoidWork = useCallback((): Box[] => {
    const work = workRect(editor);
    const first = problemAndNextLine(editor);
    return [work, first].filter((b): b is Box => b !== null && b.w > 0 && b.h > 0);
  }, [editor]);
  // no pen button in view (a narrow toolbar folds it away): point at the bottom middle of the board
  const penFallback = useCallback((): Box | null => {
    const v = editor.getViewportScreenBounds();
    return { x: v.x + v.w / 2 - 20, y: v.y + v.h - 56, w: 40, h: 40 };
  }, [editor]);

  const number = coachNumber(state.step);
  if (number === null) return null;
  const hint = starter?.hint;
  // what coach mark 1 says under its title: the nudge, or what the tutor's question mark means
  const writeBody = state.unjudged
    ? `That ? means the tutor couldn't tell what that line says. Write the whole next line${hint ? `. ${hint}` : " under the problem."}`
    : state.unread
      ? "The tutor couldn't read that line. Try writing it a little larger."
      : hint
        ? `${hint} Your tutor checks each line as you write it.`
        : "Your tutor checks each line as you write it.";

  switch (state.step) {
    case "write":
      return (
        <CoachMark
          anchor={PEN}
          fallback={penFallback}
          prefer={["top", "right", "left"]}
          avoid={avoidWork}
          number={number}
          total={COACH_COUNT}
          focusKey={`write:${state.unread}:${state.unjudged}`}
          title={starter ? "Grab the pen and write the next step under the problem" : "Grab the pen and write a line of maths"}
          primary={{ label: "Next", onClick: next, variant: "outline" }}
          onClose={skip}
        >
          {writeBody}
        </CoachMark>
      );
    case "result":
      return (
        <CoachMark
          anchor={PEN}
          fallback={penFallback}
          prefer={["top", "right", "left"]}
          avoid={avoidWork}
          number={number}
          total={COACH_COUNT}
          focusKey={`result:${state.outcome}`}
          title={state.outcome === "tick" ? "Nice! That tick means your step is right." : "That ring means something's off in that step."}
          primary={{ label: "Next", onClick: next }}
          onClose={skip}
        >
          {state.outcome === "tick"
            ? "Your tutor checked it against the problem. Keep going on the next line!"
            : "No worries, that's how you learn! Rub it out with the eraser and try again."}
        </CoachMark>
      );
    case "modes":
      return (
        <CoachMark
          anchor={MODES}
          prefer={["bottom", "right"]}
          avoid={avoidWork}
          number={number}
          total={COACH_COUNT}
          focusKey="modes"
          title="Stuck? Suggest gives you a hint. Solve shows you how."
          primary={{ label: "Next", onClick: next }}
          onClose={skip}
        >
          You&apos;re in Feedback now, which checks each line. Switch any time.
        </CoachMark>
      );
    case "ask":
      return (
        <CoachMark
          anchor={ASK}
          prefer={["bottom", "right", "left"]}
          avoid={avoidWork}
          number={number}
          total={COACH_COUNT}
          focusKey="ask"
          title="Want more practice? Ask your tutor."
          primary={{ label: "Done", onClick: next }}
          onClose={skip}
        >
          Try typing &ldquo;3 more like this&rdquo;. Each request uses 3 ink.
        </CoachMark>
      );
    default:
      return null;
  }
}
