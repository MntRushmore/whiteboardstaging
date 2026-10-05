import type { Metadata } from "next";
import Link from "next/link";
import { ContactBlock, ContactEmail, LegalPage, LegalSection } from "@/components/legal/LegalPage";
import styles from "@/components/legal/legal.module.css";
import { UNLIMITED_PLAN } from "@/lib/billing/unlimited";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Refund Policy",
  description: "How refunds work for Agathon Unlimited, and for Agathon ink packs bought before they were retired.",
};

const days = LEGAL.refundWindowDays;
const ink = (n: number) => n.toLocaleString("en-US");

/** The worked example: the middle pack with a fifth of it used. */
const example = LEGAL.inkPacks[1];
const exampleUsed = example.ink / 5;
const exampleRefund = (example.priceUsd * (example.ink - exampleUsed)) / example.ink;

const plan = UNLIMITED_PLAN.name;
const price = `$${UNLIMITED_PLAN.monthlyUsd}`;
const planDays = LEGAL.unlimited.refundWindowDays;

// DRAFT for the owner and counsel to review (src/lib/legal.ts): both refund rules are proposals the
// owner has to confirm. Refunds are made by hand in the Stripe Dashboard (docs/RUNBOOK-billing.md
// sections 5 and 10); a refunded plan is also cancelled there. Static: no request data.
export default function RefundsPage() {
  return (
    <LegalPage
      title="Refund Policy"
      summary={
        <ul>
          <li>
            {plan}: cancel during the free week and you are never charged. Charged {price} and did not mean to keep
            the plan? Ask within {planDays} days and we refund that charge.
          </li>
          <li>
            Ink packs are no longer sold. Unused ink from a pack bought before can be refunded within {days} days of
            buying it; ink you have already used is not refundable.
          </li>
          <li>If something went wrong on our side, we put it right or refund you in full, at any time.</li>
        </ul>
      }
    >
      <LegalSection id="subscriptions" title={`${plan} (subscription)`}>
        <ul>
          <li>
            <strong>The free week is free.</strong> Cancel before it ends and you are never charged. See{" "}
            <Link href="/terms#unlimited">how to cancel</Link>.
          </li>
          <li>
            <strong>Charged and did not mean to keep it?</strong> If you forgot to cancel, or a charge was a mistake, ask
            within <strong>{planDays} days</strong> of that charge (the first {price} after the free week, or any monthly
            renewal). We refund that charge in full and end the plan straight away.
          </li>
          <li>
            <strong>Otherwise, no refunds for part of a month.</strong> When you cancel, you are not charged again, and
            the plan stays on until the end of the month you have paid for.
          </li>
          <li>A refund for the plan never takes any ink from your account.</li>
        </ul>
      </LegalSection>

      <LegalSection id="rule" title="Ink packs: what can be refunded">
        <p>
          Ink packs were one-time purchases ({LEGAL.inkPacks.map((p) => `${ink(p.ink)} ink for $${p.priceUsd}`).join(", ")}
          ). They are no longer sold, from October 5, 2026; for a pack bought before then, within <strong>{days} days</strong> of buying a pack you can ask for a refund of the ink from that pack you
          have not used. Ink you have used is not refundable, because the AI work it paid for has been done.
        </p>
        <p>
          The refund is <strong>pro-rated by unused ink</strong>: the price you paid times the unused ink from that pack,
          divided by the ink in the pack.
        </p>
        <p className={styles.example}>
          Example: you buy {ink(example.ink)} ink for ${example.priceUsd} and use {ink(exampleUsed)}. Within {days} days
          you can get back ${exampleRefund.toFixed(2)} for the {ink(example.ink - exampleUsed)} unused ink, which is then
          taken off your balance.
        </p>
        <p>
          To work out which ink is unused, ink counts as spent in the order it reached your account: free starter ink
          first, then packs from oldest to newest.
        </p>
      </LegalSection>

      <LegalSection id="not" title="Ink that is not refundable">
        <ul>
          <li>Ink you have used.</li>
          <li>Packs bought more than {days} days ago, unless something below applies.</li>
          <li>Free starter ink or other free ink: it has no cash value.</li>
        </ul>
      </LegalSection>

      <LegalSection id="mistakes" title="When something went wrong">
        <p>
          If you were charged twice, were charged after you cancelled, were charged and never got the ink, or a fault on
          our side used up your ink, tell us at any time and we will put it right or refund you in full.
        </p>
      </LegalSection>

      <LegalSection id="how" title="How to ask">
        <ol>
          <li>
            Email <ContactEmail /> from your account’s email address (or, for {plan}, the email used at
            checkout), with the date of the charge. Your Stripe receipt is enough. A parent can ask for a child’s
            account.
          </li>
          <li>We reply within a few working days and refund through Stripe to the card you paid with.</li>
          <li>Your bank usually shows the refund within 5 to 10 working days.</li>
        </ol>
        <p>
          Your payment and receipt show the seller name “{LEGAL.stripeSellerName}”. On a card statement, an ink pack
          shows as “{LEGAL.statementDescriptors.inkPacks}” and {UNLIMITED_PLAN.name}{" "}
          as “{LEGAL.statementDescriptors.unlimited}”. Please ask us before disputing a charge with your bank: it is
          usually quicker.
        </p>
      </LegalSection>

      <LegalSection id="law" title="Your legal rights">
        <p>
          This policy does not take away any right to a refund you have under the law where you live. See also our{" "}
          <Link href="/terms">Terms of Service</Link>.
        </p>
      </LegalSection>

      <LegalSection id="contact" title="Contact">
        <ContactBlock />
      </LegalSection>
    </LegalPage>
  );
}
