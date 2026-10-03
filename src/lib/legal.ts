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
  /** Set to true once counsel has reviewed the pages and the placeholders above are filled. */
  reviewed: false,

  // Facts, not placeholders (from the product; change them with the product).
  productName: "Agathon",
  siteHost: "whiteboard.rushilchopra.com",
  /** The seller name Stripe shows at checkout, on receipts and on card statements. */
  stripeSellerName: "Fuime",
  refundWindowDays: 14,
  /** Ink packs: one-time purchases (USD). Kept equal to the packs on sale. */
  inkPacks: [
    { ink: 1_000, priceUsd: 5 },
    { ink: 5_000, priceUsd: 20 },
    { ink: 14_000, priceUsd: 50 },
  ],
} as const;

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
