/**
 * Who may become whom, and what the family looks like to the person asking. Pure: the server reads
 * the rows (src/lib/family/server/store.ts, service role) and hands them here, so the rules that
 * keep one family's kids away from another's are plain functions with plain tests.
 *
 * The rules (docs/KIDS-COME-BACK.md, src/lib/family/contracts.ts):
 *  - only members of ONE family switch, and only to someone in that same family;
 *  - switching to the grown-up needs their PIN; to a kid (from the grown-up or a sibling) it does not;
 *  - a solo account has nobody to switch to.
 */
import { isAvatarId, type AvatarId, type FamilyMember, type FamilyState } from "./contracts";
import { isGrade } from "@/lib/learning/grades";

/** The caller's family as the server read it: the grown-up and the kids, in the order they were added. */
export interface FamilyLinks {
  parentId: string;
  kids: string[];
}

export type SwitchRefusal = "solo" | "not_in_family" | "self";

export type SwitchDecision = { ok: true; parentId: string; needsPin: boolean } | { ok: false; reason: SwitchRefusal };

/**
 * May `caller` become `to`? `links` must be the CALLER's family (null for a solo account). A `to`
 * that is not in it — another family's kid, a stranger, a made-up id — is refused the same way, so
 * the answer never says whether such an account exists.
 */
export function decideSwitch(links: FamilyLinks | null, caller: string, to: string): SwitchDecision {
  if (!links) return { ok: false, reason: "solo" };
  const inFamily = (id: string) => id === links.parentId || links.kids.includes(id);
  if (!inFamily(caller)) return { ok: false, reason: "not_in_family" };
  if (to === caller) return { ok: false, reason: "self" };
  if (!inFamily(to)) return { ok: false, reason: "not_in_family" };
  return { ok: true, parentId: links.parentId, needsPin: to === links.parentId };
}

/** Is `kidId` one of the grown-up `caller`'s own kids? (Editing or removing a kid needs this.) */
export function ownsKid(links: FamilyLinks | null, caller: string, kidId: string): boolean {
  return !!links && links.parentId === caller && links.kids.includes(kidId);
}

/** One member's profile, as read from `profiles`. */
export interface MemberProfile {
  displayName: string | null;
  avatar: string | null;
  grade: number | null;
}

export type KidStats = NonNullable<FamilyMember["stats"]>;

/** What a member is called when their profile has no name yet (a grown-up's often has none). */
export const UNNAMED = { grownUp: "Grown-up", kid: "Kid" } as const;

function member(userId: string, isParent: boolean, profile: MemberProfile | undefined, stats: KidStats | null): FamilyMember {
  const name = profile?.displayName?.trim();
  return {
    userId,
    displayName: name || (isParent ? UNNAMED.grownUp : UNNAMED.kid),
    avatar: isAvatarId(profile?.avatar) ? profile.avatar : null,
    grade: isGrade(profile?.grade) ? profile.grade : null,
    isParent,
    stats,
  };
}

/**
 * GET /api/family's answer for `me`. Stats go only to the grown-up, and only for their own kids:
 * a kid sees their siblings' names and pictures (to switch to them), never their numbers.
 */
export function buildFamilyState(input: {
  me: string;
  links: FamilyLinks | null;
  hasPin: boolean;
  profiles: ReadonlyMap<string, MemberProfile>;
  stats?: ReadonlyMap<string, KidStats>;
}): FamilyState {
  const { me, links, hasPin, profiles } = input;
  if (!links) {
    return { role: "solo", me, parentId: me, members: [member(me, true, profiles.get(me), null)], hasPin: false };
  }
  const role = links.parentId === me ? "parent" : "kid";
  const members = [
    member(links.parentId, true, profiles.get(links.parentId), null),
    ...links.kids.map((id) => member(id, false, profiles.get(id), role === "parent" ? (input.stats?.get(id) ?? null) : null)),
  ];
  return { role, me, parentId: links.parentId, members, hasPin };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseStats(raw: unknown): KidStats | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);
  const streak = n(r.streak);
  const problemsThisWeek = n(r.problemsThisWeek);
  const mastered = n(r.mastered);
  return streak === null || problemsThisWeek === null || mastered === null ? null : { streak, problemsThisWeek, mastered };
}

function parseMember(raw: unknown): FamilyMember | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.userId !== "string" || !UUID.test(r.userId) || typeof r.displayName !== "string") return null;
  return {
    userId: r.userId,
    displayName: r.displayName,
    avatar: isAvatarId(r.avatar) ? (r.avatar as AvatarId) : null,
    grade: isGrade(r.grade) ? r.grade : null,
    isParent: r.isParent === true,
    stats: parseStats(r.stats),
  };
}

/**
 * GET /api/family's body as the app uses it, or null for anything malformed. Never throws: a page
 * that cannot read the family shows the account as solo (no switcher) rather than breaking.
 */
export function parseFamilyState(raw: unknown): FamilyState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.role !== "solo" && r.role !== "parent" && r.role !== "kid") return null;
  if (typeof r.me !== "string" || typeof r.parentId !== "string" || !Array.isArray(r.members)) return null;
  const members = r.members.map(parseMember);
  if (members.some((m) => m === null) || members.length === 0) return null;
  return { role: r.role, me: r.me, parentId: r.parentId, members: members as FamilyMember[], hasPin: r.hasPin === true };
}

/** The member who is signed in, if the state names them. */
export function currentMember(state: FamilyState | null): FamilyMember | null {
  return state?.members.find((m) => m.userId === state.me) ?? null;
}

/** A family worth a switcher: someone else to switch to. */
export function hasOthers(state: FamilyState | null): boolean {
  return !!state && state.role !== "solo" && state.members.length > 1;
}
