/**
 * Who the app bar says is signed in: the profile's own name (`profiles.display_name`, the name the
 * Family page's switcher and /account show) and picture (`profiles.avatar`), the same for a solo
 * student, a grown-up and a kid profile. Pure and tiny: the app bar is on every signed-in page's
 * first load (no tldraw, no Supabase here; the read is `useOwnProfile`).
 */
import { AVATARS, isAvatarId, type AvatarId } from "@/lib/family/contracts";
import { FAMILY_MENU } from "@/lib/family/menu";

/** The signed-in user's own profile row, as the app bar needs it. */
export interface OwnProfile {
  displayName: string | null;
  avatar: AvatarId | null;
}

/**
 * Window event: the signed-in user's profile changed on this page (ProfileCard saved a new display
 * name). `detail` is a `ProfileChange`; the app bar's kept copy takes it at once, without a re-read.
 */
export const PROFILE_CHANGED_EVENT = "agathon:profile-changed";

export interface ProfileChange {
  userId: string;
  displayName?: string | null;
  avatar?: AvatarId | null;
}

/** Tell the app bar (and anything else listening) that `change.userId`'s profile changed. */
export function announceProfileChange(change: ProfileChange): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent<ProfileChange>(PROFILE_CHANGED_EVENT, { detail: change }));
  } catch {
    /* no CustomEvent: the next page load reads it */
  }
}

/** A name worth showing: a non-blank string, trimmed; otherwise null. */
export function cleanName(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** A `profiles` row (`display_name`, and `avatar` when it was selected) as an OwnProfile. */
export function parseOwnProfile(row: unknown): OwnProfile {
  const r = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
  return { displayName: cleanName(r.display_name), avatar: isAvatarId(r.avatar) ? r.avatar : null };
}

type SessionUser = { user_metadata?: Record<string, unknown> | null } | null | undefined;

/**
 * The name the session already carries, shown until the profile is read: a kid's (the server writes
 * it to their metadata when it makes or renames them), or what sign-up put in `display_name` or
 * `full_name` (the same two the database copies into the new profile).
 */
export function metadataName(user: SessionUser): string | null {
  const meta = user?.user_metadata;
  return cleanName(meta?.display_name) ?? cleanName(meta?.full_name);
}

/**
 * The account menu's name. The profile's display name once it is read (`profile` is undefined
 * until then, null when it could not be read); before that, the name in the session. With no name
 * anywhere, a kid is "Me" and a grown-up or solo student the part of their email before the @ (a
 * kid's address has no name in it).
 */
export function headerName(input: { profile: OwnProfile | null | undefined; user: SessionUser; email: string; kid: boolean }): string {
  const { profile, user, email, kid } = input;
  const fromProfile = profile?.displayName ?? null;
  if (fromProfile) return fromProfile;
  // a read profile with no name: a kid's metadata still carries theirs (the server keeps the two
  // together); a grown-up who cleared theirs gets the email, not an older sign-up name
  const fromSession = profile === undefined || kid ? metadataName(user) : null;
  if (fromSession) return fromSession;
  return kid ? FAMILY_MENU.kidFallbackName : email.split("@")[0] || "Account";
}

/** The soft wash behind each picture, as `FamilyAvatar` draws it (family.module.css), in sRGB. */
const AVATAR_WASH: Record<AvatarId, string> = {
  fox: "#ffe0c9",
  owl: "#f4e6ca",
  cat: "#f5ecc6",
  dog: "#fae3d1",
  panda: "#e7ebf2",
  rabbit: "#ffe1ef",
  tiger: "#ffe2bd",
  frog: "#d7f6d0",
  penguin: "#d1ecff",
  koala: "#e1e9f2",
  lion: "#fde4bb",
  unicorn: "#f2dfff",
};

/**
 * The profile's picture as an image the account menu can show (its `avatarSrc`): the AVATARS emoji
 * on its wash, like `FamilyAvatar`. Undefined without a picture, so the menu draws the name's
 * initial instead (as `FamilyAvatar` does for a grown-up without one).
 */
export function avatarImage(avatar: AvatarId | null | undefined): string | undefined {
  if (!isAvatarId(avatar)) return undefined;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
    `<circle cx="50" cy="50" r="50" fill="${AVATAR_WASH[avatar]}"/>` +
    `<text x="50" y="53" font-size="58" text-anchor="middle" dominant-baseline="central">${AVATARS[avatar]}</text>` +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
