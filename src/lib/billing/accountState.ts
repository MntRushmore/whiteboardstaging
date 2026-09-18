/**
 * Pure state for the /account page. Each card loads its own data and owns a
 * `SectionState`; the page-level state decides between the skeleton, the
 * error panel with Retry, and the cards. No React here — see
 * src/lib/billing/__tests__/accountState.test.ts.
 */

export type SectionState<T> =
  | { status: "loading"; data: T | null; error: null }
  | { status: "error"; data: T | null; error: string }
  | { status: "ready"; data: T; error: null };

export type SectionAction<T> =
  | { type: "load" }
  | { type: "loaded"; data: T }
  | { type: "failed"; message: string };

export function initialSection<T>(): SectionState<T> {
  return { status: "loading", data: null, error: null };
}

/**
 * `load` keeps the previous data on screen (a Retry should not blank the card),
 * `loaded` replaces it, `failed` keeps it and records the message.
 */
export function sectionReducer<T>(state: SectionState<T>, action: SectionAction<T>): SectionState<T> {
  switch (action.type) {
    case "load":
      return { status: "loading", data: state.data, error: null };
    case "loaded":
      return { status: "ready", data: action.data, error: null };
    case "failed":
      return { status: "error", data: state.data, error: action.message };
    default:
      return state;
  }
}

export type AccountPageState = "loading" | "error" | "ready";

/**
 * The plan card is the page: while the summary loads the page shows a
 * skeleton; if it fails (and nothing was loaded before) the page shows one
 * error panel with Retry; otherwise the cards render and each handles its own
 * failure inline.
 */
export function accountPageStateFor(summary: SectionState<unknown>): AccountPageState {
  if (summary.status === "ready") return "ready";
  if (summary.data) return "ready";
  return summary.status === "loading" ? "loading" : "error";
}

export const DISPLAY_NAME_MAX = 60;

/**
 * Validation for the inline display-name editor. Empty clears the name (allowed);
 * otherwise 1..60 visible characters with no control characters.
 * Returns the message to show, or null when valid.
 */
export function displayNameError(raw: string): string | null {
  const name = raw.trim();
  if (name.length > DISPLAY_NAME_MAX) return `Keep it under ${DISPLAY_NAME_MAX} characters`;
  if (/[\x00-\x1f\x7f]/.test(name)) return "That name has characters we can't save";
  return null;
}

/** The value written to `profiles.display_name`: trimmed, or null when cleared. */
export function normalizeDisplayName(raw: string): string | null {
  const name = raw.trim();
  return name.length === 0 ? null : name;
}

export const DELETE_CONFIRM_WORD = "DELETE";

/** The delete button arms only once the confirmation word is typed exactly (surrounding spaces ignored). */
export function deleteConfirmed(typed: string): boolean {
  return typed.trim() === DELETE_CONFIRM_WORD;
}

export const ACCOUNT_COPY = {
  title: "Account",
  back: "Back to boards",
  loadFailedTitle: "Couldn't load your account",
  loadFallback: "Something interrupted the request. Retry in a moment.",
  plansFailedTitle: "Couldn't load plans",
  plansFallback: "The plan list didn't arrive. Retry in a moment.",
  usageFailedTitle: "Couldn't load your usage",
  usageFallback: "The usage list didn't arrive. Retry in a moment.",
  usageEmpty: "No AI usage yet. Credits are only spent when the tutor does work for you.",
  profileFailedTitle: "Couldn't load your profile",
  profileFallback: "Your display name didn't load. Retry in a moment.",
  saveNameFailedTitle: "Couldn't save your name",
  saveNameFallback: "The name was not saved. Retry in a moment.",
  deleteFailedTitle: "Couldn't delete your account",
  deleteFallback: "Your account is still here. Retry in a moment.",
  retry: "Retry",
} as const;
