/**
 * Every student-facing string of the Live layer lives here so tone stays consistent:
 * quiet lab partner, second person, no exclamation marks, never the word "wrong".
 */
import type { LiveStatus, RecognizerKind } from "@/lib/live/contracts";

export const LIVE_COPY = {
  toggleLabel: "Live",
  toggleHint: "Typeset each line as you write and check steps instantly",

  pill: {
    idle: "Live",
    reading: "Reading…",
    readingSlow: "Reading (slower)…",
    checking: "Checking…",
    offline: "Offline",
    /** offline with N lines waiting to be recognized once the network is back */
    offlineWaiting: (count: number) => `Offline — ${count} ${count === 1 ? "line" : "lines"} waiting`,
    paused: "Paused",
    error: "Live is taking a break",
    menuLabel: "Live options",
    drawHelp: "Draw help",
    drawHelpHint: "Ask the tutor to sketch on the canvas",
    clearMarks: "Clear marks",
    hideAiShapes: "Hide AI shapes",
    shapeCap: "Lots of marks on this page. Clear marks to keep going.",
  },

  hint: {
    gotIt: "Got it",
    moreHelp: "More help",
    levelLabel: (level: number) => (level <= 1 ? "Hint" : level === 2 ? "Closer look" : "One step"),
    region: "Hints from Live",
  },

  solve: {
    steps: "Solve steps",
    stepsHint: "Stream the worked steps below your last line",
  },

  modeInfo: {
    title: "Live",
    body:
      "A typeset echo of each line appears as you write, with instant checks against the previous step. Hints only appear in Suggest and Solve.",
  },

  errors: {
    boundary: "Live paused for this session.",
  },
} as const;

export function pillLabelFor(status: LiveStatus, recognizer: RecognizerKind, offlineQueued = 0): string {
  switch (status) {
    case "reading":
      return recognizer === "vision" ? LIVE_COPY.pill.readingSlow : LIVE_COPY.pill.reading;
    case "checking":
      return LIVE_COPY.pill.checking;
    case "offline":
      return offlineQueued > 0 ? LIVE_COPY.pill.offlineWaiting(offlineQueued) : LIVE_COPY.pill.offline;
    case "paused":
      return LIVE_COPY.pill.paused;
    case "error":
      return LIVE_COPY.pill.error;
    case "idle":
    default:
      return LIVE_COPY.pill.idle;
  }
}

/**
 * Student-facing strings for asset persistence (images moved from the snapshot into
 * Storage) and the autosave size guard. Same tone rules as LIVE_COPY.
 */
export const ASSET_COPY = {
  /** on-load / autosave offload could not move every inline image */
  offloadPartial: "Some images could not be moved to storage; the board still saves.",
  /** autosave refused (snapshot over the hard limit) or the DB rejected the row */
  boardTooLarge: "Board too large to save — remove some images",
  /** an upload fell back to embedding the image in the board (shown once per session) */
  inlineFallback: "Couldn't upload this image to storage; it was saved inside the board instead.",
} as const;
