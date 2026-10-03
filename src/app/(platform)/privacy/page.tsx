import type { Metadata } from "next";
import Link from "next/link";
import { ContactBlock, ContactEmail, LegalPage, LegalSection } from "@/components/legal/LegalPage";
import styles from "@/components/legal/legal.module.css";
import { UNLIMITED_PLAN } from "@/lib/billing/unlimited";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "What Agathon collects, why, who it is shared with, the emails it sends, and the choices you and parents have.",
};

const plan = UNLIMITED_PLAN.name;

/**
 * Who processes what. Keep in step with the code:
 *  - Supabase (src/lib/supabase.ts; project in us-east-1), Vercel (hosting, logs, the crons in vercel.json)
 *  - OpenRouter (src/lib/server/openrouter.ts) and the model providers behind it: LIVE_MODELS in
 *    src/lib/live/contracts.ts and TEXT_MODELS (Google Gemini, OpenAI GPT, Anthropic Claude, DeepSeek)
 *  - Mathpix (src/lib/server/mathpix.ts, strokes only)
 *  - Stripe (Payment Links for the packs and Agathon Unlimited, the customer portal, the webhook)
 *  - Resend (src/lib/email/resend.ts; also Supabase Auth's SMTP for password resets)
 *  - ElevenLabs (src/app/api/live/lecture/token) and the browser's recognizer
 *    (src/lib/live/lecture/speech/browser.ts): lecture mode, hidden from the board for now
 *  - tldraw's CDN (fonts, icons) and unpkg (the PDF.js worker, src/lib/pdf.ts)
 */
const PROVIDERS = [
  {
    name: "Supabase",
    role: "Database, sign-in and file storage, in the United States.",
    data: "Your account, boards and their recent history, images and PDFs you add, purchases, your plan, ink and AI usage, the email log, bug reports.",
  },
  {
    name: "Vercel",
    role: "Hosts the app, runs its scheduled jobs, and keeps its server logs.",
    data: "Every request: IP address, browser, the page or feature used, timing and error reports.",
  },
  {
    name: "OpenRouter",
    role: "Passes our AI requests to the AI model providers below and brings back their answers.",
    data: "What each AI request contains (see “AI and your boards”). Not your email address or name.",
  },
  {
    name: "AI model providers: Google (Gemini), OpenAI (GPT), Anthropic (Claude), DeepSeek",
    role: "Read your work and write the tutor’s answers, reached through OpenRouter, which sends each request only to a host that has agreed to keep nothing and not to train on it (such as Google Cloud, Microsoft Azure or Amazon Web Services). Which model answers depends on the task; if one is slow or down, another takes over.",
    data: "Pictures of the part of the board you are working on, the maths read from your board, what the tutor has written, your chat messages and, in lecture mode, the lecture transcript.",
  },
  {
    name: "Mathpix",
    role: "Handwriting recognition.",
    data: "The pen strokes of what you write (their shapes, not a photo of the board).",
  },
  {
    name: "Stripe",
    role: `Payments for ink packs and ${plan}, under the seller name “${LEGAL.stripeSellerName}”, and the billing page where a plan is managed or cancelled.`,
    data: "What the payer enters at checkout (email, name, card details, billing country and postcode) and the payments. We receive the pack or plan, amounts, dates and status, never the full card number.",
  },
  {
    name: "Resend",
    role: "Sends our emails: password resets, the welcome email and the free-week reminder.",
    data: "Your email address and the email we send you.",
  },
  {
    name: "ElevenLabs",
    role: "Speech-to-text for lecture mode, which is switched off for now; only while it is listening.",
    data: "Microphone audio, streamed straight from your browser.",
  },
  {
    name: "Your browser’s speech recognition",
    role: "Lecture mode’s fallback when ElevenLabs is not available.",
    data: "Microphone audio. Some browsers (for example Chrome) send it to their maker (Google) to recognise it.",
  },
  {
    name: "tldraw and unpkg",
    role: "Content networks: the drawing engine’s fonts and icons, and the PDF reader’s code when you add a PDF.",
    data: "Your IP address and browser, as with any download. Not your boards.",
  },
] as const;

