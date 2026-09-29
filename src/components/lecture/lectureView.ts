/**
 * Pure view logic for lecture mode's button and panel (LectureButton.tsx, LectureBar.tsx): the
 * words, what each state of the session looks like, the consent note's memory, and the board as the
 * session sees it. No React, no network: unit-tested in __tests__/lectureView.test.ts, like the
 * board chat's chatView.ts.
 */
import { LECTURE_TIMING, type LectureBoard } from "@/lib/live/lecture/contracts";
import type { LectureRunOptions } from "@/lib/live/lecture/desk";
import { LECTURE_BUTTON_COPY } from "./lectureCopy";
import type { LectureErrorCode, LectureNotice, LectureSessionBoard, LectureSnapshot } from "@/lib/live/lecture/session";
import { tailChars } from "@/lib/live/lecture/transcript";

export type LectureHandleStatus = "off" | "consent" | "starting" | "listening" | "paused" | "error";

export const LECTURE_COPY = {
  ...LECTURE_BUTTON_COPY,
  title: "Lecture mode",
  consent: {
    title: "Lecture mode",
    body: "Lecture mode listens through your microphone and sketches what's said. We keep the words, never the audio. Make sure recording is allowed in your class.",
    cost: "Uses about 2 credits a minute while someone is talking, and 4 for each picture it draws (each panel of a comic is one).",
    start: "Start listening",
    cancel: "Cancel",
  },
  starting: "Starting the microphone…",
  listening: "Listening",
  paused: "Paused",
  reconnecting: "Reconnecting…",
  placeholder: "Listening for the lecture…",
  pausedPlaceholder: "Paused. Resume to keep listening.",
  drawThat: "Draw that",
  drawThatHint: "Sketch what was just said",
  pause: "Pause",
  resume: "Resume",
  stop: "Stop",
  close: "Close",
  tryAgain: "Try again",
  status: {
    waiting: "Sketches appear as the lecture goes.",
    looking: "Looking at what was just said…",
    sketching: "Sketching…",
    updatingChart: "Updating the chart…",
    updatingDiagram: "Updating the diagram…",
    /** a comic strip: its frames, then its panels as they arrive (~10–20 s) */
    drawingComic: "Drawing the comic…",
    /** one picture */
    drawingPicture: "Drawing…",
    /** "Drew: bar chart: Sales by quarter" (the lead is set apart in the panel) */
    drew: "Drew:",
    updated: "Updated:",
  },
  /** a chart or diagram is live: what is said next can still change it */
  live: "Live",
  liveHint: "The chart updates as the lecture goes",
  notices: {
    idle: `Paused: nothing heard for ${Math.round(LECTURE_TIMING.idlePauseMs / 60_000)} minutes.`,
    nothing: "Nothing to sketch from that yet.",
    empty: "Nothing heard yet.",
    rateLimited: (seconds: number) => `Taking a short break. Back in ${seconds} s.`,
    retrying: "Couldn't reach the tutor. Trying again soon.",
    boardFailed: "Couldn't draw that on the board.",
    sketchFailed: (failed: number, panels: number) => (panels <= 1 ? "Couldn't draw that picture." : failed >= panels ? "Couldn't draw the comic." : `Couldn't draw ${failed} of the ${panels} panels.`),
  },
  errors: {
    unsupported: "Lecture mode needs Chrome, Edge or Safari.",
    "mic-denied": "Lecture mode needs your microphone. Allow it in the browser's address bar, then try again.",
    "mic-missing": "No microphone found. Plug one in, or close other apps using it, then try again.",
    /** OUT_OF_CREDITS_COPY.title (pinned equal in the tests; a literal so the lazy panel's module stays out of the first load) */
    credits: "You've used this month's credits",
    unauthorized: "Please sign in again.",
    network: "Lost the connection to the transcriber. Check your connection and try again.",
    recognizer: "The transcriber stopped working. Try again in a moment.",
    board: "The board isn't ready yet. Try again in a moment.",
  } satisfies Record<LectureErrorCode, string>,
} as const;

// ------------------------------------------------------------------ the panel

