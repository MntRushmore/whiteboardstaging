/**
 * Pure state of the guided first board (`BoardTour`): its coach marks as a small state machine, what
 * a reload resumes, and how far the student's ask in the panel has got. No React, no storage, no
 * network. Its own module, so only the tour's lazy chunk carries it (not the home, not the board).
 */
import type { TourMarkerStep } from "./marker";
import type { MarkKind, QuestionWhy } from "./marks";

/**
 * The guided first board: three coach marks, each asking the student to DO one thing on the real
 * board (no reading about buttons), then a finish card. Each coach mark has a "do this" form that
 * waits for the board, and a "that's what happened" form; the two share a number.
 *
 * - `problem`: the tutor is writing the starter problem (a status line, no coach mark);
 * - `write` → `result`: coach mark 1. "Write the next step" waits for the tutor's tick or ring on
 *   the student's line, then says what it means (a question mark changes the nudge instead);
 * - `help` → `helped`: coach mark 2. "Stuck? Tap Help me" waits for the tutor to write a step,
 *   then points at it. A student who taps Help me before writing anything gets here from `write`;
 * - `ask` → `asking`: coach mark 3. "Tap Ask" waits for the panel to open, then "Tap 3 more like
 *   these" waits for the tutor's answer (closing the panel goes back a step);
 * - `finish`: the celebration card (completion is stored on entering it); its button goes on;
 * - `done`: over. Finished (the finish card's button) or skipped (Skip / Esc on a coach mark).
 *
 * Every coach mark also has Next, so a board that cannot answer (Live off, offline, a recognizer
 * down) never holds the student.
 */
export type TourStep = "problem" | "write" | "result" | "help" | "helped" | "ask" | "asking" | "finish" | "done";

/**
 * Coach mark 2, before the tutor has written anything:
 * - `waiting`: not asked yet;
 * - `asked`: Help me found something to help with, and the tutor is on it;
 * - `empty`: Help me found nothing on the screen to help with (`requestHelp` was false);
 * - `unread`: Help me put a question mark on the student's last line (it could not read it);
 * - `slow`: asked a while ago and still nothing written (the coach mark offers Next).
 */
export type TourHelp = "waiting" | "asked" | "empty" | "unread" | "slow";

export interface TourState {
  step: TourStep;
  /** what the tutor put on the student's line, once it did */
  outcome: "tick" | "ring" | null;
  /** the tutor could not read the student's last line (a question mark: write it more clearly) */
  unread: boolean;
  /**
   * the tutor read the student's last line but there was nothing in it to check — a lone `2`, half
   * a step (a question mark: write the whole next line)
   */
  unjudged: boolean;
  help: TourHelp;
  /** how many times Help me was tapped: each tap restarts the wait before `slow` */
  asks: number;
  /** how many chat messages the panel had when coach mark 3 opened it: the student's ask comes after (`askProgress`) */
  askFrom: number;
  /** true when `done` came from Skip / Esc rather than the finish card */
  skipped: boolean;
}

export type TourEvent =
  | { type: "problemReady" }
  | { type: "mark"; mark: MarkKind; why?: QuestionWhy }
  /** Help me was tapped; `ok` is what `requestHelp` said (false: nothing to help with) */
  | { type: "helpAsked"; ok: boolean }
  /** asked, and still nothing written after a while */
  | { type: "helpSlow" }
  /** the tutor's hand wrote something that is not a mark: a step, a graph */
  | { type: "tutorWrote" }
  /** the panel is open; `messages`: how many it holds already (asks from before the tour) */
  | { type: "askOpened"; messages?: number }
  | { type: "askClosed" }
  /** the tutor answered what the student asked in the panel (or the request failed) */
  | { type: "askAnswered" }
  | { type: "next" }
  | { type: "skip" };

export function initialTour(step: TourMarkerStep = "problem"): TourState {
  return { step, outcome: null, unread: false, unjudged: false, help: "waiting", asks: 0, askFrom: 0, skipped: false };
}

