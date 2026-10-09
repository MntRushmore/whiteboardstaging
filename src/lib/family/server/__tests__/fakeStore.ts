/**
 * An in-memory FamilyStore for the family service and route tests: families, kids, profiles, PIN
 * hashes, a per-family PIN counter that behaves like family_pin_attempt / family_pin_forgive, and a
 * record of every session minted and revoked, so a test can say exactly what the server did.
 */
import { PIN_ATTEMPTS, hashPin } from "../pin";
import type { FamilyStore, PinAttempt, ProfileRow } from "../store";
import type { FamilyLinks, KidStats } from "@/lib/family/members";

export const IDS = {
  parent: "11111111-1111-4111-8111-111111111111",
  kidA: "22222222-2222-4222-8222-222222222222",
  kidB: "33333333-3333-4333-8333-333333333333",
  otherParent: "44444444-4444-4444-8444-444444444444",
  otherKid: "55555555-5555-4555-8555-555555555555",
  solo: "66666666-6666-4666-8666-666666666666",
  nobody: "77777777-7777-4777-8777-777777777777",
} as const;

export const PIN = "4826";
export const OTHER_PIN = "1357";

export interface FakeStore extends FamilyStore {
  families: Map<string, { pinHash: string | null; kids: string[] }>;
  profileRows: Map<string, ProfileRow>;
  emails: Map<string, string>;
  minted: string[];
  revoked: string[];
  deleted: string[];
  pinHits: Map<string, number>;
  created: Array<{ parentId: string; termsVersion: string | null }>;
}

/**
 * Two families (the parent with kids A and B and a PIN; another parent with one kid and their own
 * PIN) and a solo account. `nobody` exists nowhere.
 */
export async function makeFakeStore(): Promise<FakeStore> {
  const [hash, otherHash] = await Promise.all([hashPin(PIN), hashPin(OTHER_PIN)]);
  const families = new Map<string, { pinHash: string | null; kids: string[] }>([
    [IDS.parent, { pinHash: hash, kids: [IDS.kidA, IDS.kidB] }],
    [IDS.otherParent, { pinHash: otherHash, kids: [IDS.otherKid] }],
  ]);
  const profileRows = new Map<string, ProfileRow>([
    [IDS.parent, { displayName: null, avatar: null, grade: null, termsVersion: "2026-10-04" }],
    [IDS.kidA, { displayName: "Ava", avatar: "fox", grade: 3, termsVersion: "2026-10-04" }],
    [IDS.kidB, { displayName: "Ben", avatar: "owl", grade: 1, termsVersion: "2026-10-04" }],
    [IDS.otherParent, { displayName: "Sam", avatar: null, grade: null, termsVersion: "2026-10-04" }],
    [IDS.otherKid, { displayName: "Zoe", avatar: "cat", grade: 5, termsVersion: "2026-10-04" }],
    [IDS.solo, { displayName: "Solo", avatar: null, grade: null, termsVersion: "2026-10-04" }],
  ]);
  const emails = new Map<string, string>([
    [IDS.parent, "parent@example.com"],
    [IDS.kidA, `kid-${IDS.kidA}@kids.agathon.app`],
    [IDS.kidB, `kid-${IDS.kidB}@kids.agathon.app`],
    [IDS.otherParent, "other@example.com"],
    [IDS.otherKid, `kid-${IDS.otherKid}@kids.agathon.app`],
    [IDS.solo, "solo@example.com"],
  ]);
  const minted: string[] = [];
  const revoked: string[] = [];
  const deleted: string[] = [];
  const pinHits = new Map<string, number>();
  const created: Array<{ parentId: string; termsVersion: string | null }> = [];

  const linksOf = (userId: string): FamilyLinks | null => {
    for (const [parentId, f] of families) {
      if (parentId === userId || f.kids.includes(userId)) return { parentId, kids: [...f.kids] };
    }
    return null;
  };

  const store: FakeStore = {
    families,
    profileRows,
    emails,
    minted,
    revoked,
    deleted,
    pinHits,
    created,
    async links(userId) {
      return linksOf(userId);
    },
    async family(parentId) {
      const f = families.get(parentId);
      return f ? { pinHash: f.pinHash } : null;
    },
    async profiles(ids) {
      return new Map(ids.filter((id) => profileRows.has(id)).map((id) => [id, profileRows.get(id)!]));
    },
    async setPin(parentId, pinHash) {
      const f = families.get(parentId);
      if (f) f.pinHash = pinHash;
      else families.set(parentId, { pinHash, kids: [] });
    },
    async createKid(parentId, input, termsVersion) {
      const id = `88888888-8888-4888-8888-${String(created.length).padStart(12, "0")}`;
      created.push({ parentId, termsVersion });
      families.get(parentId)!.kids.push(id);
      profileRows.set(id, { displayName: input.displayName, avatar: input.avatar, grade: input.grade, termsVersion });
      emails.set(id, `kid-${id}@kids.agathon.app`);
      return id;
    },
    async editKid(kidId, patch) {
      const row = profileRows.get(kidId)!;
      profileRows.set(kidId, { ...row, ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}), ...(patch.avatar !== undefined ? { avatar: patch.avatar } : {}), ...(patch.grade !== undefined ? { grade: patch.grade } : {}) });
    },
    async deleteKid(kidId) {
      deleted.push(kidId);
      for (const f of families.values()) f.kids = f.kids.filter((k) => k !== kidId);
      profileRows.delete(kidId);
      emails.delete(kidId);
      return { assetsRemoved: 0, assetsError: null };
    },
    async stats(kidIds) {
      return new Map<string, KidStats>(kidIds.map((id, i) => [id, { streak: i + 1, problemsThisWeek: 10 + i, mastered: i }]));
    },
    async pinAttempt(parentId): Promise<PinAttempt> {
      const hits = (pinHits.get(parentId) ?? 0) + 1;
      pinHits.set(parentId, hits);
      const allowed = hits <= PIN_ATTEMPTS.limit;
      return { ok: allowed, remaining: Math.max(0, PIN_ATTEMPTS.limit - hits), retryAfterMs: allowed ? 0 : 600_000, windowStart: "2026-10-09T00:00:00.000Z", backend: "db" };
    },
    async pinForgive(parentId) {
      pinHits.set(parentId, Math.max(0, (pinHits.get(parentId) ?? 0) - 1));
    },
    async emailOf(userId) {
      return emails.get(userId) ?? null;
    },
    async mintSession(email) {
      minted.push(email);
      return { access_token: `access-for-${email}`, refresh_token: `refresh-for-${email}` };
    },
    async revokeSession(token) {
      revoked.push(token);
    },
  };
  return store;
}
