/**
 * The weekly report opened at one kid: the Family page's "See <name>'s week" lands on /report with
 * `?kid=<id>`, and the report scrolls to that kid's card and marks it. The grown-up stays on their own
 * profile (no switch, no PIN to come back). Pure.
 */
import { REPORT_PATH } from "./contracts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `/report?kid=<id>`: this week's report, at that kid. */
export function reportFocusPath(kidId: string): string {
  return `${REPORT_PATH}?kid=${encodeURIComponent(kidId)}`;
}

/** The kid a `?kid=` asks for, or null when it is not a user id. */
export function parseFocusKid(raw: unknown): string | null {
  return typeof raw === "string" && UUID.test(raw) ? raw.toLowerCase() : null;
}

/** The id of a kid's card on the report, for scrolling to it. */
export function childCardId(userId: string): string {
  return `report-kid-${userId}`;
}
