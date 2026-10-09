/**
 * Everything the legal pages (/terms, /privacy, /refunds) say about who runs Agathon, in one place.
 *
 * Published as final by the owner on 2026-10-03 (see `reviewed`). Any value in [square brackets]
 * is a placeholder; while one is left or `reviewed` is false, each page shows a "Draft" notice
 * (`isDraft`). Never put a made-up company, address or someone's personal email here.
 */
export const LEGAL = {
  /** The legal entity (or person) that operates Agathon and is the party to the terms. */
  operatorName: "Ninth Street Labs",
  /** A postal address for notices; COPPA requires one in the children's section. */
  postalAddress: "2099 Pacific Blvd, San Mateo, CA",
  /** Where users, parents and refund requests write to. */
  contactEmail: "rushil@ninthstreetlabs.com",
  /** COPPA asks for a telephone number in the notice to parents. Optional: empty shows no phone line (none given yet). */
  contactPhone: "",
  /** e.g. "the State of California, USA". */
  governingLaw: "the State of California, USA",
  /** e.g. "the state and federal courts in San Francisco County, California". */
  disputeVenue: "the state and federal courts located in San Mateo County, California",
  /** When these versions take effect. */
  effectiveDate: "October 4, 2026",
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
  /**
   * True once the pages are published as final: the owner published them on 2026-10-03 (effective
   * 2026-10-04) for the first paying users, before a lawyer's review — when counsel reviews them,
   * any change is an ordinary Terms update (a new TERMS_VERSION). Placeholders above still make
   * them a draft whatever this says.
   */
  reviewed: true,

  // Facts, not placeholders (from the product; change them with the product).
  productName: "Agathon",
  siteHost: "whiteboard.rushilchopra.com",
  /** The seller name Stripe shows at checkout and on receipts (the Stripe account is shared with Fuime). */
  stripeSellerName: "Fuime",
  /**
   * What a card statement shows. Ink packs: the account's prefix (FUIME) and the Payment Links'
   * `statement_descriptor_suffix`; Agathon Unlimited: the product's own `statement_descriptor`
   * (subscription charges take no suffix). Both set by scripts/stripe-setup.mjs (legal.test.ts pins
   * them to it); the Unlimited one was checked on a real test-mode charge on 2026-10-03.
   */
  statementDescriptors: { inkPacks: "FUIME* AGATHON", unlimited: "AGATHON" },
  /** Unused ink from a pack can be refunded within this many days of buying it. */
  refundWindowDays: 14,
  /** Ink packs: one-time purchases (USD), no longer sold from 2026-10-05; kept for the refund rules of packs bought before. */
  inkPacks: [
    { ink: 1_000, priceUsd: 5 },
    { ink: 5_000, priceUsd: 20 },
    { ink: 14_000, priceUsd: 50 },
  ],
  /**
   * Agathon Unlimited, beyond its price and free trial (those are UNLIMITED_PLAN in
   * src/lib/billing/unlimited.ts, which the pages read directly).
   */
  unlimited: {
    /** AI actions per rolling 24 hours: unlimited_fair_use_per_day() in 20261003020000_unlimited.sql (legal.test.ts pins the two). */
    fairUseActionsPerDay: 1_500,
    /** A charge the subscriber did not mean to keep is refunded in full when asked within this many days (owner's policy, 2026-10-03: 14). */
    refundWindowDays: 14,
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
 * Agathon Unlimited, the emails, and the AI services named; 2026-10-05, no free plan (the app needs
 * Agathon Unlimited after the guided first board) and ink packs no longer sold; 2026-10-06, "free
 * week" became "free trial" (the trial was 3 days for a few hours that day, then 7 again: the text
 * now says the trial is the length checkout showed; accepted_terms_at tells the two texts apart);
 * 2026-10-08, the Privacy Policy says our staff may look at a student's boards and bug reports to fix
 * problems and improve the tutor, that each look is logged (admin_audit, kept 180 days), and that
 * nothing they see is shared.
 */
export const TERMS_VERSION = "2026-10-08";

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
