/**
 * Pure view-state for the dashboard (src/app/page.tsx). Kept free of React so
 * the loading / error / empty / list decision is unit-tested directly.
 */

export type DashboardState = "loading" | "error" | "empty" | "list";

export type DashboardStateInput = {
  loading: boolean;
  error: string | null;
  boards: ReadonlyArray<unknown>;
};

/**
 * Precedence: a fetch in flight always shows the skeleton; a failed fetch shows
 * the inline error panel (even if a previous load left boards on screen, the
 * user asked for a refresh and should see why it did not arrive); otherwise
 * empty vs. list.
 */
export function dashboardStateFor({
  loading,
  error,
  boards,
}: DashboardStateInput): DashboardState {
  if (loading) return "loading";
  if (error) return "error";
  if (boards.length === 0) return "empty";
  return "list";
}

export const DASHBOARD_COPY = {
  loadFailedTitle: "Couldn't load your boards",
  loadFallback: "Something interrupted the request. Retry in a moment.",
  createFailedTitle: "Couldn't create a board",
  createFallback: "The board was not created. Retry in a moment.",
  renameFailedTitle: "Couldn't rename this board",
  renameFallback: "The new name was not saved. Retry in a moment.",
  deleteFailedTitle: "Couldn't delete this board",
  deleteFallback: "The board is still here. Retry in a moment.",
  retry: "Retry",
} as const;
