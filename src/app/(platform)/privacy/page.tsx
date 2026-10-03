import type { Metadata } from "next";
import Link from "next/link";
import { ContactBlock, ContactEmail, LegalPage, LegalSection } from "@/components/legal/LegalPage";
import styles from "@/components/legal/legal.module.css";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "What Agathon collects, why, who it is shared with, and the choices you and parents have.",
};

/**
 * Who processes what. Keep in step with the code: Supabase (src/lib/supabase.ts), OpenRouter
 * (src/lib/server/openrouter.ts), Mathpix (src/lib/server/mathpix.ts, strokes only), ElevenLabs
 * (src/app/api/live/lecture/token, lecture mode), the browser's recognizer
 * (src/lib/live/lecture/speech/browser.ts), Stripe (Payment Links), tldraw's CDN (fonts, icons).
 */
const PROVIDERS = [
  {
    name: "Supabase",
    role: "Database, sign-in and file storage (United States).",
    data: "Your account, boards, images and PDFs you add, purchases, ink usage, bug reports.",
  },
  {
    name: "Vercel",
    role: "Hosts the app and its server logs.",
    data: "Every request: IP address, browser, the page or feature used, timing and error reports.",
  },
  {
    name: "OpenRouter",
    role: "Routes our requests to AI model providers, such as OpenAI, Google, Anthropic and DeepSeek.",
    data: "Images of the handwriting you ask about, the maths read from your board, what the tutor has written, your chat messages and, in lecture mode, the lecture transcript.",
  },
  {
    name: "Mathpix",
    role: "Handwriting recognition.",
    data: "The pen strokes of what you write (their shapes, not a photo of the board).",
  },
  {
    name: "ElevenLabs",
    role: "Speech-to-text, only in lecture mode, only while it is listening.",
    data: "Microphone audio, streamed straight from your browser.",
  },
  {
    name: "Your browser’s speech recognition",
    role: "Lecture mode’s fallback when ElevenLabs is not available.",
    data: "Microphone audio. Some browsers (for example Chrome) send it to their maker (Google) to recognise it.",
  },
  {
    name: "Stripe",
    role: `Payments for ink packs, under the seller name "${LEGAL.stripeSellerName}".`,
    data: "What you enter at checkout (email, card details, billing country) and the payment. We receive the pack, amount and payment status, never your card number.",
  },
  {
    name: "tldraw",
    role: "The drawing engine; loads its fonts and icons from tldraw’s content network.",
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
          <li>We collect what Agathon needs to work: your account, your boards, and how you use the tutor.</li>
          <li>
            To tutor you, what you write is sent to AI services that read handwriting and answer (listed{" "}
            <a href="#providers">below</a>).
          </li>
          <li>No ads. We never sell your data or share it for advertising.</li>
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
            tutor writes back, and the messages you type to the tutor. In lecture mode, what is said near your
            microphone while it is listening, turned into text.
          </li>
          <li>
            <strong>Bug reports</strong>, when you send one: your message, a screenshot of your board, recent technical
            logs from the app, your browser details and your account email.
          </li>
        </ul>
        <h3>Collected as you use Agathon</h3>
        <ul>
          <li>
            <strong>Purchases:</strong> which ink pack, the amount, the date, refunds, and the Stripe customer and
            payment ids. Stripe handles your card; we never receive the card number.
          </li>
          <li>
            <strong>Usage:</strong> which AI features you use, when, and how much ink they used.
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
          <li>To sell and refund ink, and keep track of your balance.</li>
          <li>To keep the service safe and fair: sign-in, rate limits, preventing abuse.</li>
          <li>To find and fix problems, using error reports, logs and the bug reports you send.</li>
          <li>To answer you when you contact us, and to tell you about important changes.</li>
        </ul>
        <p>
          We do <strong>not</strong> show ads, sell your personal information, share it for advertising, or build
          marketing profiles. We do not use your boards to train AI models.
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
          AI providers process what we send to produce an answer. Depending on the provider, it may be kept for a limited
          time under that provider’s own policy (for example, to monitor abuse) and may be processed outside the
          United States.
        </p>
        <p>
          We may also disclose information when the law requires it, to protect someone’s safety, or as part of a
          sale or merger of {LEGAL.productName}, in which case this policy keeps applying to it.
        </p>
      </LegalSection>

      <LegalSection id="children" title="Children under 13 (COPPA)" className={styles.callout}>
        <p>
          {LEGAL.productName} is used by students, and some are under 13. In the United States, the Children’s
          Online Privacy Protection Act (COPPA) requires a parent’s consent before we collect personal information
          from a child under 13.
        </p>
        <ul>
          <li>
            <strong>Parental consent.</strong> A parent or legal guardian must create the account for a child under 13,
            or give consent before the child uses it. By doing so, the parent agrees to this policy for the child.
          </li>
          <li>
            <strong>What we collect from a child</strong> is the same as for anyone (see{" "}
            <a href="#collect">What we collect</a>), and only what is needed for the tutor to work. A child’s
            boards are private to their account; there are no public profiles, sharing or messaging with other users.
          </li>
          <li>
            <strong>Who sees it:</strong> only the service providers <a href="#providers">listed above</a>, to run the
            tutor (for example, to read handwriting). No ads, no selling, no advertising use.
          </li>
          <li>
            <strong>Reviewing a child’s data:</strong> a parent can see the child’s boards by signing in to
            the account, and can ask us for a copy of everything we hold about the child by emailing <ContactEmail />{" "}
            from the account’s email address (or with other proof that they are the parent).
          </li>
          <li>
            <strong>Deleting a child’s data:</strong> a parent can delete the account at any time from the Account
            page (Delete account), which deletes the boards, ink, profile and bug reports, or email us and we will delete it. A parent
            can also tell us to stop collecting the child’s information; the account then has to be closed.
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
          <li>Your account and boards: until you delete them. Deleting a board or your account removes it from our
            database straight away; files such as images are cleared within a couple of days by a nightly clean-up.</li>
          <li>Purchase records: as long as we need them for tax and accounting. Stripe keeps its own records.</li>
          <li>
            Bug reports you sent: until you delete your account, which deletes them with it, email address included.
            Ask us and we will delete them sooner.
          </li>
          <li>Server logs and error reports: kept by our hosting provider for a limited time, then deleted.</li>
          <li>Backups held by our providers expire on their own schedule.</li>
        </ul>
      </LegalSection>

      <LegalSection id="rights" title="Your choices and rights">
        <ul>
          <li>See and change your account details on your Account page.</li>
          <li>Delete your account, and everything in it, from your Account page.</li>
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
          account, passwords are stored as hashes, and our provider keys stay on our servers. No system is perfectly
          secure; if a breach affects your information, we will tell you as the law requires.
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
