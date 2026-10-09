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
  start: "Start",
  startLabel: (goal: number) => `Start today's practice: ${goal} problems`,
  continue: "Continue",
  continueLabel: (done: number, goal: number) => `Continue today's practice: ${done} of ${goal} done`,
  progress: (done: number, goal: number) => `${done} of ${goal} done`,
  /** done for the day */
  doneTitle: "You did it!",
  doneLine: "Come back tomorrow!",
  more: "Practise more",
  /** the streak's flame */
  streak: (n: number) => (n === 1 ? "1 day in a row" : `${n} days in a row`),
  /** the words beside the flame's big number */
  streakUnit: (n: number) => (n === 1 ? "day in a row" : "days in a row"),
  streakNone: "Start a streak today!",
  best: (n: number) => `Best: ${n}`,
  weekLabel: "This week",
  /** a day dot, read out */
  dayLabel: (weekday: string, state: string) => `${weekday}: ${state}`,
  dayStates: { done: "done", started: "started", missed: "not done", today: "today", future: "coming up" } as Record<string, string>,
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
  streak: (n: number) => (n >= 2 ? `${n} days in a row!` : "Day 1! Come back tomorrow."),
  stars: (stars: number, goal: number) => (stars >= goal ? "All stars! Amazing!" : `${stars} ${stars === 1 ? "star" : "stars"} today`),
  home: "Back home",
  keepGoing: "Keep going",
  close: "Close",
  /** read out when the goal is reached */
  announce: (n: number) => (n >= 2 ? `You did it! ${n} days in a row.` : "You did it! Day 1 of your streak."),
  bonusToast: "3 more for you!",
  bonusFailed: "Couldn't write more problems. Try again in a moment.",
} as const;
