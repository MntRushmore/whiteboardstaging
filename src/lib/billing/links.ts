import { parseBillingLinks, type BillingLinks } from "@/lib/billing/viewModel";

/**
 * Checkout / portal links for the plans grid, from NEXT_PUBLIC_BILLING_LINKS
 * (`{"plus":"https://…","pro":"https://…","portal":"https://…"}`). The literal
 * `process.env.NEXT_PUBLIC_BILLING_LINKS` is inlined by Next at build time, so
 * this must stay a direct reference. Absent or malformed -> `{}` and the UI
 * shows disabled "Coming soon" buttons.
 */
export function billingLinks(): BillingLinks {
  return parseBillingLinks(process.env.NEXT_PUBLIC_BILLING_LINKS);
}
