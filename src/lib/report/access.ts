/**
 * Whose week a caller may read, and whose board they may watch. Pure, over the caller's family as the
 * server read it (`FamilyLinks`, src/lib/family/members.ts), so the rule that keeps one family's kids
 * away from another's is a plain function with plain tests, the same way the family routes do it:
 *
 *  - a grown-up reads their kids' weeks (in the order they were added), and their own when they did
 *    something that week (the page is about the kids; a parent who also practises sees theirs too);
 *  - a grown-up with no kids, or an account with no family at all, reads their own week;
 *  - a kid profile reads only their own week (never a sibling's);
 *  - a board's replay opens for its owner, and for the owner's grown-up; for nobody else.
 *
 * A kid is a kid by their address (`isKidEmail`) or by their family_members row, whichever says so,
 * like src/lib/family/server/service.ts.
 */
import { isKidEmail } from "@/lib/family/contracts";
import type { FamilyLinks } from "@/lib/family/members";
import type { ReportRole } from "./contracts";

export interface Caller {
  id: string;
  email: string | null;
}

export interface ReportScope {
  role: ReportRole;
  /** the grown-up (or solo student, or the kid themselves) the report is for */
  ownerId: string;
  /** whose weeks, in order; `optional` ones are left out when their week was empty */
  members: { id: string; optional: boolean }[];
}

function isKid(caller: Caller, links: FamilyLinks | null): boolean {
  return isKidEmail(caller.email) || (!!links && links.parentId !== caller.id);
}

/** Whose weeks `caller` reads. `links` must be the CALLER's family (null for a solo account). */
export function reportScope(links: FamilyLinks | null, caller: Caller): ReportScope {
  if (isKid(caller, links)) return { role: "kid", ownerId: caller.id, members: [{ id: caller.id, optional: false }] };
  if (!links || links.kids.length === 0) return { role: links ? "parent" : "solo", ownerId: caller.id, members: [{ id: caller.id, optional: false }] };
  return {
    role: "parent",
    ownerId: caller.id,
    members: [...links.kids.map((id) => ({ id, optional: false })), { id: caller.id, optional: true }],
  };
}

/** May `caller` watch a board owned by `ownerId`? Their own, or (for a grown-up) one of their own kids'. */
export function mayWatch(links: FamilyLinks | null, caller: Caller, ownerId: string): boolean {
  if (ownerId === caller.id) return true;
  return !isKid(caller, links) && !!links && links.parentId === caller.id && links.kids.includes(ownerId);
}