export interface LectureBarModel {
  mode: "hidden" | "consent" | "starting" | "active" | "error";
  /** "Listening" / "Paused" / "Reconnecting…" */
  label: string;
  /** the red recording dot pulses (listening); grey when paused, amber when reconnecting */
  dot: "recording" | "paused" | "reconnecting";
  /** a chart or diagram on the board is live (it changes as the lecture goes): the "Live" pulse */
  liveVisual: boolean;
  /** "4:05", "1:02:09" */
  timer: string;
  /** what was heard (the last line or two, trimmed from the front) and what is being heard */
  heard: string;
  hearing: string;
  /** shown instead of the ticker before anything was heard */
  placeholder: string | null;
  /** what the tutor is doing; `lead` ("Drew:", "Updated:") is set apart from the summary */
  status: { text: string; tone: "muted" | "busy" | "done" | "notice"; lead?: string };
  drawThat: { enabled: boolean; busy: boolean };
  paused: boolean;
  error: { code: LectureErrorCode; message: string; credits: boolean; retry: boolean } | null;
}

/** The ticker holds about two lines of a 400 px panel; older words are trimmed from the front. */
export const TICKER_CHARS = 160;

/** "0:07", "12:34", "1:02:09" */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** The newest words for the ticker: the finished lines and the partial together fit `max`, the partial first. */
export function tickerText(lines: readonly string[], partial: string, max = TICKER_CHARS): { heard: string; hearing: string } {
  const hearing = tailChars(partial, max);
  const room = max - hearing.length - (hearing ? 1 : 0);
  const joined = lines.join(" ");
  const heard = room > 12 ? tailChars(joined, room) : "";
  return { heard: heard && heard.length < joined.replace(/\s+/g, " ").trim().length ? `…${heard}` : heard, hearing };
}

function noticeText(notice: LectureNotice, now: number): string {
  switch (notice.kind) {
    case "idle":
      return LECTURE_COPY.notices.idle;
    case "nothing":
      return notice.note || LECTURE_COPY.notices.nothing;
    case "empty":
      return LECTURE_COPY.notices.empty;
    case "rate_limited":
      return LECTURE_COPY.notices.rateLimited(Math.max(1, Math.ceil((notice.retryAtMs - now) / 1000)));
    case "retrying":
      return LECTURE_COPY.notices.retrying;
    case "board_failed":
      return LECTURE_COPY.notices.boardFailed;
    case "sketch_failed":
      return LECTURE_COPY.notices.sketchFailed(notice.failed, notice.panels);
  }
}

const RETRYABLE: ReadonlySet<LectureErrorCode> = new Set(["mic-denied", "mic-missing", "network", "recognizer", "board"]);

export function lectureErrorView(code: LectureErrorCode): NonNullable<LectureBarModel["error"]> {
  return { code, message: LECTURE_COPY.errors[code], credits: code === "credits", retry: RETRYABLE.has(code) };
}

const HIDDEN: LectureBarModel = {
  mode: "hidden",
  label: "",
  dot: "paused",
  liveVisual: false,
  timer: "0:00",
  heard: "",
  hearing: "",
  placeholder: null,
  status: { text: "", tone: "muted" },
  drawThat: { enabled: false, busy: false },
  paused: false,
  error: null,
};

