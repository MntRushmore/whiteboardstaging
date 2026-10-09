/**
 * Sign-up attribution, the browser's half (2026-10-09, "kids come back"): where a visitor first
 * arrived from, kept on this device until they have an account, then saved to their profile once
 * when it says where they came from (`save_attribution`, which itself only writes a profile that
 * has none, so an empty one is never sent: it would shut out a real one). The admin Funnel groups
 * sign-ups by it (src/lib/funnel/contracts.ts).
 *
 * What is kept, and nothing more: the utm_* values of the first address, the referrer's ORIGIN
 * (never its path or query, which can carry a search or a person), the landing path without its
 * query, a `?ref=` code, and when. A value that looks like an email address is dropped, every value
 * is cut to ATTRIBUTION_FIELD_MAX characters, and an internal referrer (this site) is not a source.
 *
 * Every page loads this (AttributionCapture in the root layout, with a dynamic import just after the
 * page: it is in no page's first load), so it is small and pure: no React,
 * no Supabase, no network. Storage and the page are passed in, so the tests drive it without a
 * browser. Nothing here throws: a blocked localStorage means no attribution, never a broken page.
 */
import { isKidEmail } from "@/lib/family/contracts";
import type { Attribution } from "./contracts";

/** The device's copy (localStorage). */
export const ATTRIBUTION_STORAGE_KEY = "agathon.attribution";

/** Each value at most this long (the profile's whole object is capped at 2,000 bytes). */
export const ATTRIBUTION_FIELD_MAX = 200;

/**
 * An account made more than this long before the device first saw anyone did not come from this
 * visit: an older account signing in on a new device. Its attribution is not saved (it would date
 * the account's arrival to today).
 *
 * On the device someone signs up on, the first visit is captured before the form can be sent, so
 * the account is never older than the visit but for the device's clock running ahead of the
 * server's: this is that allowance, nothing more. A wider one (it was an hour until 2026-10-08)
 * took a second device, the phone where the sign-up email's link was opened minutes later, for the
 * sign-up visit; its attribution was saved first and `save_attribution`'s first-one-wins then
 * refused the real one from the device the visitor arrived on.
 */
export const SIGNUP_SLACK_MS = 2 * 60_000;

/** The fields that say where a visitor came from; an attribution with none of them says nothing. */
const SOURCE_FIELDS = ["utmSource", "utmMedium", "utmCampaign", "utmContent", "referrer", "ref"] as const;

/** Whether an attribution says where the visitor came from: a utm_* value, another site, or a ?ref= code. */
export function hasSource(attribution: Attribution): boolean {
  return SOURCE_FIELDS.some((f) => typeof attribution[f] === "string" && attribution[f] !== "");
}

/** What the device keeps: the attribution, and when it was saved to an account (or found not to belong to one). */
export interface StoredAttribution {
  attribution: Attribution;
  /** ISO; set once save_attribution answered, or the signed-in account was found older than the visit */
  sentAt?: string;
}

/** The little of Storage this needs (localStorage, or a fake in tests). */
export type AttributionStorage = Pick<Storage, "getItem" | "setItem">;

/** Where the visitor is now: `location.href` and `document.referrer`. */
export interface PageInfo {
  href: string;
  referrer: string;
}

/** The signed-in account, as Supabase's user has it. */
export interface AttributionUser {
  id: string;
  email?: string | null;
  /** ISO, when the account was made */
  created_at?: string | null;
}

const UTM_FIELDS = [
  ["utm_source", "utmSource"],
  ["utm_medium", "utmMedium"],
  ["utm_campaign", "utmCampaign"],
  ["utm_content", "utmContent"],
] as const;

/** A value worth keeping: trimmed, no control characters, not an email address, cut to the cap. */
function clean(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!v || v.includes("@")) return undefined;
  return v.slice(0, ATTRIBUTION_FIELD_MAX);
}

/**
 * The attribution of the page the visitor is on: utm_* and ?ref= from the address, its path
 * without the query, and the referrer's origin when it is another site. Never throws.
 */
export function attributionFromPage(page: PageInfo, now: Date): Attribution {
  const out: Attribution = { firstSeenAt: now.toISOString() };
  let url: URL | null = null;
  try {
    url = new URL(page.href);
  } catch {
    url = null;
  }
  if (url) {
    for (const [param, field] of UTM_FIELDS) {
      const v = clean(url.searchParams.get(param));
      if (v) out[field] = v;
    }
    const ref = clean(url.searchParams.get("ref"));
    if (ref) out.ref = ref;
    const path = clean(url.pathname);
    if (path) out.landingPath = path;
  }
  if (page.referrer) {
    try {
      const from = new URL(page.referrer);
      const internal = url !== null && from.origin === url.origin;
      if (!internal && (from.protocol === "https:" || from.protocol === "http:")) out.referrer = from.origin.slice(0, ATTRIBUTION_FIELD_MAX);
    } catch {
      // not a URL: no referrer
    }
  }
  return out;
}

