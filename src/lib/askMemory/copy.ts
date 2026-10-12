/**
 * The words of "What Ask remembers" (the account page, and each kid on the Family page). A kid reads
 * the account page's version about themselves, so it is kid-simple; the grown-up's is about their
 * kid by name.
 */
export const ASK_MEMORY_COPY = {
  title: "What Ask remembers",
  hint: "Ask keeps a few notes about how you learn, like what's tricky and what helps. Never who you are.",
  kidHint: (name: string) => `Ask keeps a few notes about how ${name} learns, like what's tricky and what helps. Never who they are.`,
  empty: "Nothing yet. As you chat with Ask, it notes what helps you learn.",
  kidEmpty: (name: string) => `Nothing yet. As ${name} chats with Ask, it notes what helps them learn.`,
  loadFailedTitle: "Couldn't load what Ask remembers",
  loadFallback: "Something went wrong. Try again in a moment.",
  retry: "Try again",
  clear: "Clear",
  clearLabel: "Clear what Ask remembers",
  confirmTitle: "Clear what Ask remembers?",
  confirmBody: "Ask will forget these notes and start fresh. Boards and chats stay.",
  kidConfirmBody: (name: string) => `Ask will forget these notes about ${name} and start fresh. ${name}'s boards and chats stay.`,
  confirm: "Clear notes",
  cancel: "Cancel",
  cleared: "Ask's notes are cleared.",
  clearFailed: "Couldn't clear the notes. Try again in a moment.",
  /** the Family page: the button on each kid, and its dialog */
  kidButton: (name: string) => `What Ask remembers about ${name}`,
  kidTitle: (name: string) => `What Ask remembers about ${name}`,
  close: "Close",
  updated: (when: string) => `Last updated ${when}`,
} as const;

/** "Oct 9" for the last update (the viewer's own zone), or null. */
export function memoryUpdatedLabel(updatedAt: string | null, locale?: string): string | null {
  if (!updatedAt) return null;
  const t = Date.parse(updatedAt);
  if (!Number.isFinite(t)) return null;
  return ASK_MEMORY_COPY.updated(new Date(t).toLocaleDateString(locale ?? "en-US", { month: "short", day: "numeric" }));
}
