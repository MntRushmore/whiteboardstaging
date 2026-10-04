"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useEditor, type Editor, type TLShapeId } from "tldraw";
import { Check, CircleDashed, Lightbulb, MessageSquare, Pencil, Sparkles } from "lucide-react";
import type { AssistanceMode } from "@/hooks/useAssistanceMode";
import type { LiveController } from "@/lib/live/contracts";
import { problemMetaOf } from "@/lib/live/chat/cells";
import { getLiveSettings, updateLiveSettings } from "@/lib/live/liveSettings";
import { clientMetric } from "@/lib/logger";
import { supabase } from "@/lib/supabase";
import { ASK_BUTTON_ATTR } from "@/components/live/AskButton";
import { CHAT_TOGGLE_ATTR } from "@/components/chat/BoardChatPanel";
import { CHAT_INK } from "@/components/chat/chatView";
import { useChatMessages } from "@/components/chat/useBoardChat";
import { startersFor, type StarterProblem } from "@/lib/onboarding/courses";
import { browserStorage, clearTourMarker, readTourMarker, writeLocalDone, writeTourMarker } from "@/lib/onboarding/marker";
import { HOME_PATH, PLAN_PATH, writePlanMarker } from "@/lib/onboarding/planMarker";
import type { Box } from "@/lib/onboarding/placement";
import { isTutorWork, markKindOf, questionWhyOf } from "@/lib/onboarding/marks";
import { askProgress, COACH_COUNT, coachNumber, initialTour, markerStepOf, tourAutoAtEnd, tourAutoBefore, tourReducer } from "@/lib/onboarding/tour";
import { asOnboardingClient, saveOnboarding } from "@/lib/onboarding/storage";
import { sendWelcomeEmail } from "@/lib/email/client";
import { askCopy, helpCopy, MORE_LIKE_THESE, TOUR_COPY, writeCopy } from "@/lib/onboarding/tourCopy";
import { CoachMark } from "./CoachMark";
import { TourFinish } from "./TourFinish";
import styles from "./tour.module.css";

/**
 * The guided first board (loaded with a dynamic import, only on the board the welcome created).
 * The tutor writes one starter problem from the student's course through the board chat's own
 * executor — the engine checks it and the tutor's hand writes it, no model and no ink — and then
 * three coach marks, one at a time, each asking the student to do one thing on the real board and
 * waiting for the board to answer (`tourReducer`):
 *
 *  1. write the next step with the pen → the tutor's tick or ring says what it means;
 *  2. tap Help me (the bar's big button, `AskButton`) → the tutor writes the next step;
 *  3. tap Ask, then "3 more like these" → the tutor writes more problems;
 *
 * then a finish card with confetti, whose button opens the plan screen (`PLAN_PATH`). Skip tour (or
 * Esc) on any coach mark goes straight to the home instead, without the plan: a student who skips
 * has asked to get going. Either way completion is stored on the profile (`save_onboarding`) and on
 * this device, and the tour never shows again; until then a reload resumes it (`marker.ts`).
 */

export interface BoardTourProps {
  boardId: string;
  userId: string;
  controller: LiveController;
  /** the dial: the tour starts it on Feedback, and coach mark 2 needs it on anything but Off */
  mode: AssistanceMode;
  onModeChange: (mode: AssistanceMode) => void;
  chatOpen: boolean;
  /** the bar's Help me / Solve it, tapped: how many times so far, and whether the last tap found anything to help with */
  helpAsk: { n: number; ok: boolean } | null;
  /** the tour is over and leaving the board: the page unmounts it */
  onFinished: () => void;
}

const PEN = '[data-testid="tools.draw"]';
const MODES = '[aria-label="How much help"]';
const HELP = `[${ASK_BUTTON_ATTR}]`;
const ASK = `[${CHAT_TOGGLE_ATTR}]`;
/** the Ask panel, and its suggestions (buttons with their words: the tour finds one by its text) */
const PANEL = "[data-board-chat]";
/** how long a tutor's mark must stand before the first coach mark says what it means */
const MARK_SETTLE_MS = 900;
/** the tutor's hand writes a step stroke by stroke: it is done once nothing new came for this long */
const WRITE_SETTLE_MS = 1200;
/** Help me found something, but nothing is written after this long: the coach mark offers Next */
const HELP_SLOW_MS = 15_000;
/** the tutor has answered the student's ask: a moment to see it land before the finish card */
const ANSWER_SETTLE_MS = 1200;

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

