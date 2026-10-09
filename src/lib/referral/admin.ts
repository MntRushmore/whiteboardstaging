/**
 * The admin console's Referrals page, as data: the route's shapes (GET /api/admin/referrals, PATCH
 * /api/admin/referrals/<id>), admin_referrals()'s answer (supabase/migrations/20261009110000_referrals.sql)
 * turned into them, and the page's view: the tiles, the filters, one row per referral with its
 * words, tones and the buttons it may show.
 *
 * Why a page at all: the referrer's free month is a Stripe credit only the owner can apply (the app
 * has no Stripe secret key), so the console lists who is due one, says how to give it, and records
 * that it was given. "Void" is for abuse; the page flags a friend whose address looks like the
 * referrer's own so it is checked before anyone is credited.
 *
 * Pure (zod only): no React, no network, no browser API at module scope.
 */
import { z } from "zod";
import { CONSOLE_COPY, exactTime, formatDay, type Tone } from "@/lib/admin/consoleView";
import type { ViewClock } from "@/lib/admin/view";
import { REFERRAL_STATUSES, isReferralCode, type ReferralStatus } from "./contracts";
import { REFERRAL_ADMIN_COPY } from "./copy";

/** The page and its routes. */
export const REFERRAL_PATHS = {
  page: "/admin/referrals",
  api: "/api/admin/referrals",
  one: (id: number) => `/api/admin/referrals/${id}`,
} as const;

/** The two things an admin may do to a referral. */
export const REFERRAL_MARKS = ["rewarded", "void"] as const;
export type ReferralMark = (typeof REFERRAL_MARKS)[number];

/** PATCH /api/admin/referrals/<id> */
export const ReferralMarkSchema = z.object({ status: z.enum(REFERRAL_MARKS) }).strict();

// ------------------------------------------------------------------ admin_referrals()'s answer

const iso = z.string().refine((v) => Number.isFinite(Date.parse(v)), "a time");
const statusSchema = z.enum(REFERRAL_STATUSES);
const n = z.number().int().nonnegative();
/** How many referrals are in each status (every row, not only those listed). */
const CountsSchema = z.object({ signed_up: n, trialing: n, paid: n, rewarded: n, void: n });

const RpcPartySchema = z.object({
  id: z.string().uuid(),
  email: z.string().nullable(),
  created_at: iso.nullable(),
  payer_email: z.string().nullable(),
});

/** One referral as referral_entry() answers it. */
export const ReferralRpcEntrySchema = z.object({
  id: z.number().int().positive(),
  code: z.string().refine(isReferralCode, "a referral code"),
  status: statusSchema,
  created_at: iso,
  paid_at: iso.nullable(),
  rewarded_at: iso.nullable(),
  updated_at: iso,
  rewarded_by_email: z.string().nullable(),
  referrer: RpcPartySchema.extend({ customer_id: z.string().nullable() }),
  referred: RpcPartySchema.extend({ plan_status: z.string().nullable() }),
});
export type ReferralRpcEntry = z.infer<typeof ReferralRpcEntrySchema>;

export const ReferralRpcListSchema = z.object({
  generated_at: iso,
  counts: CountsSchema,
  truncated: z.boolean(),
  referrals: z.array(ReferralRpcEntrySchema),
});

// ------------------------------------------------------------------ the route's answer

const PartySchema = z.object({
  id: z.string(),
  email: z.string().nullable(),
  createdAt: iso.nullable(),
  /** the email the Stripe checkout was paid with (known only after a checkout) */
  payerEmail: z.string().nullable(),
});

export const AdminReferralSchema = z.object({
  id: z.number().int().positive(),
  code: z.string(),
  status: statusSchema,
  createdAt: iso,
  paidAt: iso.nullable(),
  rewardedAt: iso.nullable(),
  updatedAt: iso,
  rewardedByEmail: z.string().nullable(),
  /** customerId: the referrer's Stripe customer, where the credit goes */
  referrer: PartySchema.extend({ customerId: z.string().nullable() }),
  /** planStatus: the friend's latest subscription status as Stripe has it */
  referred: PartySchema.extend({ planStatus: z.string().nullable() }),
});
export type AdminReferral = z.infer<typeof AdminReferralSchema>;

export const AdminReferralListSchema = z.object({
  generatedAt: iso,
  counts: CountsSchema,
  truncated: z.boolean(),
  referrals: z.array(AdminReferralSchema),
});
export type AdminReferralList = z.infer<typeof AdminReferralListSchema>;

