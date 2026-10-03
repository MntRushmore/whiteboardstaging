import type { Metadata } from "next";
import Link from "next/link";
import { ContactBlock, ContactEmail, LegalPage, LegalSection } from "@/components/legal/LegalPage";
import { UNLIMITED_PLAN } from "@/lib/billing/unlimited";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms for using Agathon, the AI math tutor on a whiteboard, including ink packs and Agathon Unlimited.",
};

const packs = LEGAL.inkPacks.map((p) => `${p.ink.toLocaleString("en-US")} ink for $${p.priceUsd}`).join(", ");

/** Agathon Unlimited as sold (src/lib/billing/unlimited.ts, scripts/stripe-setup.mjs). */
const plan = UNLIMITED_PLAN.name;
const price = `$${UNLIMITED_PLAN.monthlyUsd}`;
const trialDays = UNLIMITED_PLAN.trialDays;
const fairUse = LEGAL.unlimited.fairUseActionsPerDay.toLocaleString("en-US");

// DRAFT for the owner and counsel to review (src/lib/legal.ts). Static: no request data.
// Every statement about the plan is what the code does: the Payment Link (free week, card up front,
// monthly renewal), the customer portal (cancel at the period end), has_unlimited() (past_due spends
// ink), unlimited_fair_use_per_day(), delete_own_account() (refuses while a plan would charge again)
// and the trial-reminder cron (src/lib/email/trialReminders.ts).
export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      summary={
        <ul>
          <li>Agathon is an AI maths tutor in beta. The AI can be wrong; check what matters.</li>
          <li>Children under 13 need a parent or guardian to set up and agree to their account.</li>
          <li>Your boards are yours. We use them only to run Agathon for you.</li>
          <li>Ink is bought in one-time packs, never expires and is spent on AI help.</li>
          <li>
            {plan} is {price} a month after a free week. It renews by itself until you cancel, and you can cancel
            online at any time. Cancel during the free week and you pay nothing (<a href="#unlimited">how it works</a>).
          </li>
          <li>
            Unused ink can be refunded within {LEGAL.refundWindowDays} days of purchase. See the{" "}
            <Link href="/refunds">Refund Policy</Link> for ink and the plan.
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
            parent’s or guardian’s permission. Purchases, including ink packs and {plan}, must be made or approved by
            a parent or guardian.
          </li>
          <li>One person per account. You are responsible for what happens under your account; tell us if you think
            someone else is using it.</li>
          <li>
            Keep your email address up to date. It is where we send password resets and notice of changes to these
            terms or to prices. Emails about {plan}’s payments go to the email used at checkout.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="content" title="Your boards and content">
        <p>
          What you put on your boards (handwriting, drawings, typed text, images and PDFs) stays yours. You give us
          permission to store it, process it and send it to our service providers only as needed to run{" "}
          {LEGAL.productName} for you: saving your boards, reading your handwriting, producing the tutor’s answers,
          and giving each board a name. This permission ends when you delete the content or your account, apart from
          copies that take time to expire (see the Privacy Policy).
        </p>
        <p>
          Only upload what you have the right to use. Do not put other people’s personal information, or anything
          illegal, hateful or harmful, on a board.
        </p>
      </LegalSection>

      <LegalSection id="use" title="Rules for using Agathon">
        <p>You agree not to:</p>
        <ul>
          <li>break the law, or use {LEGAL.productName} to harass, harm or deceive anyone;</li>
          <li>
            try to get around ink, the fair-use limit, rate limits or security, or access other people’s accounts or
            boards;
          </li>
          <li>share one account, or one plan, between several people;</li>
          <li>scrape, copy or resell the service, or access it with bots or scripts;</li>
          <li>try to make the AI produce harmful content, or overload or disrupt the service;</li>
          <li>reverse-engineer the service, except where the law allows it.</li>
        </ul>
        <p>We may limit, suspend or close an account that breaks these rules.</p>
      </LegalSection>

      <LegalSection id="ink" title="Ink packs">
        <ul>
          <li>
            AI help, such as reading your handwriting, checking, hints, worked solutions and chat, uses{" "}
            <strong>ink</strong>, unless you have <a href="#unlimited">{plan}</a>. Writing and drawing on your own costs
            nothing. The app shows how much ink an action uses; those amounts may change for future actions.
          </li>
          <li>
            Ink is sold in one-time packs: {packs} (US dollars, plus any tax that applies). Packs are not subscriptions
            and never renew.
          </li>
          <li>
            Payments are processed by Stripe. Checkout and your receipt show the seller name{" "}
            <strong>“{LEGAL.stripeSellerName}”</strong>, and your card statement shows{" "}
            <strong>“{LEGAL.statementDescriptors.inkPacks}”</strong>. We never see or store your full card number.
          </li>
          <li>
            <strong>Ink never expires.</strong> It has no cash value, cannot be transferred to another account, and can
            only be refunded as the <Link href="/refunds">Refund Policy</Link> says.
          </li>
          <li>New accounts may get some free starter ink. Free ink has no cash value and is not refundable.</li>
          <li>If we ever shut {LEGAL.productName} down, we will refund purchased ink you have not used.</li>
        </ul>
      </LegalSection>

      <LegalSection id="unlimited" title={`${plan} (subscription)`}>
        <p>
          {plan} is a monthly plan. While it is on, AI help does not use ink. It is optional: you can always use{" "}
          {LEGAL.productName} with ink instead.
        </p>

        <h3>Price and free week</h3>
        <ul>
          <li>
            <strong>{price} a month</strong> (US dollars, plus any tax that applies), after a{" "}
            <strong>free week</strong>.
          </li>
          <li>The free week starts when you finish checkout. Checkout asks for a card but charges nothing that day.</li>
          <li>
            When the free week ends, {trialDays} days after checkout, the card is charged {price}. After that it is
            charged {price} once a month, on the same day of the month, until you cancel.
          </li>
        </ul>

        <h3>It renews automatically</h3>
        <p>
          By starting the free week, you agree that we may charge the card you gave {price} when the free week ends and
          then every month, until you cancel. You do not need to do anything to keep the plan. When the free week
          starts, we email the person who paid, at the email used at checkout, to confirm it: nothing was charged, the
          date and amount of the first charge, and how to cancel. About 2 to 3 days before the free week ends, we email
          them again with the date and the amount, and a link to cancel.
        </p>

        <h3>How to cancel</h3>
        <ul>
          <li>
            Cancel online at any time, in a few clicks. No phone call or email is needed. On your Account page, choose{" "}
            <strong>Manage or cancel</strong> in the {plan} section (the reminder email has the same link), sign in to
            Stripe’s billing page with the email used at checkout, and cancel the plan.
          </li>
          <li>
            <strong>Cancel before the free week ends and you will not be charged.</strong> Help stays unlimited until
            the free week is over.
          </li>
          <li>
            After that, cancelling stops the next charge. The plan stays on until the end of the month you have paid for,
            then ends. We do not refund part of a month, except as the{" "}
            <Link href="/refunds#subscriptions">Refund Policy</Link> says.
          </li>
          <li>
            If you cannot sign in to cancel (for example, because another email was used at checkout), email{" "}
            <ContactEmail /> and we will cancel it for you.
          </li>
          <li>
            Deleting your {LEGAL.productName} account does not cancel the plan, so cancel it first. The app will not
            delete an account whose plan would charge the card again.
          </li>
        </ul>

        <h3 id="fair-use">Fair use</h3>
        <p>
          Unlimited means you do not count ink. To keep {LEGAL.productName} working well for everyone, an account on the
          plan can use up to <strong>{fairUse} AI actions in any 24 hours</strong>. Each line the tutor reads counts as
          one, and so does each check, hint, worked solution or chat message. That is hours of steady work. If an
          account goes over,
          help pauses for a while and the app says when to try again. You are never charged extra for it, and it does
          not use your ink. We may change this limit; if we lower it, we will email you first.
        </p>

        <h3>If a payment does not go through</h3>
        <p>
          Stripe tries the card again over the following days. Until a payment goes through, help uses ink again, and
          your Account page asks you to update your card. If the payment still has not gone through after the last
          retry, the plan ends.
        </p>

        <h3>Price changes</h3>
        <p>
          We may change the price of {plan}. A new price never applies to your plan until we have emailed you about it,
          at least {LEGAL.unlimited.priceChangeNoticeDays} days ahead, so you can cancel first.
        </p>

        <h3>Who pays</h3>
        <ul>
          <li>
            If the student is under 18, a parent or guardian starts the plan with their own card. Whoever’s card is used
            agrees to these terms for the plan and is responsible for its charges.
          </li>
          <li>
            Payments are processed by Stripe, under the seller name <strong>“{LEGAL.stripeSellerName}”</strong>; your
            card statement shows the plan’s charges as <strong>“{LEGAL.statementDescriptors.unlimited}”</strong>.
            Stripe’s billing page shows the plan, its invoices and the card. We never see or store your full card
            number.
          </li>
        </ul>

        <h3>Free weeks</h3>
        <p>
          The free week is for new subscribers. We may limit it to one per person, family or card. If we find a repeat
          free week, we may cancel it (nothing is charged) or not offer one.
        </p>

        <h3>Your ink, and if we shut down</h3>
        <p>
          Ink you already have stays on your account while the plan is on, and is there to use if the plan ends. If we
          ever shut {LEGAL.productName} down, we will cancel every plan so nobody is charged again, and refund the
          unused part of the current paid month.
        </p>
      </LegalSection>

      <LegalSection id="ending" title="Ending your account">
        <p>
          You can delete your account at any time from your Account page. Deleting it removes your boards and ink
          balance and cannot be undone; ask for a refund of unused ink first if you are within the refund window. If you
          have {plan}, cancel it first (see <a href="#unlimited">above</a>).
        </p>
        <p>
          We may suspend or close an account that breaks these terms. If we do, we cancel its plan so it is not charged
          again, and unused purchased ink is not refunded unless the law requires it.
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
          cancel your plan and delete your account. A new price for {plan} follows the rule{" "}
          <a href="#unlimited">above</a>.
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
