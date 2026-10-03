import { parseBillingLinks, type BillingLinks } from "@/lib/billing/checkout";

/**
 * The ink packs' Payment Links, from NEXT_PUBLIC_BILLING_LINKS
 * (`{"small":"https://…","medium":"https://…","large":"https://…"}`, printed by
 * scripts/stripe-setup.mjs). The literal `process.env.NEXT_PUBLIC_BILLING_LINKS` is inlined by
 * Next at build time, so this must stay a direct reference. Absent or malformed -> `{}` and every
 * buy button shows a disabled "Coming soon".
 */
export function billingLinks(): BillingLinks {
  return parseBillingLinks(process.env.NEXT_PUBLIC_BILLING_LINKS);
}
