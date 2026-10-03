import type { Metadata } from "next";
import Link from "next/link";
import { ContactBlock, ContactEmail, LegalPage, LegalSection } from "@/components/legal/LegalPage";
import styles from "@/components/legal/legal.module.css";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Refund Policy",
  description: "How refunds work for Agathon ink packs.",
};

const days = LEGAL.refundWindowDays;
const ink = (n: number) => n.toLocaleString("en-US");

/** The worked example: the middle pack with a fifth of it used. */
const example = LEGAL.inkPacks[1];
const exampleUsed = example.ink / 5;
const exampleRefund = (example.priceUsd * (example.ink - exampleUsed)) / example.ink;

// DRAFT for the owner and counsel to review (src/lib/legal.ts): the refund rule itself is a
// proposal the owner has to confirm. Static: no request data.
export default function RefundsPage() {
  return (
    <LegalPage
      title="Refund Policy"
      summary={
        <ul>
          <li>Unused ink from a pack can be refunded within {days} days of buying it. Just ask.</li>
          <li>Ink you have already used is not refundable.</li>
          <li>The refund is the pack’s price times the share of its ink you have not used.</li>
        </ul>
      }
    >
      <LegalSection id="rule" title="What can be refunded">
        <p>
          Ink packs are one-time purchases ({LEGAL.inkPacks.map((p) => `${ink(p.ink)} ink for $${p.priceUsd}`).join(", ")}
          ). Within <strong>{days} days</strong> of buying a pack you can ask for a refund of the ink from that pack you
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

      <LegalSection id="not" title="What is not refundable">
        <ul>
          <li>Ink you have used.</li>
          <li>Packs bought more than {days} days ago, unless something below applies.</li>
          <li>Free starter ink or other free ink: it has no cash value.</li>
        </ul>
      </LegalSection>

      <LegalSection id="mistakes" title="When something went wrong">
        <p>
          If you were charged twice, were charged and never got the ink, or a fault on our side used up your ink, tell us
          at any time and we will put it right or refund you in full.
        </p>
      </LegalSection>

      <LegalSection id="how" title="How to ask">
        <ol>
          <li>
            Email <ContactEmail /> from your account’s email address, with the date of the purchase (your Stripe
            receipt is enough). A parent can ask for a child’s account.
          </li>
          <li>We reply within a few working days and refund through Stripe to the card you paid with.</li>
          <li>Your bank usually shows the refund within 5 to 10 working days.</li>
        </ol>
        <p>
          Your payment, receipt and card statement show the seller name “{LEGAL.stripeSellerName}”. Please ask
          us before disputing a charge with your bank: it is usually quicker.
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