/** What the panel shows for the lecture's state (`status`/`error` from the handle, the rest from the session). */
export function lectureBarModel(input: { status: LectureHandleStatus; error: LectureErrorCode | null; snap: LectureSnapshot | null; now: number }): LectureBarModel {
  const { status, snap, now } = input;
  if (status === "off") return HIDDEN;
  if (status === "consent") return { ...HIDDEN, mode: "consent", label: LECTURE_COPY.consent.title };
  if (status === "error") return { ...HIDDEN, mode: "error", label: LECTURE_COPY.title, error: lectureErrorView(input.error ?? snap?.error ?? "recognizer") };
  if (status === "starting" || !snap) return { ...HIDDEN, mode: "starting", label: LECTURE_COPY.starting };

  const paused = status === "paused";
  const reconnecting = !paused && snap.speech === "reconnecting";
  const { heard, hearing } = tickerText(snap.stats.lines, snap.stats.partial);
  // a sketch's panels keep coming after its run: "Drawing the comic…" until the last one is in
  const sketching = snap.sketching === "comic" ? LECTURE_COPY.status.drawingComic : snap.sketching === "picture" ? LECTURE_COPY.status.drawingPicture : null;
  const statusLine: LectureBarModel["status"] = snap.drawing
    ? {
        text: snap.updating === "chart" ? LECTURE_COPY.status.updatingChart : snap.updating === "diagram" ? LECTURE_COPY.status.updatingDiagram : (sketching ?? LECTURE_COPY.status.sketching),
        tone: "busy",
      }
    : sketching
      ? { text: sketching, tone: "busy" }
      : snap.forcing
        ? { text: LECTURE_COPY.status.looking, tone: "busy" }
        : snap.notice
          ? { text: noticeText(snap.notice, now), tone: "notice" }
          : snap.stats.lastWhat
            ? { lead: snap.stats.lastVerb === "updated" ? LECTURE_COPY.status.updated : LECTURE_COPY.status.drew, text: snap.stats.lastWhat, tone: "done" }
            : { text: LECTURE_COPY.status.waiting, tone: "muted" };
  return {
    mode: "active",
    label: paused ? LECTURE_COPY.paused : reconnecting ? LECTURE_COPY.reconnecting : LECTURE_COPY.listening,
    dot: paused ? "paused" : reconnecting ? "reconnecting" : "recording",
    liveVisual: snap.liveVisual && !paused,
    timer: formatElapsed(snap.stats.elapsedMs),
    heard,
    hearing,
    placeholder: heard || hearing ? null : paused ? LECTURE_COPY.pausedPlaceholder : LECTURE_COPY.placeholder,
    status: statusLine,
    drawThat: { enabled: snap.stats.words > 0 && !snap.forcing, busy: snap.forcing },
    paused,
    error: null,
  };
}

/** The session's state as the handle's (a stopped lecture is simply off). */
export function handleStatusFor(snap: Pick<LectureSnapshot, "status">): LectureHandleStatus {
  return snap.status === "stopped" ? "off" : snap.status;
}

// ------------------------------------------------------------------ the consent note, once per device

export const LECTURE_CONSENT_KEY = "agathon.lecture.consent.v1";

type ConsentStorage = Pick<Storage, "getItem" | "setItem">;

export function browserStorage(): ConsentStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function hasLectureConsent(storage: ConsentStorage | null): boolean {
  try {
    return storage?.getItem(LECTURE_CONSENT_KEY) === "1";
  } catch {
    return false;
  }
}

export function rememberLectureConsent(storage: ConsentStorage | null): void {
  try {
    storage?.setItem(LECTURE_CONSENT_KEY, "1");
  } catch {
    /* private mode: asked again next time */
  }
}

// ------------------------------------------------------------------ the board

/** The lecture half of the live controller (`LiveController.lecture*`). */
export interface LectureControllerLike {
  lectureScreen?(): ReturnType<LectureBoard["screen"]>;
  runLectureActions?(actions: Parameters<LectureBoard["run"]>[0], opts?: LectureRunOptions): ReturnType<LectureBoard["run"]>;
  saveLectureTranscript?(text: string): void;
}

/**
 * The board as the session sees it, from the live controller's lecture methods — always the
 * controller of the moment (`get`), since the page may hand the hook a new one. Null when the
 * controller has no lecture methods (the board is not ready for it).
 */
export function lectureBoardFor(get: () => LectureControllerLike): LectureSessionBoard | null {
  const c = get();
  if (!c.lectureScreen || !c.runLectureActions || !c.saveLectureTranscript) return null;
  const need = <K extends keyof LectureControllerLike>(key: K): NonNullable<LectureControllerLike[K]> => {
    const ctl = get();
    const fn = ctl[key];
    if (!fn) throw new Error(`the board has no ${String(key)}`);
    return (fn as (...args: never[]) => unknown).bind(ctl) as NonNullable<LectureControllerLike[K]>;
  };
  return {
    screen: () => need("lectureScreen")(),
    // a run's options carry the session's way to the illustrator (a sketch's panels)
    run: (actions, opts) => need("runLectureActions")(actions, opts),
    saveTranscript: (text) => need("saveLectureTranscript")(text),
  };
}