/** The device's stored attribution, or null (none, unreadable, or not ours). Never throws. */
export function readStoredAttribution(storage: AttributionStorage | null): StoredAttribution | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(ATTRIBUTION_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const { attribution, sentAt } = parsed as { attribution?: unknown; sentAt?: unknown };
    if (!attribution || typeof attribution !== "object") return null;
    const a = attribution as Record<string, unknown>;
    if (typeof a.firstSeenAt !== "string" || Number.isNaN(Date.parse(a.firstSeenAt))) return null;
    const kept: Attribution = { firstSeenAt: a.firstSeenAt };
    for (const key of ["utmSource", "utmMedium", "utmCampaign", "utmContent", "referrer", "landingPath", "ref"] as const) {
      const v = clean(typeof a[key] === "string" ? (a[key] as string) : undefined);
      if (v) kept[key] = v;
    }
    return { attribution: kept, ...(typeof sentAt === "string" ? { sentAt } : {}) };
  } catch {
    return null;
  }
}

function write(storage: AttributionStorage, stored: StoredAttribution): void {
  try {
    storage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // full or blocked: nothing kept, nothing broken
  }
}

/**
 * The first visit's attribution: stored now if the device has none, never overwriting one already
 * there (a later visit from another link is not where the visitor first came from). One exception:
 * a friend's `?ref=` seen on a later visit, before any account has been saved from this device and
 * when the first visit had none, is added (src/lib/referral: the invitation still counts if the
 * visitor looked around first). Answers what the device keeps. Never throws.
 */
export function captureAttribution(storage: AttributionStorage | null, page: PageInfo, now: Date): StoredAttribution | null {
  if (!storage) return null;
  const existing = readStoredAttribution(storage);
  if (existing && !existing.sentAt && !existing.attribution.ref) {
    const ref = attributionFromPage(page, now).ref;
    if (ref) {
      const invited: StoredAttribution = { ...existing, attribution: { ...existing.attribution, ref } };
      write(storage, invited);
      return invited;
    }
  }
  if (existing) return existing;
  const fresh: StoredAttribution = { attribution: attributionFromPage(page, now) };
  write(storage, fresh);
  return fresh;
}

export type AttributionDecision =
  /** save this to the signed-in account */
  | { kind: "send"; attribution: Attribution }
  /** this account did not come from this visit: mark it done without saving */
  | { kind: "skip" }
  /** nothing to do (no attribution, already sent, a kid profile, or one that says nothing) */
  | { kind: "none" };

/**
 * Whether to save the device's attribution for `user`. Not for a kid profile (its grown-up's visit
 * is the family's arrival; the funnel leaves kids out), not twice, and not for an account made
 * before the device first saw anyone (an old account on a new device: `skip`, so it is not asked
 * again). Never one that says nothing (no utm_*, no referrer, no ?ref=: a typed address, or the
 * sign-up email opened in another browser): the profile keeps only the first attribution it gets,
 * and an empty one would shut out the real one from the device the visitor arrived on.
 */
export function attributionDecision(stored: StoredAttribution | null, user: AttributionUser | null): AttributionDecision {
  if (!stored || stored.sentAt || !user?.id) return { kind: "none" };
  if (isKidEmail(user.email)) return { kind: "none" };
  const created = user.created_at ? Date.parse(user.created_at) : NaN;
  const firstSeen = Date.parse(stored.attribution.firstSeenAt);
  if (Number.isFinite(created) && Number.isFinite(firstSeen) && created < firstSeen - SIGNUP_SLACK_MS) return { kind: "skip" };
  if (!hasSource(stored.attribution)) return { kind: "none" };
  return { kind: "send", attribution: stored.attribution };
}

/** Remember that the attribution was saved (or did not belong to the account), so it is never sent again. */
export function markAttributionSent(storage: AttributionStorage | null, now: Date): void {
  if (!storage) return;
  const stored = readStoredAttribution(storage);
  if (!stored || stored.sentAt) return;
  write(storage, { ...stored, sentAt: now.toISOString() });
}

/** localStorage, or null where it cannot be used (server, private mode, blocked). */
export function browserStorage(): AttributionStorage | null {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}