export function tourReducer(state: TourState, event: TourEvent): TourState {
  if (state.step === "done") return state;
  if (event.type === "skip") {
    // the finish card has no Skip: there, Esc is its button
    return state.step === "finish" ? { ...state, step: "done" } : { ...state, step: "done", skipped: true };
  }
  switch (state.step) {
    case "problem":
      return event.type === "problemReady" || event.type === "next" ? { ...state, step: "write" } : state;
    case "write":
    case "result":
      if (event.type === "mark") {
        if (event.mark === "question") {
          // the latest question mark says what it means: unread (write it more clearly) or unjudged (write the whole step)
          const unjudged = event.why === "unjudged";
          return state.step === "write" ? { ...state, unread: !unjudged, unjudged } : state;
        }
        return { ...state, step: "result", outcome: event.mark === "check" ? "tick" : "ring", unread: false, unjudged: false };
      }
      // Help me tapped before writing anything: what the tutor writes is coach mark 2's lesson, so
      // the tour goes there rather than keep asking for a step the tutor has just written. Only once
      // asked: in `write` the tutor's own writing (an answer after `=`) is not the student's doing.
      if (event.type === "helpAsked" && state.step === "write") return { ...state, help: event.ok ? "asked" : "empty", asks: state.asks + 1 };
      if (event.type === "tutorWrote" && state.step === "write" && state.help === "asked") return { ...state, step: "helped" };
      return event.type === "next" ? { ...state, step: "help", help: "waiting" } : state;
    case "help":
      switch (event.type) {
        case "helpAsked":
          return { ...state, help: event.ok ? "asked" : "empty", asks: state.asks + 1 };
        case "helpSlow":
          return state.help === "asked" ? { ...state, help: "slow" } : state;
        case "mark":
          // Help me on ink the tutor cannot read answers with a question mark, not a step
          return event.mark === "question" ? { ...state, help: "unread" } : state;
        case "tutorWrote":
          // Only what it wrote for the student's own Help me is the lesson: with Auto on, the tutor
          // also writes by itself (Suggest's step at a pause, Solve finishing the problem), and that
          // moved the tour on as if the student had tapped the button it was teaching.
          return state.help === "asked" || state.help === "slow" ? { ...state, step: "helped" } : state;
        case "next":
          return { ...state, step: "ask" };
        default:
          return state;
      }
    case "helped":
      return event.type === "next" ? { ...state, step: "ask" } : state;
    case "ask":
      if (event.type === "askOpened") return { ...state, step: "asking", askFrom: Math.max(0, event.messages ?? 0) };
      return event.type === "next" ? { ...state, step: "finish" } : state;
    case "asking":
      if (event.type === "askClosed") return { ...state, step: "ask" };
      return event.type === "askAnswered" || event.type === "next" ? { ...state, step: "finish" } : state;
    case "finish":
      return event.type === "next" ? { ...state, step: "done" } : state;
  }
}

/**
 * The step to remember on this device, so a reload resumes the tour where it was: a coach mark
 * that was saying what happened resumes at the next one; the finish card and after, nothing (the
 * tour is complete by then).
 */
export function markerStepOf(step: TourStep): TourMarkerStep | null {
  switch (step) {
    case "problem":
    case "write":
    case "help":
    case "ask":
      return step;
    case "result":
      return "help";
    case "helped":
    case "asking":
      return "ask";
    case "finish":
    case "done":
      return null;
  }
}

/**
 * The tour needs Auto on — coach mark 1 waits for the tick or ring the tutor puts on the student's
 * line by itself — so it turns it on, and gives the student their own setting back when it ends.
 * `tourAutoBefore`: the setting to give back, taken when the tour starts; one a tour under way
 * already remembered (`TourMarker.autoBefore`, a reload mid-tour) wins over Auto now, which is the
 * tour's doing.
 */
export function tourAutoBefore(current: boolean, remembered: boolean | undefined): boolean {
  return remembered ?? current;
}

/**
 * At the tour's end, finished or skipped: the Auto setting to give back, or null to leave it — it was
 * on before, the student switched it off themselves during the tour, or the tour began before this
 * was remembered. Before, the tour left Auto on for good.
 */
export function tourAutoAtEnd(before: boolean | undefined, current: boolean): boolean | null {
  return before === false && current ? false : null;
}

/** "1 of 3" for the coach marks; null while the problem is being written, on the finish card and once done. */
export function coachNumber(step: TourStep): 1 | 2 | 3 | null {
  switch (step) {
    case "write":
    case "result":
      return 1;
    case "help":
    case "helped":
      return 2;
    case "ask":
    case "asking":
      return 3;
    default:
      return null;
  }
}

export const COACH_COUNT = 3;

/**
 * Where the student's ask in the panel is, from the board chat's messages (`useChatMessages`)
 * since coach mark 3 opened it (`since`, the count then): nothing sent yet, the tutor working on it,
 * or answered — a reply, or a failure, which also ends the wait.
 */
export type AskProgress = "waiting" | "busy" | "answered";

export function askProgress(messages: ReadonlyArray<{ role: string; state?: string }>, since: number): AskProgress {
  const fresh = messages.slice(Math.max(0, since));
  if (fresh.some((m) => m.role === "tutor" && (m.state === "done" || m.state === "error"))) return "answered";
  return fresh.length > 0 ? "busy" : "waiting";
}
