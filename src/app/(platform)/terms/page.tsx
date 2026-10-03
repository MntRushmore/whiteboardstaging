import type { Metadata } from "next";
import Link from "next/link";
import { ContactBlock, ContactEmail, LegalPage, LegalSection } from "@/components/legal/LegalPage";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms for using Agathon, the AI math tutor on a whiteboard.",
};

const packs = LEGAL.inkPacks.map((p) => `${p.ink.toLocaleString("en-US")} ink for $${p.priceUsd}`).join(", ");

// DRAFT for the owner and counsel to review (src/lib/legal.ts). Static: no request data.
export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      summary={
        <ul>
          <li>Agathon is an AI maths tutor in beta. The AI can be wrong; check what matters.</li>
          <li>Children under 13 need a parent or guardian to set up and agree to their account.</li>
          <li>Your boards are yours. We use them only to run Agathon for you.</li>
          <li>Ink is bought in one-time packs, never expires and is spent on AI actions.</li>
          <li>
            Unused ink can be refunded within {LEGAL.refundWindowDays} days of purchase (see the{" "}
            <Link href="/refunds">Refund Policy</Link>).
          </li>
        </ul>
      }
    >
      <LegalSection id="who" title="Who we are">
        <p>
          {LEGAL.productName} (at {LEGAL.siteHost}) is run by {LEGAL.operatorName} (“we”, “us”).
          These terms are an agreement between you and us about using {LEGAL.productName}. By creating an account or
          using {LEGAL.productName} you agree to them, and to our <Link href="/privacy">Privacy Policy</Link> and{" "}
          <Link href="/refunds">Refund Policy</Link>.
        </p>
      </LegalSection>

      <LegalSection id="service" title="What Agathon is">
        <p>
          {LEGAL.productName} is a whiteboard where students write maths by hand and an AI tutor reads it, checks each
          step, and answers on the board. To do that, what you write and draw is sent to AI services that read
          handwriting and generate the tutor’s answers (the <Link href="/privacy#providers">Privacy Policy</Link>{" "}
          lists them).
        </p>
        <p>
          {LEGAL.productName} is in <strong>beta</strong>. Features can change, break or be removed, and the service may
          sometimes be unavailable. We will try to keep your boards safe, but please keep your own copy of anything you
          cannot afford to lose.
        </p>
      </LegalSection>

      <LegalSection id="ai" title="The AI can make mistakes">
        <p>
          The tutor’s checks, hints, worked solutions, graphs and drawings are produced by AI models and by
          automatic maths checking. They can be wrong, incomplete or misread your handwriting. {LEGAL.productName} is a
          study aid, not a replacement for a teacher, and its answers are not professional advice. Check anything that
          matters, and follow your school’s rules about homework help and academic honesty.
        </p>
      </LegalSection>

      <LegalSection id="accounts" title="Accounts, age and parents">
        <ul>
          <li>You need an account, with a working email address and a password you keep to yourself.</li>
          <li>
            <strong>Under 13:</strong> a parent or legal guardian must create the account, or give consent before the
            child uses it, and agrees to these terms for the child. See{" "}
            <Link href="/privacy#children">Children under 13</Link> in the Privacy Policy.
          </li>
          <li>
            <strong>Under 18</strong> (or the age of majority where you live): you may use {LEGAL.productName} with a
            parent’s or guardian’s permission. Purchases must be made, or approved, by a parent or guardian.
          </li>
          <li>One person per account. You are responsible for what happens under your account; tell us if you think
            someone else is using it.</li>
        </ul>
      </LegalSection>

      <LegalSection id="content" title="Your boards and content">
        <p>
          What you put on your boards (handwriting, drawings, typed text, images and PDFs) stays yours. You give us
          permission to store it, process it and send it to our service providers only as needed to run{" "}
          {LEGAL.productName} for you: saving your boards, reading your handwriting, and producing the tutor’s
          answers. This permission ends when you delete the content or your account, apart from copies that take time
          to expire (see the Privacy Policy).
        </p>
        <p>
          Only upload what you have the right to use. Do not put other people’s personal information, or anything
          illegal, hateful or harmful, on a board.
        </p>
      </LegalSection>

      <LegalSection id="use" title="Fair use">
        <p>You agree not to:</p>
        <ul>
          <li>break the law, or use {LEGAL.productName} to harass, harm or deceive anyone;</li>
          <li>try to get around ink, rate limits or security, or access other people’s accounts or boards;</li>
          <li>scrape, copy or resell the service, or access it with bots or scripts;</li>
          <li>try to make the AI produce harmful content, or overload or disrupt the service;</li>
          <li>reverse-engineer the service, except where the law allows it.</li>
        </ul>
        <p>We may limit, suspend or close an account that breaks these rules.</p>
      </LegalSection>

      <LegalSection id="ink" title="Ink and payments">
        <ul>
          <li>
            AI actions (reading handwriting, checking, hints, worked solutions, chat, lecture mode) use{" "}
            <strong>ink</strong>. Writing and drawing on your own costs nothing. The app shows how much ink an action
            uses; those amounts may change for future actions.
          </li>
          <li>
            Ink is sold in one-time packs: {packs} (US dollars, plus any tax that applies). Packs are not subscriptions
            and never renew.
          </li>
          <li>
            Payments are processed by Stripe. Checkout, your receipt and your card statement show the seller name{" "}
            <strong>“{LEGAL.stripeSellerName}”</strong>. We never see or store your full card number.
          </li>
          <li>
            <strong>Ink never expires.</strong> It has no cash value, cannot be transferred to another account, and can
            only be refunded as the <Link href="/refunds">Refund Policy</Link> says.
          </li>
          <li>New accounts may get some free starter ink. Free ink has no cash value and is not refundable.</li>
          <li>If we ever shut {LEGAL.productName} down, we will refund purchased ink you have not used.</li>
        </ul>
      </LegalSection>

      <LegalSection id="ending" title="Ending your account">
        <p>
          You can delete your account at any time from your Account page. Deleting it removes your boards and ink
          balance and cannot be undone; ask for a refund of unused ink first if you are within the refund window. We may
          suspend or close an account that breaks these terms; if we do, unused purchased ink is not refunded unless the
          law requires it.
        </p>
      </LegalSection>

      <LegalSection id="warranty" title="No warranty">
        <p>
          {LEGAL.productName} is provided “as is” and “as available”. To the extent the law
          allows, we make no promises that it will be accurate, uninterrupted or error-free, or fit for a particular
          purpose.
        </p>
      </LegalSection>

      <LegalSection id="liability" title="Limits on our liability">
        <p>
          To the extent the law allows, we are not liable for indirect, incidental or consequential losses (such as lost
          work, lost grades or lost data), and our total liability to you for any claim is limited to the amount you paid
          us in the 12 months before the claim. Some places do not allow these limits, so they may not all apply to you.
          Nothing in these terms takes away rights you have under consumer protection law.
        </p>
      </LegalSection>

      <LegalSection id="law" title="Governing law">
        <p>
          These terms are governed by the laws of {LEGAL.governingLaw}. Disputes go to {LEGAL.disputeVenue}, unless the
          law where you live gives you the right to bring them somewhere else.
        </p>
      </LegalSection>

      <LegalSection id="changes" title="Changes to these terms">
        <p>
          We may update these terms. For a change that matters, we will tell you by email or in the app before it takes
          effect. If you keep using {LEGAL.productName} after that, the new terms apply; if you do not agree, you can
          delete your account.
        </p>
      </LegalSection>

      <LegalSection id="contact" title="Contact">
        <p>
          Questions about these terms: <ContactEmail />.
        </p>
        <ContactBlock />
      </LegalSection>
    </LegalPage>
  );
}
