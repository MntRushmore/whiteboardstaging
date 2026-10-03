/**
 * Who a billing email goes to. The person who PAYS for Agathon Unlimited is often not the account's
 * owner: a parent's card on a child's account, where the account's email may be the child's (or a
 * school address nobody reads). Stripe knows the payer's email from the checkout
 * (`customer_details.email`); the webhook stores it on the subscription row
 * (`unlimited_subscriptions.payer_email`, 20261003040000_go_live_gaps.sql). The plan's emails (the
 * free week started, the free week ending) go there, and fall back to the account's address only
 * when the row has none (a subscription linked before payer_email existed, or a checkout without
 * an email).
 */
import type { EmailDeps } from "@/lib/email/server";
import { isSendableAddress } from "@/lib/email/resend";

export type BillingRecipient =
  /** where to send, and whether it is the payer's (checkout) or the account's address */
  | { email: string; source: "payer" | "account" }
  /** neither the row nor the account has a usable address */
  | { email: null }
  | { error: string };

/** The payer's email when it is one usable address, else the account's (looked up), else none. */
export async function billingRecipient(row: { payerEmail: string | null; userId: string }, emailOf: EmailDeps["emailOf"]): Promise<BillingRecipient> {
  const payer = row.payerEmail?.trim() ?? "";
  if (payer && isSendableAddress(payer)) return { email: payer, source: "payer" };
  const who = await emailOf(row.userId);
  if ("error" in who) return who;
  const account = who.email?.trim() ?? "";
  return account && isSendableAddress(account) ? { email: account, source: "account" } : { email: null };
}
