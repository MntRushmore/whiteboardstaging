/**
 * Whether this deployment sends the Sunday report email: only with WEEKLY_REPORT_EMAILS=on. The owner
 * declined a parent email on 2026-10-04, so it ships off and waits for their yes; the page works
 * either way. Server-only (it reads the server's env), and a function, so a test can flip it.
 */
export function weeklyReportEmailsOn(): boolean {
  return process.env.WEEKLY_REPORT_EMAILS?.trim().toLowerCase() === "on";
}
