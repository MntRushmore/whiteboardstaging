/**
 * Every word the weekly report page says, in one place. The reader is a grown-up checking whether the
 * $25 is working, often on a phone, often in a minute between other things: plain, calm, specific,
 * no exclamation marks, no made-up claims, and nothing that scolds a quiet week. A grown-up's (or a
 * solo student's) own week says "you" (`self`); a kid profile is sent to their own Progress page
 * instead. US English. Pure data.
 */
import { REPORT_MENU } from "./menu";

export const REPORT_COPY = {
  pageTitle: "Weekly report",
  menuLabel: REPORT_MENU.label,
  back: "Back to boards",
  subtitle: (range: string) => `Monday to Sunday · ${range}`,
  loading: "Loading the week",
  loadFailedTitle: "Couldn't load the report",
  loadFailed: "Check your connection and try again.",
  retry: "Try again",

  // the week picker
  pickerLabel: "Which week",
  thisWeek: "This week",
  lastWeek: "Last week",
  earlier: "Earlier",
  earlierLabel: "Earlier week",

  // one child's week
  stats: {
    problems: "Problems",
    independent: "On their own",
    minutes: "Minutes",
    activeDays: "Days active",
    streak: "Day streak",
  },
  ofProblems: (independent: number, problems: number) => (problems > 0 ? `${Math.round((independent / problems) * 100)}% of problems` : "No problems yet"),
  daysOf: "of 7",
  streakChip: (days: number) => `${days}-day streak`,
  /** the Day streak's line: days Today's practice was finished in the shown week (`current`: this week) */
  streakHint: (days: number, current = true) =>
    days === 0 ? (current ? "No practice days yet" : "No practice days") : `${days} practice ${days === 1 ? "day" : "days"} ${current ? "this week" : "that week"}`,
  weekStripLabel: (name: string) => `${name}'s days this week`,
  dayProblems: (day: string, n: number) => `${day}: ${n === 0 ? "no problems" : `${n} ${n === 1 ? "problem" : "problems"}`}`,
  newThisWeek: "New this week",
  mastered: (names: string) => `Mastered ${names}`,
  practisedTitle: "What they practiced",
  practisedLine: (problems: number, independent: number) => `${problems} ${problems === 1 ? "problem" : "problems"} · ${independent} on their own`,
  practisedLegendAlone: "On their own",
  practisedLegendHelp: "With help",
  nextWeekTitle: "Next week, try",
  watch: "Watch them solve it",
  /** the same card about the reader's own week */
  self: {
    independent: "On your own",
    practisedTitle: "What you practiced",
    practisedLine: (problems: number, independent: number) => `${problems} ${problems === 1 ? "problem" : "problems"} · ${independent} on your own`,
    watch: "Replay your board",
  },
  watchHint: "Replays the board with the most work this week, stroke by stroke.",
  gradeNone: "No grade set",

  // a quiet week
  quietTitle: (name: string) => `A quiet week for ${name}`,
  quietTitleSelf: "A quiet week",
  quietBody: "Today's practice is 5 problems, about 10 minutes. A few minutes on most days is what makes it stick.",
  quietAction: "Open Today's practice",
  quietSwitch: (name: string) => `Start ${name}'s practice`,
  quietPastBody: "Nothing was practiced that week.",

  // nobody did anything
  emptyTitle: "Nothing to report for this week yet",
  emptyBody: "Each kid's week shows up here as soon as they practice: problems solved, skills mastered and what to try next.",
  noKids: "Add a kid on the Family page to see their week here.",
  familyLink: "Go to Family",

  // the Sunday email (shown only where the email is sent)
  emailTitle: "Email me this every Sunday",
  emailOn: "A short summary of each kid's week comes to your inbox on Sunday.",
  emailOff: "The weekly email is off. The report is always here.",
  emailToggle: "Weekly report email",
  emailSaved: (on: boolean) => (on ? "The weekly email is on." : "The weekly email is off."),
  emailFailed: "Couldn't change the email setting. Try again.",

  // the replay
  replayTitle: (name: string) => `${name}'s board`,
  replayTitleSelf: "Your board",
  replayBack: "Back to the report",
  replayLoading: "Loading the board",
  replayMissingTitle: "This board isn't available",
  replayMissing: "It may have been deleted, or it isn't one of your family's boards.",
  replayHint: "The work appears in the order it was written, with the tutor's ticks and rings. Pause, or drag the bar to jump.",
} as const;
