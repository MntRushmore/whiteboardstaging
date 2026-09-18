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
    solving: "Solving…",
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
    handwriting: "Tutor writes by hand",
    handwritingHint: "Worked steps appear as handwriting instead of typeset text",
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
    /** transport could not reach the server although the browser reports being online */
    network: "Couldn't reach the tutor service",
    unauthorized: "Please sign in again",
    /** seconds until the rate limit lifts */
    rateLimited: (seconds: number) => `Slowing down — try again in ${seconds} s`,
    rateLimitedReady: "You can try again now",
    /** 402 without a usable server message; the account page shows the plan and reset date */
    credits: "This month's credits are used up — see your account",
    upstream: "The tutor service had a hiccup",
    timeout: "Reading took too long",
    unknown: "Something went sideways",
    /** appended once the same call has failed more than once */
    attempts: (n: number) => `tried ${n} times`,
    /** second line of the pill's recognize error: the burst is 'failed', so the image pipeline waits */
    recognizePaused: "Drawn help is paused until reading works again — use Draw help to force it",
    /** echo chip under ink whose recognition failed (low confidence keeps its own chip) */
    recognizeChip: "Couldn't read this line — tap Retry",
    /** inline card when a hint the student asked for could not be fetched */
    hintCard: "Couldn't get a hint right now",
    retry: "Retry",
    dismiss: "Dismiss",
    signIn: "Sign in",
    /** 402: link to /account (plan, remaining credits, reset date) */
    viewPlan: "View plan",
    /** aria label of the error region */
    region: "Live needs attention",
  },
} as const;

/**
 * @param solving true while a solve stream is open (status stays 'checking' because
 *   LiveStatus is frozen; the label says "Solving…" instead)
 */
export function pillLabelFor(status: LiveStatus, recognizer: RecognizerKind, offlineQueued = 0, solving = false): string {
  switch (status) {
    case "reading":
      return recognizer === "vision" ? LIVE_COPY.pill.readingSlow : LIVE_COPY.pill.reading;
    case "checking":
      return solving ? LIVE_COPY.pill.solving : LIVE_COPY.pill.checking;
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
