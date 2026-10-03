/**
 * Everything the legal pages (/terms, /privacy, /refunds) say about who runs Agathon, in one place.
 *
 * DRAFTS: the pages were written for the owner to review with a lawyer, not as final terms. Every
 * value in [square brackets] is a placeholder the owner must fill in; until all are filled and
 * `reviewed` is true, each page shows a "Draft" notice (`isDraft`). Never put a made-up company,
 * address or someone's personal email here.
 */
export const LEGAL = {
  /** The legal entity (or person) that operates Agathon and is the party to the terms. */
  operatorName: "[Legal entity name]",
  /** A postal address for notices; COPPA requires one in the children's section. */
  postalAddress: "[Postal address]",
  /** Where users, parents and refund requests write to. */
  contactEmail: "[Contact email]",
  /** COPPA asks for a telephone number in the notice to parents. */
  contactPhone: "[Contact phone number]",
  /** e.g. "the State of California, USA". */
  governingLaw: "[Governing law: state and country]",
  /** e.g. "the state and federal courts in San Francisco County, California". */
  disputeVenue: "[Courts for disputes]",
  /** When these versions take effect. */
  effectiveDate: "[Effective date]",
  /**
   * What the AI services may do with what we send them, as one sentence in the Privacy Policy
   * ("AI and your boards"). True because every request says so and is refused where it cannot be
   * honoured: OpenRouter requests carry `provider: { data_collection: "deny", zdr: true }`
   * (PROVIDER_PRIVACY in src/lib/server/openrouter.ts: only endpoints that neither train on nor
   * keep prompts may answer; one without is a 404, never a fallback) and Mathpix requests carry
   * `metadata: { improve_mathpix: false }` (src/lib/server/mathpix.ts: no image data or result is
   * persisted). It also depends on OpenRouter's own prompt logging staying off in the account's
   * privacy settings (the go-live checklist, docs/RUNBOOK-billing.md). legalPages.test.tsx pins
   * the two flags to this sentence.
   */
  aiProviderTraining: "We ask every AI service we use not to keep or train on what we send, and we only use providers that agree.",
  /** Set to true once counsel has reviewed the pages and the placeholders above are filled. */
  reviewed: false,

  // Facts, not placeholders (from the product; change them with the product).
  productName: "Agathon",
  siteHost: "whiteboard.rushilchopra.com",
  /** The seller name Stripe shows at checkout, on receipts and on card statements. */
  stripeSellerName: "Fuime",
  /** Unused ink from a pack can be refunded within this many days of buying it. */
  refundWindowDays: 14,
  /** Ink packs: one-time purchases (USD). Kept equal to the packs on sale. */
  inkPacks: [
    { ink: 1_000, priceUsd: 5 },
    { ink: 5_000, priceUsd: 20 },
    { ink: 14_000, priceUsd: 50 },
  ],
  /**
   * Agathon Unlimited, beyond its price and free week (those are UNLIMITED_PLAN in
   * src/lib/billing/unlimited.ts, which the pages read directly).
   */
  unlimited: {
    /** AI actions per rolling 24 hours: unlimited_fair_use_per_day() in 20261003020000_unlimited.sql (legal.test.ts pins the two). */
    fairUseActionsPerDay: 1_500,
    /** A charge the subscriber did not mean to keep is refunded in full when asked within this many days (owner's policy). */
    refundWindowDays: 7,
    /** A new price reaches a current subscriber only after an email at least this many days ahead (owner's policy). */
    priceChangeNoticeDays: 7,
  },
} as const;

/**
 * The version of what sign-up asks a new account to agree to: the Terms, the Privacy Policy, and
 * "I'm 13 or older, or I'm a parent or guardian setting this up for my child". The database
 * stores it on the profile (`terms_version`, with `accepted_terms_at`) at sign-up. A date, so a
 * profile reads "agreed to the 2026-10-04 text"; change it when that text changes in a way that
 * matters, together with LEGAL_LAST_UPDATED (src/components/legal/LegalPage.tsx) and the copy in
 * scripts/lib/supabaseHttp.mjs.
 *
 * The date must not be later than tomorrow (UTC) when the code goes live: the database refuses a
 * sign-up whose version is in the future (signup_terms_version() in
 * 20261003010000_signup_consent.sql), so a version dated next week would stop every sign-up.
 *
 * History: 2026-10-03, the first text (live with sign-up consent on 2026-10-03); 2026-10-04,
 * Agathon Unlimited, the emails, and the AI services named.
 */
export const TERMS_VERSION = "2026-10-04";

/** True for a value still in [square brackets]. */
export function isPlaceholder(value: string): boolean {
  return /^\[.*\]$/.test(value.trim());
}

/** The placeholder fields still to fill. */
export function unfilledLegalFields(legal: Readonly<Record<string, unknown>> = LEGAL): string[] {
  return Object.entries(legal)
    .filter(([, v]) => typeof v === "string" && isPlaceholder(v))
    .map(([k]) => k);
}

/** Whether the pages still show the "Draft" notice. */
export function isDraft(legal: Readonly<Record<string, unknown> & { reviewed: boolean }> = LEGAL): boolean {
  return !legal.reviewed || unfilledLegalFields(legal).length > 0;
}

export const LEGAL_LINKS = [
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
  { href: "/refunds", label: "Refunds" },
] as const;
