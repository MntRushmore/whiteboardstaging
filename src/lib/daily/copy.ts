/**
 * Every word Today's practice shows, on the home card and on the board. Kept here, apart from the
 * components, so the tests can read them and so they stay short, warm and simple enough for a
 * six-year-old to read on their own. Pure and import-free.
 */

export const TODAY_COPY = {
  eyebrow: "Today's practice",
  /** the card's big line */
  title: (goal: number) => `${goal} problems`,
  minutes: (goal: number) => `About ${goal * 2} minutes`,
  /** started: what is left */
  minutesLeft: (left: number) => (left <= 1 ? "Just one more!" : `About ${left * 2} minutes to go`),
  start: "Start",
  startLabel: (goal: number) => `Start today's practice: ${goal} problems`,
  continue: "Continue",
  continueLabel: (done: number, goal: number) => `Continue today's practice: ${done} of ${goal} done`,
  progress: (done: number, goal: number) => `${done} of ${goal} done`,
  /** the set's skills, beside the big button */
  mixTitle: "In today's set",
  /** why a skill is in the set: "next" reads "New" only for a skill the student has not tried yet */
  why: { next: "Next up", weak: "Practice", review: "Warm-up" } as Record<string, string>,
  whyNew: "New",
  /** done for the day */
  doneTitle: "You did it!",
  doneLine: "Come back tomorrow!",
  more: "Practice more",
  /**
   * the streak's flame: days in a row with Today's practice FINISHED. Called a "streak" here and on
   * the board's celebration, never "days in a row": the Progress page's "days of math in a row"
   * counts any day with a problem (`streakWording`), a different number.
   */
  streak: (n: number) => `${n}-day practice streak`,
  /** the words beside the flame's big number */
  streakUnit: "day streak",
  streakNone: "Start a streak today!",
  best: (n: number) => `Best: ${n}`,
  weekLabel: "This week",
  /** a day dot, read out */
  dayLabel: (weekday: string, state: string) => `${weekday}: ${state}`,
  dayStates: { done: "done", started: "started", missed: "not done", today: "today", future: "coming up", before: "before your first practice" } as Record<string, string>,
  /** the stars, read out */
  starsLabel: (stars: number, done: number, goal: number) => `${stars} ${stars === 1 ? "star" : "stars"}, ${done} of ${goal} done`,
  /** the board's name: "Today's practice · Thursday" */
  boardTitle: (weekday: string) => `Today's practice · ${weekday}`,
  moreBoardTitle: (weekday: string) => `More practice · ${weekday}`,
  failedTitle: "Today's practice didn't open",
  failedLine: "Try again in a moment.",
  noProblems: "There are no problems for you just now. Try a topic below!",
} as const;

export const DAILY_BOARD_COPY = {
  /** the pill */
  pill: (done: number, goal: number) => `${Math.min(done, goal)} of ${goal}`,
  pillLabel: (stars: number, done: number, goal: number) => `Today's practice: ${Math.min(done, goal)} of ${goal} done, ${stars} ${stars === 1 ? "star" : "stars"}`,
  extra: (n: number) => `+${n}`,
  /** the celebration */
  title: "You did it!",
  /** beside a flame */
  streak: (n: number) => (n >= 2 ? `${n}-day streak!` : "Day 1! Come back tomorrow."),
  /** under the slots: as many stars as there are star shapes, and the ticks (done with help) said apart */
  stars: (stars: number, goal: number) => {
    const helped = Math.max(0, goal - stars);
    if (helped === 0) return "All stars! Amazing!";
    if (stars <= 0) return goal === 1 ? "Done with help!" : `All ${goal} done with help!`;
    return `${stars} ${stars === 1 ? "star" : "stars"} by yourself, ${helped} with help`;
  },
  home: "Back home",
  keepGoing: "Keep going",
  close: "Close",
  /** read out when the goal is reached */
  announce: (n: number) => (n >= 2 ? `You did it! A ${n}-day streak.` : "You did it! Day 1 of your streak."),
  bonusToast: "3 more for you!",
  bonusFailed: "Couldn't write more problems. Try again in a moment.",
  /** the rest of a set whose writing was cut short */
  topUpToast: (n: number) => (n === 1 ? "One more to finish today's set!" : `${n} more to finish today's set!`),
  topUpFailed: "Couldn't write the rest of today's set. Open this board again in a moment.",
} as const;
