/**
 * Where a reporter reads and answers our replies (2026-10-09). On its own, with no dependency, so the
 * Report a bug dialog (src/components/BugReportButton.tsx, also lazily loaded on the board) links to
 * the page without carrying the replies' contract.
 */

/** The reporter's page: their reports and the replies. */
export const REPORTS_PATH = "/reports";

/** One report on the reporter's page: its anchor (the reply email's button lands there). */
export function reportHref(reportId: string): string {
  return `${REPORTS_PATH}#${reportId}`;
}
