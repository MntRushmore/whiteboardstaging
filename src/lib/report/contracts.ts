/**
 * The weekly parent report (2026-10-09, Phase 2 "parents recommend it"): what each child did in a
 * week, in a grown-up's words. It is the page a parent opens to see whether the $25 is working, and
 * the email they forward to another parent.
 *
 *   learning_attempts + daily_practice + whiteboards ──buildWeeklyReport()──► WeeklyReport
 *        │                                                                     │
 *        └── GET /api/report?week=YYYY-MM-DD (the grown-up and their kids) ─────┤──► /report page
 *                                                                              └──► the Sunday email
 *
 * The email is OFF unless WEEKLY_REPORT_EMAILS=on (the owner declined a parent email on 2026-10-04;
 * the page ships, the email waits for their yes). A grown-up can stop it with one tap
 * (`profiles.weekly_report_opt_out`, a signed link in every email). Never sent to a kid address.
 *
 * Shared contract for Phase 2 (docs/KIDS-COME-BACK.md).
 */

/** One child's (or a solo student's) week. */
export interface ChildWeek {
  userId: string;
  displayName: string;
  /** an AVATARS id, or null */
  avatar: string | null;
  grade: number | null;
  /** problems finished this week (any outcome but in_progress / unfinished) */
  problems: number;
  /** of those, solved without help (first_try, self_corrected) */
  independent: number;
  /** minutes of active work */
  minutes: number;
  /** local days this week with at least one problem */
  activeDays: number;
  /** Today's practice sets completed this week, and the streak at the week's end */
  dailySets: number;
  streak: number;
  /** skills that reached `mastered` this week (names, plain) */
  newlyMastered: string[];
  /** skills worked on most, with how it went: up to 4 */
  practised: { skill: string; name: string; problems: number; independent: number }[];
  /** the skill to work on next week, and one sentence a parent can act on; null when nothing stands out */
  focus: { skill: string; name: string; tip: string } | null;
  /** the board with the most work this week, for "Watch them solve it" (a replay link); null without one */
  highlightBoardId: string | null;
  /** problems worked each day, Monday first (7 numbers); added for the page's week strip */
  days?: number[];
}

export interface WeeklyReport {
  /** the Monday the week starts on, YYYY-MM-DD, in the report's time zone */
  weekStart: string;
  timeZone: string;
  /** the grown-up (or solo student) the report is for */
  ownerId: string;
  children: ChildWeek[];
  generatedAt: string;
}

/** profiles.weekly_report_opt_out: true stops the email (the page stays). */
export const REPORT_EMAIL_FLAG = "WEEKLY_REPORT_EMAILS";

/** GET /api/report?week=YYYY-MM-DD&tz=<IANA zone> */
export const REPORT_API = "/api/report";
/** The page (and the email's "See the full report"). */
export const REPORT_PATH = "/report";

/** Who is asking, as GET /api/report saw it: a kid profile sees only their own week. */
export type ReportRole = "solo" | "parent" | "kid";

/** The grown-up's weekly email, as the report page shows it (null for a kid profile). */
export interface ReportEmailState {
  /** profiles.weekly_report_opt_out */
  optedOut: boolean;
  /** WEEKLY_REPORT_EMAILS=on on this deployment: the page shows the email toggle only then */
  sending: boolean;
}

/** GET /api/report's answer. */
export interface ReportAnswer {
  report: WeeklyReport;
  role: ReportRole;
  email: ReportEmailState | null;
}
