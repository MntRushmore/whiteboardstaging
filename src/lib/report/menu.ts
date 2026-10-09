/**
 * The app bar's way to the weekly report: its label and path, and nothing else, because the app bar
 * is on every signed-in page's first load (like src/lib/family/menu.ts). Shown to grown-ups and solo
 * students, never in a kid profile's menu. Pure.
 */
export const REPORT_MENU = {
  label: "Weekly report",
  path: "/report",
  /** the Family page's button, under the kids */
  familyButton: "See this week's report",
} as const;
