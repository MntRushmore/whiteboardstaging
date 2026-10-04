/**
 * Every student-facing string of the Live layer lives here so tone stays consistent:
 * quiet lab partner, second person, no exclamation marks, never the word "wrong".
 */
import type { LiveStatus, RecognizerKind } from "@/lib/live/contracts";

/**
 * How long until a rate limit lifts, as a person says it: "12 s", "4 min", "about 3 hours". A
 * subscriber over Agathon Unlimited's daily fair-use cap waits hours, and "12000 s" means nothing.
 */
export function waitPhrase(seconds: number): string {
  const s = Math.max(1, Math.ceil(seconds));
  if (s < 90) return `${s} s`;
  const min = Math.round(s / 60);
  if (min < 90) return `${min} min`;
  return `about ${Math.round(min / 60)} hours`;
}

export const LIVE_COPY = {
  toggleLabel: "Live",
  toggleHint: "Live is on: the tutor reads each line as you write it",

  pill: {
    idle: "Live",
    /** resting label when the student has switched the Live layer off in the menu */
    off: "Live off",
    /** resting label when the deploy-time kill switch has taken Live away */
    unavailable: "Live unavailable",
    reading: "Reading…",
    readingSlow: "Reading (slower)…",
    checking: "Checking…",
    solving: "Solving…",
    offline: "Offline",
    /** offline with N lines waiting to be recognized once the network is back */
    offlineWaiting: (count: number) => `Offline — ${count} ${count === 1 ? "line" : "lines"} waiting`,
    paused: "Paused",
    error: "Live is taking a break",
    /** the pill's "…" button: the board's one overflow menu */
    menuLabel: "Board options",
    /** menu section headings */
    groupCanvas: "This canvas",
    groupLive: "Live",
    groupHelp: "Help",
    /** the board's one explicit ask: Solve writes the steps, Feedback / Suggest give a hint */
    help: "Help",
    helpHint: "Ask the tutor about your latest line",
    /** Help is greyed out while there is nothing to ask (help set to Off, or Live off) */
    helpOffHint: "Pick Feedback, Suggest or Solve to ask for help",
    clearMarks: "Clear marks",
    hideAiShapes: "Hide AI shapes",
    celebrations: "Celebrations",
    celebrationsHint: "A cheer and confetti when the tutor ticks your step",
    handwriting: "Tutor writes by hand",
    handwritingHint: "Worked steps appear as handwriting instead of typeset text",
    /** the Live switch, moved out of the top bar: says what it does, not what it is called */
    liveOn: "Check my steps as I write",
    liveOffHint: "Live is switched off for this build",
    /** hover text on the resting pill once the student has switched Live off themselves */
    offHint: "Switch checking back on under Board options",
    modeInfo: "How help modes work",
    report: "Report a bug",
    shapeCap: "Lots of marks on this page. Clear marks to keep going.",
  },

  hint: {
    gotIt: "Got it",
    moreHelp: "More help",
    levelLabel: (level: number) => (level <= 1 ? "Hint" : level === 2 ? "Closer look" : "One step"),
    region: "Hints from Live",
  },

  /**
   * The bar's big ask button, beside the dial: the one thing a stuck student taps. Words a
   * six-year-old reads at a glance.
   */
  ask: {
    help: "Help me",
    helpHint: "Stuck? Your tutor writes the next step for you",
    solve: "Solve it",
    solveHint: "Your tutor writes the rest of the steps",
    /**
     * after either hint: it acts on the problem written in last, unless the student picks another
     * with the select tool (the arrow) — the outline shows which while it is hovered
     */
    pickHint: "Several problems? Tap one with the arrow tool to choose it",
    /** tapped with nothing on the screen yet */
    nothingYet: "Write a line of maths first, then tap Help me",
  },

  /**
   * What Solve (and Help on a drawing) says when it has nothing to write. The two notes are not
   * errors — nothing failed, there is just nothing to work out yet — so they come as a quiet toast,
   * never the red card; `failed` is the one that is, and says what to try next.
   */
  solve: {
    /** the tutor read the drawing (or the ink) and nothing on it asks for anything */
    nothingAsked: "Nothing to solve here yet — write what to find, like x = ?",
    /** a lone expression already in its simplest form (`2x^{2}`): nothing to simplify, nothing to solve */
    simplest: "This is as simple as it gets — add = something to solve",
    /** Solve genuinely could not answer: no step it was given held up */
    failed: "Couldn't solve this one — try writing it again a bit clearer",
  },

  /**
   * The Auto switch beside the help tabs: on, the tutor helps by itself when the student stops
   * writing; off, only when they tap the ask button. One word on the switch itself.
   */
  auto: {
    label: "Auto",
    onHint: "Auto is on: your tutor checks and helps when you stop writing",
    offHint: "Auto is off: your tutor waits until you ask",
  },

  /** The notes under the modes in the help-modes explainer (Board options → "How help modes work"). */
  modeInfo: {
    title: "Live",
    body:
      "In every mode the tutor reads each line as you write it and shows it as neat maths for a moment, so you can see what it read. You can switch Live off under Board options.",
    autoTitle: "Auto",
    autoBody:
      "With Auto on, the tutor helps by itself when you stop writing: it marks each step, checks lines it is not sure about, writes the next step in Suggest when you seem stuck and finishes the problem in Solve. With Auto off, it waits until you tap Help me or Solve it, then marks that problem and helps.",
  },

  errors: {
    boundary: "Live paused for this session.",
    /** transport could not reach the server although the browser reports being online */
    network: "Couldn't reach the tutor service",
    unauthorized: "Please sign in again",
    /** seconds until the rate limit lifts */
    rateLimited: (seconds: number) => `Slowing down — try again in ${waitPhrase(seconds)}`,
    rateLimitedReady: "You can try again now",
    /** 402 without a usable server message; "Get ink" opens the packs */
    ink: "You're out of ink — grab an ink pack to keep the tutor going",
    upstream: "The tutor service had a hiccup",
    timeout: "Reading took too long",
    /** a check or a solve whose stream went silent (a stalled connection) */
    answerTimeout: "The tutor took too long to answer",
    unknown: "Something went sideways",
    /** appended once the same call has failed more than once */
    attempts: (n: number) => `tried ${n} times`,
    /** echo chip under ink whose recognition failed (low confidence keeps its own chip) */
    recognizeChip: "Couldn't read this line — tap Retry",
    /** error card heading when a hint or next step the student asked for (Help me, More help) could not be fetched */
    hintCard: "Couldn't get a hint right now",
    /** error card heading when Solve it could not finish the working */
    solveCard: "Couldn't solve this",
    /** error card heading when the check of a line the student asked about failed */
    checkCard: "Couldn't check this line",
    retry: "Retry",
    dismiss: "Dismiss",
    signIn: "Sign in",
    /** 402: opens the ink dialog (the packs) */
    getInk: "Get ink",
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
  /** autosave refused and there are no images left to move out: only less on the board helps */
  boardFull: "Board full — new work here isn't saved. Start a new board",
  /** the last save was above 80 % of the hard limit */
  boardNearlyFull: "Board almost full — start a new board soon",
  /** an upload fell back to embedding the image in the board (shown once per session) */
  inlineFallback: "Couldn't upload this image to storage; it was saved inside the board instead.",
} as const;