/** One RPC entry in the route's shape. */
export function toAdminReferral(e: ReferralRpcEntry): AdminReferral {
  return {
    id: e.id,
    code: e.code,
    status: e.status,
    createdAt: e.created_at,
    paidAt: e.paid_at,
    rewardedAt: e.rewarded_at,
    updatedAt: e.updated_at,
    rewardedByEmail: e.rewarded_by_email,
    referrer: { id: e.referrer.id, email: e.referrer.email, createdAt: e.referrer.created_at, payerEmail: e.referrer.payer_email, customerId: e.referrer.customer_id },
    referred: { id: e.referred.id, email: e.referred.email, createdAt: e.referred.created_at, payerEmail: e.referred.payer_email, planStatus: e.referred.plan_status },
  };
}

/** The whole RPC answer in the route's shape. */
export function toAdminReferralList(raw: z.infer<typeof ReferralRpcListSchema>): AdminReferralList {
  return { generatedAt: raw.generated_at, counts: raw.counts, truncated: raw.truncated, referrals: raw.referrals.map(toAdminReferral) };
}

// ------------------------------------------------------------------ abuse: the same person twice

/**
 * An address as a mailbox: lower case, a `+tag` dropped, and for Gmail the dots too (Gmail ignores
 * them), so `Jo.Smith+kids@gmail.com` and `josmith@googlemail.com` are one person. Null for no
 * address.
 */
export function mailboxOf(email: string | null | undefined): string | null {
  if (typeof email !== "string") return null;
  const at = email.trim().toLowerCase().lastIndexOf("@");
  if (at <= 0) return null;
  const lower = email.trim().toLowerCase();
  let local = lower.slice(0, at).replace(/\+.*$/, "");
  let domain = lower.slice(at + 1);
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") local = local.replace(/\./g, "");
  return local ? `${local}@${domain}` : null;
}

/** Whether any of the referrer's addresses (account, payer) is one of the friend's, as mailboxes. */
export function looksLikeSamePerson(r: Pick<AdminReferral, "referrer" | "referred">): boolean {
  const mine = new Set([mailboxOf(r.referrer.email), mailboxOf(r.referrer.payerEmail)].filter((m): m is string => m !== null));
  return [mailboxOf(r.referred.email), mailboxOf(r.referred.payerEmail)].some((m) => m !== null && mine.has(m));
}

// ------------------------------------------------------------------ the page's view

export const REFERRAL_FILTERS = ["due", "trial", "rewarded", "void", "all"] as const;
export type ReferralFilter = (typeof REFERRAL_FILTERS)[number];

const FILTER_STATUSES: Record<Exclude<ReferralFilter, "all">, readonly ReferralStatus[]> = {
  due: ["paid"],
  trial: ["signed_up", "trialing"],
  rewarded: ["rewarded"],
  void: ["void"],
};

export const REFERRAL_TONES: Record<ReferralStatus, Tone> = {
  signed_up: "neutral",
  trialing: "info",
  paid: "warn",
  rewarded: "success",
  void: "muted",
};

/** Whether the admin may make this move (the database checks it again). */
export function canMark(status: ReferralStatus, mark: ReferralMark): boolean {
  return mark === "rewarded" ? status === "paid" : status === "signed_up" || status === "trialing" || status === "paid";
}

/** The page opens on what needs doing: the rewards due when there are some, else everything. */
export function defaultReferralFilter(counts: Record<ReferralStatus, number>): ReferralFilter {
  return counts.paid > 0 ? "due" : "all";
}

export interface ReferralTileView {
  key: string;
  value: string;
  label: string;
  hint: string;
  urgent: boolean;
}

export interface ReferralPartyView {
  email: string;
  /** "Paid as …" when the checkout's email is another address; null otherwise */
  payer: string | null;
}

export interface ReferralRowView {
  id: number;
  code: string;
  status: ReferralStatus;
  statusLabel: string;
  statusTone: Tone;
  referrer: ReferralPartyView & { customerId: string | null };
  friend: ReferralPartyView;
  joined: string;
  joinedTitle: string;
  paid: string;
  paidTitle: string;
  /** "Rewarded Oct 9 by admin@…" once rewarded */
  rewarded: string | null;
  samePerson: boolean;
  canReward: boolean;
  canVoid: boolean;
}

export interface ReferralsView {
  tiles: ReferralTileView[];
  filters: { key: ReferralFilter; label: string; count: string; urgent: boolean }[];
  rows: ReferralRowView[];
  /** nothing at all yet */
  empty: boolean;
  truncatedNote: string | null;
}

