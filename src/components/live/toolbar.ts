/**
 * Pure view logic for the board's top bar.
 *
 * The bar is the first thing a student sees, so what it shows is decided here rather than
 * inline in the page: one help dial (the Off / Feedback / Suggest / Solve tabs), one status
 * pill, and everything rare behind the pill's "…" menu.
 *
 * Model, for reference when reading the rules below:
 *  - The TABS are the only visible on/off. They answer "how much help do you want", and
 *    `off` means no feedback, no hints, no solutions.
 *  - LIVE (typeset echo + instant checking) is a per-device preference, not a mode. It lives
 *    in the menu; the pill reports what it is doing right now.
 */
import type { AssistanceMode } from "@/hooks/useAssistanceMode";
import type { LiveStatus, RecognizerKind } from "@/lib/live/contracts";
import type { LiveError } from "@/lib/live/liveStore";
import { LIVE_COPY, pillLabelFor } from "./copy";

export interface BoardToolbarState {
  /** the help dial (tabs) */
  mode: AssistanceMode;
  /** the student's per-device Live preference */
  liveEnabled: boolean;
  /** false when the deploy-time kill switch has taken Live away entirely */
  liveAvailable: boolean;
  /** the voice tutor owns the top of the screen while a session is open */
  voiceActive: boolean;
}

export interface BoardToolbarView {
  /** the whole bar (back chevron, tabs, pill, save status) */
  showTopBar: boolean;
  /** "Solve steps" is a Solve-mode action, not a permanent button */
  showSolveSteps: boolean;
  /** the status pill is always in the bar: it carries the board's only overflow menu */
  showStatusPill: boolean;
  /** the floating hint cards Live draws next to the ink */
  showHintLayer: boolean;
  /** Live is switched on AND allowed by the build */
  liveRunning: boolean;
}

export function boardToolbarView(state: BoardToolbarState): BoardToolbarView {
  const liveRunning = state.liveEnabled && state.liveAvailable;
  const showTopBar = !state.voiceActive;
  return {
    showTopBar,
    // Streaming the worked steps only means anything once the student has asked for
    // solutions, and only Live can write them.
    showSolveSteps: showTopBar && liveRunning && state.mode === "answer",
    showStatusPill: showTopBar,
    showHintLayer: !state.voiceActive && liveRunning,
    liveRunning,
  };
}

export interface StatusPillState {
  /** Live is switched on AND allowed by the build */
  liveRunning: boolean;
  /** false when the deploy-time kill switch has taken Live away entirely */
  liveAvailable: boolean;
  /** what the store is doing right now */
  status: LiveStatus;
  /** the lingering status, so the label has something to fade out */
  shownStatus: LiveStatus;
  recognizer: RecognizerKind;
  offlineQueued: number;
  /** a solve stream is open (status stays "checking"; the label says "Solving…") */
  solving: boolean;
  error: LiveError | null;
  /** the page is at the live-shape cap, so "Clear marks" gets a shortcut on the pill */
  atCap: boolean;
}

export interface StatusPillView {
  /** null while the error face owns the pill */
  label: string | null;
  /** drives the dot colour in globals.css */
  dataStatus: string;
  showError: boolean;
  /** the inline "Clear marks" shortcut next to the label */
  showClearMarks: boolean;
  /** the label is on its way out after the store went idle */
  fading: boolean;
  /** hover text: what Live does, or where to switch it back on */
  hint: string;
}

/**
 * What the pill says. An error outranks everything and stays until it is retried,
 * superseded or dismissed; with Live off the pill drops to a resting label, because a
 * stale "Reading…" or error from before the student switched Live off would be a lie.
 */
export function statusPillView(state: StatusPillState): StatusPillView {
  if (!state.liveRunning) {
    return {
      label: state.liveAvailable ? LIVE_COPY.pill.off : LIVE_COPY.pill.unavailable,
      dataStatus: "off",
      showError: false,
      showClearMarks: false,
      fading: false,
      hint: state.liveAvailable ? LIVE_COPY.pill.offHint : LIVE_COPY.pill.liveOffHint,
    };
  }
  if (state.error) {
    return {
      label: null,
      dataStatus: "error",
      showError: true,
      showClearMarks: false,
      fading: false,
      hint: LIVE_COPY.toggleHint,
    };
  }
  const active = state.status !== "idle";
  const fading = !active && state.shownStatus !== "idle";
  return {
    label: pillLabelFor(active ? state.status : state.shownStatus, state.recognizer, state.offlineQueued, state.solving),
    dataStatus: active ? state.status : "idle",
    showError: false,
    showClearMarks: state.atCap && !active,
    fading,
    hint: LIVE_COPY.toggleHint,
  };
}

export interface BoardMenuState {
  liveEnabled: boolean;
  liveAvailable: boolean;
}

export interface BoardMenuView {
  /** the Live preference, moved here out of the top bar */
  liveChecked: boolean;
  /** the build has taken Live away: show the switch, but frozen, so the state is honest */
  liveDisabled: boolean;
  liveHint: string;
  /**
   * "Tutor writes by hand" only decides how Live renders a worked step, so it has nothing
   * to act on while Live is off. "Hide AI shapes" is deliberately NOT gated this way: it
   * acts on shapes already sitting on the canvas, and hiding it here would strand a
   * student who switched Live off while their marks were hidden.
   */
  showHandwriting: boolean;
}

/** The pill's "…" menu: the board's one overflow. Items keep their place across states. */
export function boardMenuView(state: BoardMenuState): BoardMenuView {
  const liveRunning = state.liveEnabled && state.liveAvailable;
  return {
    liveChecked: liveRunning,
    liveDisabled: !state.liveAvailable,
    liveHint: state.liveAvailable ? LIVE_COPY.toggleHint : LIVE_COPY.pill.liveOffHint,
    showHandwriting: liveRunning,
  };
}
