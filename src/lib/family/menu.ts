/**
 * What the app bar needs to know about families, kept tiny because the app bar is on every signed-in
 * page's first load: its two menu labels, and a kid profile's name. A kid's address is
 * `kid-<uuid>@kids.agathon.app` (no name in it), so the header reads the name the server put in the
 * kid's user metadata when it made or renamed them (src/lib/family/server/store.ts). Pure.
 */
export const FAMILY_MENU = {
  family: "Family",
  switchProfile: "Switch profile",
  /** under a kid's name in the menu, where a grown-up sees their email */
  kidSubtitle: "Kid profile",
  /** a kid profile without a name in its metadata (never expected) */
  kidFallbackName: "Me",
} as const;

/** A kid profile's name from their session's user metadata. */
export function kidDisplayName(user: { user_metadata?: Record<string, unknown> | null } | null | undefined): string {
  const name = user?.user_metadata?.display_name;
  return typeof name === "string" && name.trim() ? name.trim() : FAMILY_MENU.kidFallbackName;
}