function party(email: string | null, payerEmail: string | null): ReferralPartyView {
  const shown = email ?? REFERRAL_ADMIN_COPY.noEmail;
  const payer = payerEmail && mailboxOf(payerEmail) !== mailboxOf(email) ? REFERRAL_ADMIN_COPY.payer(payerEmail) : null;
  return { email: shown, payer };
}

/** One referral's row. */
export function referralRow(r: AdminReferral, clock: ViewClock): ReferralRowView {
  const rewardedWhen = r.rewardedAt ? formatDay(r.rewardedAt, clock) : null;
  return {
    id: r.id,
    code: r.code,
    status: r.status,
    statusLabel: REFERRAL_ADMIN_COPY.statuses[r.status],
    statusTone: REFERRAL_TONES[r.status],
    referrer: { ...party(r.referrer.email, r.referrer.payerEmail), customerId: r.referrer.customerId },
    friend: party(r.referred.email, r.referred.payerEmail),
    joined: formatDay(r.createdAt, clock),
    joinedTitle: exactTime(r.createdAt, clock),
    paid: r.paidAt ? formatDay(r.paidAt, clock) : "—",
    paidTitle: r.paidAt ? exactTime(r.paidAt, clock) : "",
    rewarded: rewardedWhen ? (r.rewardedByEmail ? REFERRAL_ADMIN_COPY.rewardedBy(r.rewardedByEmail, rewardedWhen) : REFERRAL_ADMIN_COPY.rewardedWhen(rewardedWhen)) : null,
    samePerson: looksLikeSamePerson(r),
    canReward: canMark(r.status, "rewarded"),
    canVoid: canMark(r.status, "void"),
  };
}

const count = (n: number) => (n > 999 ? "999+" : String(n));

/** Counts per status from the list itself (after a change made here, before the next read). */
export function countsOf(referrals: readonly Pick<AdminReferral, "status">[]): Record<ReferralStatus, number> {
  const out = Object.fromEntries(REFERRAL_STATUSES.map((s) => [s, 0])) as Record<ReferralStatus, number>;
  for (const r of referrals) out[r.status] += 1;
  return out;
}

/** The page: tiles, the filter row with counts, and the rows the filter keeps (newest first). */
export function buildReferralsView(list: AdminReferralList, filter: ReferralFilter, clock: ViewClock): ReferralsView {
  // the server's counts cover every row; the list's own follow a change made on this page
  const counts = list.truncated ? list.counts : countsOf(list.referrals);
  const t = REFERRAL_ADMIN_COPY.tiles;
  const notVoid = counts.signed_up + counts.trialing + counts.paid + counts.rewarded;
  const tiles: ReferralTileView[] = [
    { key: "due", value: count(counts.paid), label: t.due, hint: t.dueHint, urgent: counts.paid > 0 },
    { key: "trialing", value: count(counts.trialing), label: t.trialing, hint: t.trialingHint, urgent: false },
    { key: "rewarded", value: count(counts.rewarded), label: t.rewarded, hint: t.rewardedHint, urgent: false },
    { key: "signed_up", value: count(notVoid), label: t.signedUp, hint: t.signedUpHint, urgent: false },
  ];
  const inFilter = (f: ReferralFilter) => (f === "all" ? notVoid + counts.void : FILTER_STATUSES[f].reduce((sum, s) => sum + counts[s], 0));
  const filters = REFERRAL_FILTERS.map((key) => ({ key, label: REFERRAL_ADMIN_COPY.filters[key], count: count(inFilter(key)), urgent: key === "due" && counts.paid > 0 }));
  const keep = filter === "all" ? null : new Set<ReferralStatus>(FILTER_STATUSES[filter]);
  const rows = list.referrals.filter((r) => !keep || keep.has(r.status)).map((r) => referralRow(r, clock));
  return {
    tiles,
    filters,
    rows,
    empty: list.referrals.length === 0,
    truncatedNote: list.truncated ? REFERRAL_ADMIN_COPY.truncated(list.referrals.length) : null,
  };
}

/** The referral after a mark, as the page shows it at once (then the server's own copy). */
export function applyReferralMark(r: AdminReferral, mark: ReferralMark, nowIso: string, adminEmail: string | null): AdminReferral {
  if (!canMark(r.status, mark)) return r;
  return mark === "rewarded"
    ? { ...r, status: "rewarded", rewardedAt: nowIso, rewardedByEmail: adminEmail, updatedAt: nowIso }
    : { ...r, status: "void", updatedAt: nowIso };
}

/** "jo@example.com" for the confirm dialog; the console's "no email" for a deleted account. */
export function referrerName(r: Pick<AdminReferral, "referrer">): string {
  return r.referrer.email ?? CONSOLE_COPY.noEmail;
}