// DRAFT for the owner and counsel to review (src/lib/legal.ts). Static: no request data.
export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      summary={
        <ul>
          <li>
            We collect what Agathon needs to work: your account, your boards, how you use the tutor, and your payments
            and plan.
          </li>
          <li>
            To tutor you, what you write is sent to AI services that read handwriting and answer (listed{" "}
            <a href="#providers">below</a>).
          </li>
          <li>No ads. We never sell your data or share it for advertising. We send no marketing emails.</li>
          <li>
            Children under 13 need a parent’s consent; parents can see or delete their child’s data (
            <a href="#children">Children under 13</a>).
          </li>
          <li>You can delete your account, and everything in it, at any time from your Account page.</li>
        </ul>
      }
    >
      <LegalSection id="who" title="Who we are">
        <p>
          {LEGAL.productName} is run by {LEGAL.operatorName} (“we”). This policy explains what we collect when
          you use {LEGAL.productName} at {LEGAL.siteHost}, why, and what you can do about it. It is part of our{" "}
          <Link href="/terms">Terms of Service</Link>.
        </p>
      </LegalSection>

      <LegalSection id="collect" title="What we collect">
        <h3>You give us</h3>
        <ul>
          <li>
            <strong>Account:</strong> your email address and password (stored only as a secure hash; we never see it),
            an optional display name, and the course you pick when you start.
          </li>
          <li>
            <strong>Your boards:</strong> your handwriting and drawings, typed text, images and PDFs you add, what the
            tutor writes back, and the messages you type to the tutor. In lecture mode (switched off for now), what is
            said near your microphone while it is listening, turned into text.
          </li>
          <li>
            <strong>Bug reports</strong>, when you send one: your message, a screenshot of your board, recent technical
            logs from the app, your browser details and your account email.
          </li>
        </ul>
        <h3>Collected as you use Agathon</h3>
        <ul>
          <li>
            <strong>Ink purchases:</strong> which ink pack, the amount, the date, refunds, and the Stripe customer and
            payment ids.
          </li>
          <li>
            <strong>{plan}:</strong> the plan’s Stripe ids, its status (free week, active, payment problem, cancelled)
            and its dates (when the free week ends, the next charge, when it was cancelled or ends).
          </li>
          <li>
            <strong>Payment notices:</strong> the messages Stripe sends us about {LEGAL.productName}’s payments. They
            can include the payer’s name, email, billing country and postcode, and the card’s brand and last four
            digits. Stripe handles the card; we never receive the full card number.
          </li>
          <li>
            <strong>Usage:</strong> which AI features you use, when, which AI model answered, and how much ink they used.
            On {plan}, each AI action is recorded instead (which feature, when, and the ink it would have cost), to
            apply the <Link href="/terms#fair-use">fair-use limit</Link> and to see what the plan costs to run.
          </li>
          <li>
            <strong>Email log:</strong> which of our emails we sent to your account and when (not what they said), so
            each one goes out only once.
          </li>
          <li>
            <strong>Technical data:</strong> IP address, browser and device type, the pages you open (without anything
            after a “?” in the address), and error reports when something in the app crashes (the page, your
            browser, the error, and your account id).
          </li>
        </ul>
        <h3>Kept on your device</h3>
        <p>
          Your browser stores your sign-in session, your settings, and a backup of board changes not yet saved, so
          nothing is lost if your connection drops. We do not use advertising or analytics cookies, and
          there are no third-party trackers.
        </p>
      </LegalSection>

      <LegalSection id="use" title="How we use it">
        <ul>
          <li>To run {LEGAL.productName}: save your boards, read your handwriting, check your working and answer.</li>
          <li>To give each board a short name from the maths on it, such as “Solving trig equations”.</li>
          <li>
            To sell and refund ink, keep track of your balance, and run {plan}: know whether your plan is on, apply
            the fair-use limit, and remind you before a free week ends.
          </li>
          <li>To send the emails listed under <a href="#emails">Emails we send</a>.</li>
          <li>To keep the service safe and fair: sign-in, rate limits, preventing abuse.</li>
          <li>To find and fix problems, using error reports, logs and the bug reports you send.</li>
          <li>To answer you when you contact us, and to tell you about important changes.</li>
        </ul>
        <p>
          We do <strong>not</strong> show ads, sell your personal information, share it for advertising, or build
          marketing profiles. We do not use your boards to train AI models.
        </p>
      </LegalSection>

      <LegalSection id="ai" title="AI and your boards">
        <p>
          The tutor is made of AI services. Each time it reads, checks or answers, {LEGAL.productName} sends that service
          only what it needs for that step:
        </p>
        <ul>
          <li>
            <strong>Reading your handwriting:</strong> the pen strokes of what you write go to Mathpix. If Mathpix cannot
            read a line, or its reading looks wrong, a picture of that part of the board goes to an AI model to read it
            again.
          </li>
          <li>
            <strong>Checking, hints, worked solutions, word problems, figures and proofs:</strong> the maths read from
            your board, what the tutor has already written and, when the AI needs to see it, a picture of the part of
            the board you are working on.
          </li>
          <li>
            <strong>Chat:</strong> the messages you type to the tutor and its recent replies, with the maths on the
            board.
          </li>
          <li>
            <strong>Naming a board:</strong> the lines of maths on it.
          </li>
        </ul>
        <p>
          These requests go through OpenRouter to models from Google (Gemini), OpenAI (GPT), Anthropic (Claude) and
          DeepSeek. They never include your email address, your display name or your payment details, although
          anything you write on a board (your name, say) is sent along with the rest of the board.
        </p>
        <p>
          We do not use your boards to train AI models. {LEGAL.aiProviderTraining} Mathpix keeps only a record that a
          request was made (when, and whether it worked), not your handwriting or what it read. Some of the AI
          providers may process what we send outside the United States.
        </p>
      </LegalSection>

      <LegalSection id="emails" title="Emails we send">
        <p>We send only the emails {LEGAL.productName} needs to work, to the email address on your account:</p>
        <ul>
          <li>
            <strong>Password reset:</strong> when you ask for one.
          </li>
          <li>
            <strong>Welcome:</strong> once, after you finish your first guided board, with two tips for using the tutor.
          </li>
          <li>
            <strong>Free week ending:</strong> if you start {plan}, one reminder about 2 to 3 days before the free week
            ends, with the date of the first charge and a link to cancel. None if the plan is already set to cancel.
          </li>
        </ul>
        <p>
          Stripe may also email the person who paid: receipts and notices about their payments. We send no newsletters or
          marketing emails. If we ever want to, we will ask you first.
        </p>
        <p>
          Our emails come from <strong>mail.agathon.app</strong> and are sent by Resend. We keep a log of which email
          went to which account and when (see <a href="#retention">How long we keep it</a>).
        </p>
      </LegalSection>

      <LegalSection id="providers" title="Who we share it with">
        <p>
          We share personal information only with the service providers that run {LEGAL.productName} for us, and only
          what each one needs:
        </p>
        <ul className={styles.providers}>
          {PROVIDERS.map((p) => (
            <li key={p.name} className={styles.provider}>
              <p className={styles.providerName}>{p.name}</p>
              <p>{p.role}</p>
              <p className={styles.providerDetail}>{p.data}</p>
            </li>
          ))}
        </ul>
        <p>
          We may also disclose information when the law requires it, to protect someone’s safety, or as part of a
          sale or merger of {LEGAL.productName}, in which case this policy keeps applying to it.
        </p>
      </LegalSection>

      <LegalSection id="children" title="Children under 13 (COPPA)" className={styles.callout}>
        <p>
          {LEGAL.productName} is made for students, and some are under 13. In the United States, the Children’s
          Online Privacy Protection Act (COPPA) requires a parent’s consent before we collect personal information
          from a child under 13. This section is our notice to parents.
        </p>
        <ul>
          <li>
            <strong>Parental consent.</strong> A parent or legal guardian must create the account for a child under 13,
            or give consent before the child uses it. By doing so, the parent agrees to this policy for the child.
          </li>
          <li>
            <strong>What we collect from a child:</strong> their handwriting and drawings, the maths on their boards,
            what they type to the tutor, images and PDFs they add, and bug reports if they send one; the email address
            and password used to sign in, the course they pick and an optional display name; and how they use the
            tutor (see <a href="#collect">What we collect</a>). Only what the tutor needs. We do not ask a child for
            their address, phone number, photo or location.
          </li>
          <li>
            <strong>What the AI sees:</strong> the parts of the board it needs to help (see{" "}
            <a href="#ai">AI and your boards</a>), never the child’s email address or display name.
          </li>
          <li>
            <strong>Who sees it:</strong> only the service providers <a href="#providers">listed above</a>, to run the
            tutor. No ads, no selling, no advertising use, no marketing to children. A child’s boards are private to
            their account; there are no public profiles, sharing or messaging with other users.
          </li>
          <li>
            <strong>Emails</strong> go to the account’s email address. If you set up your child’s account with your
            own address, the welcome email and any free-week reminder come to you.
          </li>
          <li>
            <strong>Payments</strong> are made by a parent or guardian, through Stripe: a child does not pay. Ink packs
            and {plan} are paid with a grown-up’s card.
          </li>
          <li>
            <strong>Reviewing a child’s data:</strong> a parent can see the child’s boards by signing in to
            the account, and can ask us for a copy of everything we hold about the child by emailing <ContactEmail />{" "}
            from the account’s email address (or with other proof that they are the parent).
          </li>
          <li>
            <strong>Deleting a child’s data:</strong> a parent can delete the account at any time from the Account
            page (Delete account; if {plan} is on, cancel it first), which deletes the boards, ink, usage records,
            profile, email log and bug reports, or email us and we will delete it. A parent can also tell us to stop
            collecting the child’s information; the account then has to be closed.
          </li>
          <li>
            <strong>How long we keep it:</strong> only while the account is open, then as described in{" "}
            <a href="#retention">How long we keep it</a>.
          </li>
          <li>
            If we learn that we collected information from a child under 13 without a parent’s consent, we will
            delete it.
          </li>
        </ul>
        <p>Questions from parents go to:</p>
        <ContactBlock />
      </LegalSection>

      <LegalSection id="retention" title="How long we keep it">
        <ul>
          <li>
            <strong>Your account and boards:</strong> until you delete them. Deleting a board or your account removes it
            from our database straight away; files such as images are cleared within a couple of days by a nightly
            clean-up.
          </li>
          <li>
            <strong>Board history:</strong> a few earlier versions of each board, from about the last week, so we can
            restore a board that was wiped by mistake. They are deleted with the board.
          </li>
          <li>
            <strong>Ink, usage, the fair-use record, ink purchases and the email log:</strong> deleted with your
            account.
          </li>
          <li>
            <strong>Bug reports you sent:</strong> until you delete your account, which deletes them with it, email
            address included. Ask us and we will delete them sooner.
          </li>
          <li>
            <strong>{plan}:</strong> when an account is deleted, its plan’s record (Stripe ids, status and dates,
            nothing that names you) is kept without the link to the account, so a plan whose account is gone can still
            be found and stopped.
          </li>
          <li>
            <strong>Payment notices from Stripe:</strong> kept after an account is deleted, for our accounts and to sort
            out payment questions and refunds. Stripe keeps its own payment records under its own policy and the law.
          </li>
          <li>
            <strong>Server logs and error reports:</strong> kept by our hosting provider for a limited time, then
            deleted. Resend keeps a record of each email it sends for a limited time.
          </li>
          <li>
            <strong>Copies for maintenance:</strong> before risky maintenance we sometimes copy the database. A copy is
            kept privately, only as long as we may need it to undo a problem.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="rights" title="Your choices and rights">
        <ul>
          <li>See and change your account details on your Account page.</li>
          <li>
            Delete your account, and everything in it, from your Account page. If {plan} is on, cancel it first:
            deleting the account does not cancel the plan.
          </li>
          <li>
            Ask us for a copy of your data, to correct it, or to delete it, by emailing <ContactEmail />. We will reply
            within 30 days.
          </li>
        </ul>
        <p>
          Depending on where you live (for example California or the European Union), you may have further rights, such
          as knowing what we collect or objecting to how it is used. Contact us to use them; we will not treat you
          differently for doing so.
        </p>
      </LegalSection>

      <LegalSection id="security" title="Security">
        <p>
          Connections to {LEGAL.productName} are encrypted (HTTPS). Each board can only be read by its owner’s
          account, passwords are stored as hashes, and our provider keys stay on our servers. Images you add to a board
          are stored at long, random web addresses that are not listed anywhere, so the tutor and your browser can load
          them; anyone given the exact address of an image could open it. No system is perfectly secure; if a breach
          affects your information, we will tell you as the law requires.
        </p>
      </LegalSection>

      <LegalSection id="where" title="Where your data is stored">
        <p>
          Your account and boards are stored in the United States. Some service providers, including AI model providers,
          may process data in other countries.
        </p>
      </LegalSection>

      <LegalSection id="changes" title="Changes to this policy">
        <p>
          We will post any change here. If a change matters, we will tell you by email or in the app before it takes
          effect, and we will ask parents for new consent before using a child’s information in a new way.
        </p>
      </LegalSection>

      <LegalSection id="contact" title="Contact">
        <ContactBlock />
      </LegalSection>
    </LegalPage>
  );
}
