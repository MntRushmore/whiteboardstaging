/**
 * Every word on the try board (/try, docs/TRY-BOARD.md). Written for whoever taps a link on a
 * phone, a kid or a grown-up: short, plain, second person, the board's own voice (the guided board's
 * words, src/lib/onboarding/tourCopy.ts), never "wrong", US English ("check mark", "math"). It says
 * what the board does and nothing it does not: no claims, no numbers of its own. The trial's words
 * come from the plan (`planWords`), handed in by the page, so this module imports nothing and stays
 * small in the page's first load.
 */

export const TRY_COPY = {
  meta: {
    title: "Try Agathon free",
    ogTitle: "Try Agathon free: write a line, the tutor checks it",
    description:
      "Write a line of math with a finger, a pen or the mouse, and Agathon's tutor checks it the way it does on the board: a check mark for a right step, a circle around a slip, and a nudge instead of the answer. No account needed.",
    ogAlt: "Agathon's try board: a problem in the tutor's blue handwriting, a kid's answer written under it, and the tutor's blue check mark beside it.",
  },
  nav: { signIn: "Sign in", cta: "Join Agathon" },
  eyebrow: "Try it free · No account needed",
  title: "Write a line. The tutor checks it.",
  /** the title in its two lines (each its own sentence) */
  titleLines: ["Write a line.", "The tutor checks it."],
  lede: "Pick a grade, then write under the problem with a finger, a pen or the mouse.",
  bands: "Grade",
  another: "Another problem",
  problem: (words: string) => `The problem: ${words}`,
  /** the open line's placeholder, and the pad's name for a screen reader */
  writeHere: (answer: boolean) => (answer ? "Write the answer here" : "Write the next step here"),
  pad: (n: number, answer: boolean) => `Writing pad, line ${n}. ${answer ? "Write the answer" : "Write the next step"} with a finger, a pen or the mouse.`,
  lines: "Your lines",
  check: "Check my line",
  help: "Show me a step",
  erase: "Erase and try again",
  /** what the status line says when nothing has happened yet */
  prompt: (answer: boolean) => (answer ? "When you stop writing, the tutor checks your answer." : "When you stop writing, the tutor checks your step."),
  reading: "Reading your line…",
  helping: "The tutor is writing a step…",
  verdict: {
    check: "Nice! That line is right.",
    checkNext: "Nice! That line is right. Write the next step under it.",
    solved: "You solved it!",
    ring: "So close!",
    unread: "I couldn't read that — write it a little bigger.",
    unjudged: "Keep going — write the whole line.",
  },
  /** a screen reader's words for a line on the pad */
  row: {
    check: (n: number) => `Line ${n}: checked, right.`,
    ring: (n: number) => `Line ${n}: circled. Take another look.`,
    unread: (n: number) => `Line ${n}: the tutor couldn't read it.`,
    tutor: (n: number, words: string) => `Line ${n}, in the tutor's hand: ${words}`,
  },
  helped: "The tutor wrote the next step in blue. Now write the line after it.",
  helpedSolved: "The tutor wrote the answer in blue. Try another problem and write it yourself.",
  noStep: "That's the answer — try another problem.",
  full: "That's a full page. Try another problem.",
  errors: {
    rate: "That's a lot of tries — take a breather and come back in a bit.",
    rateWhen: (ms: number) => {
      const minutes = Math.ceil(ms / 60_000);
      return minutes <= 1 ? "You can check again in a minute." : `You can check again in about ${minutes} minutes.`;
    },
    down: "The tutor is taking a break — Join to use the full board.",
    upstream: "The tutor couldn't read that just now. Tap Check my line to try again.",
    offline: "You're offline. Your line is still here: check it once you're back online.",
    invalid: "Something went wrong. Try another problem.",
  },
  /** under the board: what happens to the writing (docs/TRY-BOARD.md "No account, nothing stored") */
  note: "No account needed. What you write is read to check it, and not kept.",
  finish: {
    title: "Solved!",
    /** when the tutor's step was the answer */
    tutorTitle: "That's the answer!",
    another: "Try another problem",
  },
  join: {
    title: "That's Agathon.",
    body: "On the Agathon board, the tutor checks every line a kid writes, just like this.",
    /** the card while the try board is off: nothing was checked here, so no "like this" */
    titleDown: "Use the full board.",
    bodyDown: "On the Agathon board, the tutor checks every line a kid writes.",
    cta: "Join Agathon",
    another: "Try another problem",
  },
} as const;

export type TryCopy = typeof TRY_COPY;
