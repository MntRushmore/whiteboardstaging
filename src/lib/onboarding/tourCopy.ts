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

/**
 * How the starter on the board is worked (`StarterProblem.oneStep`): `answer` when its first step
 * is the answer (`3 + 4`: a young student writes `7`, and "the next step" means nothing to them),
 * so the coach marks ask for and talk about the answer instead of a step.
 */
export interface StarterWords {
  answer?: boolean;
}

/** Coach mark 1: write the next step or the answer (`write`), then what the tutor's mark means (`result`). */
export function writeCopy(state: Pick<TourState, "step" | "outcome" | "unread" | "unjudged">, hint: string | null, { answer = false }: StarterWords = {}): CoachCopy {
  if (state.step === "result") {
    if (state.outcome === "tick") {
      return {
        title: answer ? "Yes! That tick means you got it right." : "Nice! That tick means your step is right.",
        body: "Your tutor checks every line you write.",
        button: TOUR_COPY.next,
        waiting: false,
      };
    }
    return {
      title: answer ? "That ring means not yet." : "That ring means something's off.",
      body: "No worries, that's how you learn! Rub it out and try again, or tap Next.",
      button: TOUR_COPY.next,
      waiting: false,
    };
  }
  const body = state.unjudged
    ? answer
      ? `That ? means your tutor can't check that yet.${hint ? ` ${hint}` : " Write the whole answer."}`
      : `That ? means your tutor needs a whole line to check.${hint ? ` ${hint}` : " Write the whole next step."}`
    : state.unread
      ? "Your tutor couldn't read that line. Try writing it a little bigger."
      : hint
        ? `${hint} Your tutor checks it.`
        : "Your tutor checks every line you write.";
  const title = !hint ? "Grab the pen. Write a line of maths." : answer ? "Grab the pen. Write the answer under the problem." : "Grab the pen. Write the next step under the problem.";
  return { title, body, button: TOUR_COPY.next, waiting: true };
}

/**
 * Coach mark 2: tap Help me (`help`), then the step the tutor wrote (`helped`). `solve`: the dial
 * is on Solve, where the same button says Solve it and writes every step. `answer`: the problem is
 * one whose next step is its answer; `fresh`: the tour has just written it, because the student
 * already answered the first (`helpProblemFor`).
 */
export function helpCopy(step: "help" | "helped", help: TourHelp, solve = false, { answer = false, fresh = false }: StarterWords & { fresh?: boolean } = {}): CoachCopy {
  const button = solve ? "Solve it" : "Help me";
  if (step === "helped") {
    if (solve) return { title: "Your tutor wrote the steps for you!", body: "Read them one line at a time. Tap Next when you're ready.", button: TOUR_COPY.next, waiting: false };
    return answer
      ? { title: "Your tutor wrote the answer for you!", body: "Read it, then try the next one. Tap Help me any time you're stuck.", button: TOUR_COPY.next, waiting: false }
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
              : answer
                ? "Your tutor writes the answer for you."
                : "Your tutor writes the next step for you.";
  // the new problem on the board is the one this coach mark is about
  const title = fresh && help === "waiting" ? `Here's a new one. Stuck? Tap ${button}.` : `Stuck? Tap ${button}.`;
  return { title, body, button: TOUR_COPY.next, waiting: true };
}

/**
 * Coach mark 3: tap Ask (`ask`), then tap a question in the panel (`asking`) — "3 more like these"
 * when the panel still shows its suggestions, any question once it has messages.
 */
export function askCopy(step: "ask" | "asking", opts: { busy: boolean; suggestion: string | null }): CoachCopy {
  if (step === "ask") {
    return { title: "Want more practice? Tap Ask.", body: "Your tutor writes new problems on your board.", button: TOUR_COPY.next, waiting: true };
  }
  if (opts.busy) return { title: "Your tutor is on it!", body: "Watch your board. New problems are on the way.", button: TOUR_COPY.next, waiting: true };
  return {
    title: opts.suggestion ? `Tap “${opts.suggestion}”.` : "Ask your tutor for more practice.",
    // no ink count: the tour comes before the plan, and with the plan an ask spends none
    body: opts.suggestion ? "Or type what you want to practise." : "Type what you want to practise, then send it.",
    button: TOUR_COPY.next,
    waiting: true,
  };
}