/** Page bounds in client pixels. */
function screenBox(editor: Editor, b: { minX: number; minY: number; maxX: number; maxY: number }): Box {
  const tl = editor.pageToScreen({ x: b.minX, y: b.minY });
  const br = editor.pageToScreen({ x: b.maxX, y: b.maxY });
  return { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y };
}

/** Everything on the current screen, as one rect in client pixels (the problem and the student's work). */
function workRect(editor: Editor): Box | null {
  const b = editor.getCurrentPageBounds();
  return b ? screenBox(editor, b) : null;
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
  // two lines' worth below the problem: where the first step goes
  return screenBox(editor, { minX, minY, maxX: maxX + h, maxY: maxY + 2.5 * h });
}

/** The shapes the tutor just wrote, as one rect in client pixels (coach mark 2 points at them). */
function shapesRect(editor: Editor, ids: ReadonlySet<TLShapeId>): Box | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const id of ids) {
    const b = editor.getShapePageBounds(id);
    if (!b) continue;
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  }
  return Number.isFinite(minX) ? screenBox(editor, { minX, minY, maxX, maxY }) : null;
}

function rectOf(el: Element | null | undefined): Box | null {
  if (!el || el.getClientRects().length === 0) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

function rectOfSelector(selector: string): Box | null {
  return rectOf(document.querySelector(selector));
}

/** The panel's "3 more like these" while it still shows its suggestions. */
function suggestionButton(): Element | undefined {
  return [...document.querySelectorAll(`${PANEL} button`)].find((b) => b.textContent?.trim() === MORE_LIKE_THESE);
}

export default function BoardTour({ boardId, userId, controller, mode, onModeChange, chatOpen, helpAsk, onFinished }: BoardTourProps) {
  const editor = useEditor();
  const router = useRouter();
  const marker = useMemo(() => readTourMarker(browserStorage(), userId), [userId]);
  const [state, dispatch] = useReducer(tourReducer, marker?.step ?? "problem", initialTour);
  const starters = useMemo(() => startersFor(marker?.course, marker?.starter ?? 0), [marker]);
  // the starter on the board (its hint goes in the first coach mark); a resumed tour finds it on the page
  const [starter, setStarter] = useState<StarterProblem | null>(() => matchStarter(starters, problemOnPage(editor)));
  const messages = useChatMessages(boardId);
  const mounted = useRef(false);
  const writing = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // The tour starts in Feedback with the pen in hand, and Auto on: coach mark 1 waits for the
  // tick or ring the tutor puts on the student's line by itself, which Auto off never does. The
  // student's own Auto setting is remembered with the marker and given back when the tour ends. A
  // resumed tour keeps the student's choices.
  const autoBefore = useRef<boolean | undefined>(marker?.autoBefore);
  useEffect(() => {
    if (marker?.step !== "problem" && marker !== null) return;
    onModeChange("feedback");
    const auto = getLiveSettings().auto;
    autoBefore.current = tourAutoBefore(auto, autoBefore.current);
    if (marker) writeTourMarker(browserStorage(), userId, { ...marker, autoBefore: autoBefore.current });
    if (!auto) updateLiveSettings({ auto: true });
    editor.setCurrentTool("draw");
  }, [editor, marker, onModeChange, userId]);

  // Coach mark 2 needs a Help me button: with the dial on Off there is none, so it goes to Feedback.
  useEffect(() => {
    if (state.step === "help" && mode === "off") onModeChange("feedback");
  }, [state.step, mode, onModeChange]);

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
        const report = await controller.runChatActions([{ type: "write_problems", problems: [[...s.lines]] }], { origin: "starter" });
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

  // The tutor's marks: coach mark 1 waits for a tick or a ring on the student's line, and a
  // question mark (the tutor could not read the line, or read it but found nothing to check)
  // changes what it says; on coach mark 2 a question mark is Help me's answer to unreadable ink.
  // The mark settles first — a line read half-written can be ringed and then ticked a moment
  // later — so only the last mark of a quick run is reported.
  const marking = state.step === "write" || state.step === "result" || state.step === "help";
  // the mark coach mark 1 is explaining: it points at it
  const lastMark = useRef(new Set<TLShapeId>());
  useEffect(() => {
    if (!marking) return;
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
            lastMark.current = new Set([rec.id]);
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
  }, [editor, marking]);

  // Help me, tapped (the page reports each tap): coach mark 2 waits for what it writes.
  const wrote = useRef(new Set<TLShapeId>());
  const seenAsk = useRef(helpAsk?.n ?? 0);
  useEffect(() => {
    if (!helpAsk || helpAsk.n === seenAsk.current) return;
    seenAsk.current = helpAsk.n;
    clientMetric("onboarding.tour.help", { ok: helpAsk.ok, step: state.step });
    // what coach mark 2 points at is what the tutor writes for this ask, not what it wrote by itself before
    wrote.current = new Set();
    dispatch({ type: "helpAsked", ok: helpAsk.ok });
  }, [helpAsk, state.step]);

  useEffect(() => {
    if (state.help !== "asked") return;
    const timer = setTimeout(() => dispatch({ type: "helpSlow" }), HELP_SLOW_MS);
    return () => clearTimeout(timer);
  }, [state.help, state.asks]);

  // What the tutor writes for Help me (a step, a graph; never a mark or a problem): reported once
  // its hand has stopped, and remembered (`wrote`, above) so coach mark 2 can point at it.
  const watchingWork = state.step === "help" || (state.step === "write" && state.help === "asked");
  useEffect(() => {
    if (!watchingWork) return;
    wrote.current = new Set();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = editor.store.listen(
      ({ changes }) => {
        let fresh = false;
        for (const rec of [...Object.values(changes.added), ...Object.values(changes.updated).map(([, to]) => to)]) {
          if (rec.typeName !== "shape" || !isTutorWork(rec.meta)) continue;
          wrote.current.add(rec.id);
          fresh = true;
        }
        if (!fresh) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => dispatch({ type: "tutorWrote" }), WRITE_SETTLE_MS);
      },
      { scope: "document", source: "all" },
    );
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [editor, watchingWork]);

  // Coach mark 3: the panel open moves on to the suggestion to tap (also when it was open already,
  // e.g. on a reload); closing it goes back to the Ask button.
  const messageCount = messages.length;
  useEffect(() => {
    if (state.step === "ask" && chatOpen) dispatch({ type: "askOpened", messages: messageCount });
    if (state.step === "asking" && !chatOpen) dispatch({ type: "askClosed" });
  }, [chatOpen, state.step, messageCount]);

  // ...and follows the student's ask in the panel: sent, being answered, answered.
  const progress = state.step === "asking" ? askProgress(messages, state.askFrom) : "waiting";
  useEffect(() => {
    if (progress !== "answered") return;
    const timer = setTimeout(() => dispatch({ type: "askAnswered" }), ANSWER_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [progress]);

  // Remember where the tour is on this device, and record each step. The finish card stores
  // completion (and that the plan screen is due); `done` leaves the board.
  const completed = useRef(false);
  const left = useRef(false);
  useEffect(() => {
    clientMetric("onboarding.tour.step", { step: state.step, outcome: state.outcome });
    const step = markerStepOf(state.step);
    if (step && marker) {
      writeTourMarker(browserStorage(), userId, { ...marker, boardId, step, ...(autoBefore.current === undefined ? {} : { autoBefore: autoBefore.current }) });
      return;
    }
    if ((state.step === "finish" || state.step === "done") && !completed.current) {
      completed.current = true;
      // the tour turned Auto on for itself: the student's own setting comes back
      const auto = tourAutoAtEnd(autoBefore.current, getLiveSettings().auto);
      if (auto !== null) updateLiveSettings({ auto });
      const storage = browserStorage();
      clearTourMarker(storage, userId);
      writeLocalDone(storage, userId);
      if (!state.skipped) writePlanMarker(storage, userId, "pending");
      clientMetric(state.skipped ? "onboarding.tour.skip" : "onboarding.tour.done", { course: marker?.course ?? null });
      void saveOnboarding(asOnboardingClient(supabase), { complete: true }).then((res) => {
        if (!res.ok) clientMetric("onboarding.save.failed", { error: res.error });
        // after the save: the route sends only once profiles.onboarded_at is stamped (and only once)
        else void sendWelcomeEmail();
      });
    }
    if (state.step !== "done" || left.current) return;
    left.current = true;
    router.push(state.skipped ? HOME_PATH : PLAN_PATH);
    onFinished();
  }, [state.step, state.outcome, state.skipped, marker, boardId, userId, router, onFinished]);

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
  // the tick or ring being explained, else the pen
  const markFallback = useCallback(() => shapesRect(editor, lastMark.current) ?? rectOfSelector(PEN) ?? penFallback(), [editor, penFallback]);
  // no Help me in the bar (Live switched off): the dial, where help is turned on
  const helpFallback = useCallback(() => rectOfSelector(MODES) ?? penFallback(), [penFallback]);
  // the step the tutor wrote, else the button that asked for it
  const wroteFallback = useCallback(() => shapesRect(editor, wrote.current) ?? helpFallback(), [editor, helpFallback]);
  // "3 more like these" in the panel; its suggestions are gone once it has messages: its text box
  const askFallback = useCallback(() => rectOf(suggestionButton()) ?? rectOfSelector(`${PANEL} form`) ?? rectOfSelector(ASK), []);

  if (state.step === "problem") return <TourStatus text={TOUR_COPY.writingProblem} />;
  if (state.step === "finish") return <TourFinish onContinue={next} />;
  const number = coachNumber(state.step);
  if (number === null) return null;
  const common = { avoid: avoidWork, number, total: COACH_COUNT, onSkip: skip } as const;

  switch (state.step) {
    case "write":
    case "result": {
      const copy = writeCopy(state, starter?.hint ?? null);
      const result = state.step === "result";
      const ring = result && state.outcome === "ring";
      return (
        <CoachMark
          {...common}
          anchor={result ? undefined : PEN}
          fallback={result ? markFallback : penFallback}
          prefer={result ? ["right", "bottom", "top", "left"] : ["top", "right", "left"]}
          icon={state.step === "write" ? <Pencil /> : ring ? <CircleDashed /> : <Check />}
          tone={state.step === "write" ? "blue" : ring ? "amber" : "green"}
          focusKey={`${state.step}:${state.outcome}:${state.unread}:${state.unjudged}`}
          title={copy.title}
          primary={{ label: copy.button, onClick: next, variant: copy.waiting ? "outline" : "default" }}
        >
          {copy.body}
        </CoachMark>
      );
    }
    case "help":
    case "helped": {
      const copy = helpCopy(state.step, state.help, mode === "answer");
      const helped = state.step === "helped";
      return (
        <CoachMark
          {...common}
          anchor={helped ? undefined : HELP}
          fallback={helped ? wroteFallback : helpFallback}
          prefer={helped ? ["right", "bottom", "left", "top"] : ["bottom", "right", "left"]}
          icon={helped ? <Sparkles /> : <Lightbulb />}
          tone={helped ? "violet" : "blue"}
          pulse={!helped && state.help === "waiting"}
          focusKey={`${state.step}:${state.help}`}
          title={copy.title}
          primary={{ label: copy.button, onClick: next, variant: copy.waiting ? "outline" : "default" }}
        >
          {copy.body}
        </CoachMark>
      );
    }
    case "ask":
    case "asking": {
      const asking = state.step === "asking";
      const copy = askCopy(state.step, { busy: progress === "busy", suggestion: messages.length === 0 ? MORE_LIKE_THESE : null, ink: CHAT_INK });
      return (
        <CoachMark
          {...common}
          anchor={asking ? undefined : ASK}
          fallback={asking ? askFallback : undefined}
          prefer={asking ? ["left", "top", "bottom"] : ["bottom", "right", "left"]}
          icon={<MessageSquare />}
          tone="blue"
          pulse={progress !== "busy"}
          focusKey={`${state.step}:${progress}:${messages.length === 0}`}
          title={copy.title}
          primary={{ label: copy.button, onClick: next, variant: "outline" }}
        >
          {copy.body}
        </CoachMark>
      );
    }
    default:
      return null;
  }
}

/** While the tutor writes the starter problem: one calm line at the foot of the board. */
function TourStatus({ text }: { text: string }) {
  return (
    <div
      role="status"
      data-tour-status=""
      className={`pointer-events-none fixed bottom-24 left-1/2 z-1200 flex -translate-x-1/2 items-center gap-2.5 rounded-full border bg-popover px-5 py-3 text-base font-medium text-popover-foreground shadow-lg ${styles.enter}`}
    >
      <Pencil aria-hidden className={`size-5 text-blue-600 ${styles.wiggle}`} />
      {text}
    </div>
  );
}
