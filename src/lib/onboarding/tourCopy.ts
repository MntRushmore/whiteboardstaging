/**
 * The words of the guided first board: its coach marks and the finish card. Written for a six-year-
 * old reading on their own: second person, one short title that says the one thing to do, at most
 * two short sentences under it, the button names exactly as the board shows them (Help me, Ask,
 * Solve), and never "wrong". Pure, so the tests can hold every line to that.
 *
 * Its own module, not `copy.ts`: that one is on the home's and the sign-in page's first load, and
 * these words are only ever needed by the tour's lazy chunk.
 */
import type { TourHelp, TourState } from "./tour";

/**
 * The Ask panel's suggestion coach mark 3 points at: one of its own first asks (`CHAT_SUGGESTIONS`
 * in src/components/chat/chatView.ts, pinned in the tests). Spelled out here rather than exported
 * from the panel, which is on the board's first load.
 */
export const MORE_LIKE_THESE = "3 more like these";

export interface CoachCopy {
  title: string;
  body: string;
  /** the coach mark's button: "Next" either way — outlined while the board is still waiting for the student */
  button: string;
  /** the board is waiting for the student to do the thing (the button is the quiet way past it) */
  waiting: boolean;
}

export const TOUR_COPY = {
  /** the status line while the tutor writes the starter problem */
  writingProblem: "Your tutor is writing a problem for you…",
  /** "Tip 1 of 3", for screen readers (the dots show it) */
  tip: (n: number, total: number) => `Tip ${n} of ${total}`,
  next: "Next",
  skip: "Skip tour",
  skipHint: "Skip the tour and go to your boards",
  finish: {
    title: "You're all set!",
    lede: "Now you know the three things your tutor can do.",
    recap: [
      { id: "write", text: "Write a step. Your tutor checks it." },
      { id: "help", text: "Stuck? Tap Help me." },
      { id: "ask", text: "Want more? Tap Ask." },
    ],
    button: "Continue",
  },
} as const;

/** Coach mark 1: write the next step (`write`), then what the tutor's mark means (`result`). */
export function writeCopy(state: Pick<TourState, "step" | "outcome" | "unread" | "unjudged">, hint: string | null): CoachCopy {
  if (state.step === "result") {
    return state.outcome === "tick"
      ? { title: "Nice! That tick means your step is right.", body: "Your tutor checks every line you write.", button: TOUR_COPY.next, waiting: false }
      : { title: "That ring means something's off.", body: "No worries, that's how you learn! Rub it out and try again, or tap Next.", button: TOUR_COPY.next, waiting: false };
  }
  const body = state.unjudged
    ? `That ? means your tutor needs a whole line to check.${hint ? ` ${hint}` : " Write the whole next step."}`
    : state.unread
      ? "Your tutor couldn't read that line. Try writing it a little bigger."
      : hint
        ? `${hint} Your tutor checks it.`
        : "Your tutor checks every line you write.";
  return { title: hint ? "Grab the pen. Write the next step under the problem." : "Grab the pen. Write a line of maths.", body, button: TOUR_COPY.next, waiting: true };
}

/**
 * Coach mark 2: tap Help me (`help`), then the step the tutor wrote (`helped`). `solve`: the dial
 * is on Solve, where the same button says Solve it and writes every step.
 */
export function helpCopy(step: "help" | "helped", help: TourHelp, solve = false): CoachCopy {
  const button = solve ? "Solve it" : "Help me";
  if (step === "helped") {
    return solve
      ? { title: "Your tutor wrote the steps for you!", body: "Read them one line at a time. Tap Next when you're ready.", button: TOUR_COPY.next, waiting: false }
      : { title: "Your tutor wrote the next step for you!", body: "Read it, then keep going. Tap Help me any time you're stuck.", button: TOUR_COPY.next, waiting: false };
  }
  const body =
    help === "empty"
      ? `Write a line of maths first, then tap ${button}.`
      : help === "unread"
        ? `Your tutor couldn't read your last line. Write it a little bigger, then tap ${button}.`
        : help === "slow"
          ? "Your tutor is still working on it. You can tap Next."
          : help === "asked"
            ? "Your tutor is writing it now. Watch the board!"
            : solve
              ? "Your tutor writes the rest of the steps for you."
              : "Your tutor writes the next step for you.";
  return { title: `Stuck? Tap ${button}.`, body, button: TOUR_COPY.next, waiting: true };
}

/**
 * Coach mark 3: tap Ask (`ask`), then tap a question in the panel (`asking`) — "3 more like these"
 * when the panel still shows its suggestions, any question once it has messages.
 */
export function askCopy(step: "ask" | "asking", opts: { busy: boolean; suggestion: string | null; ink: number }): CoachCopy {
  if (step === "ask") {
    return { title: "Want more practice? Tap Ask.", body: "Your tutor writes new problems on your board.", button: TOUR_COPY.next, waiting: true };
  }
  if (opts.busy) return { title: "Your tutor is on it!", body: "Watch your board. New problems are on the way.", button: TOUR_COPY.next, waiting: true };
  return {
    title: opts.suggestion ? `Tap “${opts.suggestion}”.` : "Ask your tutor for more practice.",
    body: `${opts.suggestion ? "Or type what you want to practise." : "Type what you want to practise, then send it."} Each ask uses ${opts.ink} ink.`,
    button: TOUR_COPY.next,
    waiting: true,
  };
}
