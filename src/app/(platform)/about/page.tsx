import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { BetaBadge } from "@/components/app/BetaBadge";
import { HOW_ID } from "@/components/landing/bands";
import { LANDING_COPY } from "@/components/landing/copy";
import { InkCheck, InkUnderline } from "@/components/landing/InkMark";
import { INK_START_SCRIPT } from "@/components/landing/inkStart";
import { Join } from "@/components/landing/Join";
import { TrialWords } from "@/components/landing/TrialWords";
import landing from "@/components/landing/landing.module.css";
import { JsonLd } from "@/components/seo/JsonLd";
import { organizationNode } from "@/lib/seo/landingJsonLd";
import { MAX_KIDS } from "@/lib/family/contracts";
import { LANDING_PATH, SIGN_IN_HREF, SIGN_UP_HREF, siteOrigin } from "@/lib/landing/links";
import { planWords } from "@/lib/landing/plan";
import { LEGAL } from "@/lib/legal";
import { AGATHON_DEFINITION, agathonFacts, FAQ, faqAnswer, levelEntries, oneLine, PRIVACY_POINTS, skillEntries } from "@/lib/seo/llms";
import { ABOUT_PATH, MATH_PATH } from "@/lib/seo/routes";
import styles from "./about.module.css";

/**
 * /about: what Agathon is, in plain facts (SEO build 2026-10-13, docs/SEO.md "AI search"). The page an
 * answer engine quotes when someone asks "what is Agathon?": it opens with the one-sentence
 * definition, lists Agathon at a glance (a `<dl>` a machine or a parent can scan), then how it works,
 * who it is for, what it covers, what it costs, the devices, privacy and kids' data, who makes it and
 * how to reach us, and ends in the landing page's Join band.
 *
 * Every fact comes from the site's own sources through src/lib/seo/llms.ts (the landing copy, the
 * plan's words, the skill paths, the legal pages), so it says what the landing page and the policies
 * say and nothing more. Static: no auth wait, nothing depends on who is looking. It wears the landing
 * page's tokens and pens (landing.module.css): flat fills, the tutor's underline on the title and a
 * check mark by "It checks", and the Join band's arrow.
 */

const origin = siteOrigin(process.env.NEXT_PUBLIC_SITE_URL);
const copy = LANDING_COPY;
const plan = planWords();

/** The search words first; the root layout adds " · Agathon" (51 characters in all). */
const TITLE = "What is Agathon? An AI math tutor for K–8";
const DESCRIPTION =
  "What Agathon is, in plain facts: an AI math tutor on a whiteboard for kindergarten to 8th grade and high school. How it works, the price, devices and privacy.";

export const metadata: Metadata = {
  metadataBase: new URL(origin),
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: ABOUT_PATH },
  // the root layout's default is noindex: this page exists to be read and quoted
  robots: { index: true, follow: true },
  openGraph: { type: "website", url: ABOUT_PATH, siteName: "Agathon", title: TITLE, description: DESCRIPTION },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

/**
 * The page's graph: an AboutPage whose main entity is Agathon, the Organization.
 * `@id` convention (shared with the landing page's graph, docs/SEO.md): the Organization is
 * `<origin>/#organization` and the WebSite `<origin>/#website` on every page, so search engines and
 * answer engines join the graphs into one Agathon. Only facts this page shows: the name, the
 * definition, the contact email and who runs it (the legal pages' operator).
 */
const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "AboutPage",
  "@id": `${origin}${ABOUT_PATH}#webpage`,
  url: `${origin}${ABOUT_PATH}`,
  name: TITLE,
  description: DESCRIPTION,
  inLanguage: "en-US",
  isPartOf: { "@type": "WebSite", "@id": `${origin}/#website`, name: "Agathon", url: `${origin}/` },
  // the landing page's Organization node (same @id, logo and email), with what this page adds
  mainEntity: { ...organizationNode(origin), description: AGATHON_DEFINITION, parentOrganization: { "@type": "Organization", name: LEGAL.operatorName } },
};

/** The page's parts, for the bar's jumps (wide screens) and the sections' ids. */
const PARTS = {
  glance: "at-a-glance",
  how: "how-it-works",
  who: "who-its-for",
  covers: "what-it-covers",
  cost: "what-it-costs",
  devices: "devices",
  privacy: "privacy",
  maker: "who-makes-agathon",
  contact: "contact",
} as const;

const NAV_LINKS = [
  { label: "How it works", id: PARTS.how },
  { label: "What it costs", id: PARTS.cost },
  { label: "Privacy", id: PARTS.privacy },
  { label: "Contact", id: PARTS.contact },
] as const;

function Section({ id, title, children, after }: { id: string; title: string; children: ReactNode; after?: ReactNode }) {
  return (
    <section id={id} className={styles.section} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className={styles.sectionTitle}>
        {title}
        {after}
      </h2>
      <div className={styles.prose}>{children}</div>
    </section>
  );
}

function Nav() {
  return (
    <header className={landing.nav}>
      <nav aria-label="Agathon" className={`${landing.inner} ${landing.navInner}`}>
        <Link href={LANDING_PATH} className={landing.brand}>
          Agathon
          <BetaBadge className={landing.beta} />
        </Link>
        <ul className={landing.navParts}>
          {NAV_LINKS.map((link) => (
            <li key={link.id}>
              <a href={`#${link.id}`} className={landing.navPart}>
                {link.label}
              </a>
            </li>
          ))}
        </ul>
        <div className={landing.navLinks}>
          <Link href={SIGN_IN_HREF} className={landing.navSignIn}>
            {copy.nav.signIn}
          </Link>
          <Link href={SIGN_UP_HREF} className={`${landing.pill} ${landing.navCta}`}>
            <TrialWords usual={copy.nav.cta} invited={copy.invited.start} />
          </Link>
        </div>
      </nav>
    </header>
  );
}

export default function AboutPage() {
  const facts = agathonFacts(origin);
  const [pick, write, stuck] = copy.how.steps;
  const laptop = copy.devices.items.find((d) => d.name === "Laptop");
  const ages = faqAnswer(copy, FAQ.ages);
  const siblings = faqAnswer(copy, FAQ.siblings);
  const onlyMath = faqAnswer(copy, FAQ.onlyMath);
  const card = faqAnswer(copy, FAQ.card);
  const cancel = faqAnswer(copy, FAQ.cancel);
  const skillNames = new Map(skillEntries().map((s) => [s.id, s.name]));

  return (
    <div className={landing.page}>
      <JsonLd data={JSON_LD} />
      <Nav />
      <main>
        <section className={styles.hero} aria-labelledby="about-title">
          <div className={landing.inner}>
            <p className={landing.eyebrow}>About Agathon</p>
            <h1 id="about-title" className={styles.title}>
              What is{" "}
              <InkUnderline className={styles.titleMark} draw="about-title" atMs={350} forMs={420} pen={4}>
                Agathon
              </InkUnderline>
              ?
            </h1>
            <p className={styles.definition}>{AGATHON_DEFINITION}</p>
            <div className={styles.actions}>
              <Link href={SIGN_UP_HREF} className={`${landing.pill} ${landing.pillLarge}`}>
                <TrialWords usual={copy.hero.start} invited={copy.invited.start} />
              </Link>
              <Link href={`${LANDING_PATH}#${HOW_ID}`} className={landing.textLink}>
                {copy.hero.more}
              </Link>
            </div>
            <p className={styles.terms}>
              <TrialWords usual={copy.hero.terms} invited={copy.invited.terms} />
            </p>
          </div>
        </section>

        <div className={landing.inner}>
          <section id={PARTS.glance} className={styles.glance} aria-labelledby={`${PARTS.glance}-title`}>
            <h2 id={`${PARTS.glance}-title`} className={styles.glanceTitle}>
              Agathon at a glance
            </h2>
            <dl className={styles.facts}>
              {facts.map((fact) => (
                <div key={fact.term} className={styles.fact}>
                  <dt>{fact.term}</dt>
                  <dd>
                    {fact.term === "Website" ? (
                      <Link href={LANDING_PATH}>{fact.detail}</Link>
                    ) : fact.term === "Contact" ? (
                      <a href={`mailto:${fact.detail}`}>{fact.detail}</a>
                    ) : (
                      fact.detail
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          <Section id={PARTS.how} title="How it works">
            <h3>{oneLine(pick.title)}</h3>
            <p>{pick.body}</p>
            <h3>
              {oneLine(write.title)}
              <InkCheck className={styles.check} draw="about-check" atMs={150} />
            </h3>
            <p>{write.body}</p>
            <h3>Help me: a hint, the next step, or the solution</h3>
            <p>
              {"bodyBefore" in stuck ? (
                <>
                  {stuck.bodyBefore} <strong>{stuck.helpButton}</strong> {stuck.bodyAfter}
                </>
              ) : null}
            </p>
            <h3>Ask: questions, typed or out loud</h3>
            <p>{copy.ask.lede}</p>
            <ul>
              {copy.ask.features.map((f) => (
                <li key={f.title}>
                  <strong>{f.title}.</strong> {f.body}
                </li>
              ))}
            </ul>
            {laptop && (
              <>
                <h3>Type it on a laptop</h3>
                <p>{laptop.body}</p>
              </>
            )}
            <h3>For grown-ups</h3>
            <p>{copy.grownUps.lede}</p>
            <ul>
              {copy.grownUps.features.map((f) => (
                <li key={f.title}>
                  <strong>{f.title}.</strong> {f.body}
                </li>
              ))}
            </ul>
          </Section>

          <Section id={PARTS.who} title="Who it's for">
            {ages && <p>{ages.a}</p>}
            {siblings && <p>{siblings.a.replace(/^Yes\.\s*/, "")}</p>}
            <p>
              A parent or guardian sets up the account for a child under 13, or gives consent before the child uses it.
            </p>
          </Section>

          <Section id={PARTS.covers} title="What it covers">
            <p>
              {copy.practice.lede.split(".")[0]}. Every grade, course and skill has its own page in the{" "}
              <Link href={MATH_PATH}>math library</Link>, with a worked example and practice problems.
            </p>
            <ul className={styles.levels}>
              {levelEntries().map((level) => (
                <li key={level.path}>
                  <Link href={level.path}>{level.label}</Link>
                  {level.blurb ? <span className={styles.levelBlurb}> ({level.blurb})</span> : null}:{" "}
                  {level.skills.map((id) => skillNames.get(id) ?? id).join(", ")}
                </li>
              ))}
            </ul>
            {onlyMath && <p>{onlyMath.a}</p>}
          </Section>

          <Section id={PARTS.cost} title="What it costs">
            <p>
              One plan, {plan.name}:{" "}
              <strong>
                {plan.price} {plan.per}
              </strong>{" "}
              for up to {MAX_KIDS} kids. It includes:
            </p>
            <ul>
              {copy.pricing.includes.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <p>
              <strong>{copy.pricing.trial}</strong> {card ? card.a.replace(/^Yes\.\s*/, "") : copy.pricing.fine}
            </p>
            {cancel && (
              <p>
                <strong>How to cancel:</strong> {cancel.a}
              </p>
            )}
            <p>
              The <Link href="/terms">Terms of Service</Link> and the <Link href="/refunds">Refund Policy</Link> have the details.
            </p>
          </Section>

          <Section id={PARTS.devices} title="Devices">
            <p>{copy.devices.lede}</p>
            <ul>
              {copy.devices.items.map((d) => (
                <li key={d.name}>
                  <strong>{d.name}.</strong> {d.title} {d.body}
                </li>
              ))}
            </ul>
          </Section>

          <Section id={PARTS.privacy} title="Privacy and kids' data">
            <p>What the Privacy Policy promises, in short:</p>
            <ul>
              {PRIVACY_POINTS.map((point) => (
                <li key={point.text}>{point.text}</li>
              ))}
            </ul>
            <p>
              Read the <Link href="/privacy">Privacy Policy</Link>, and its notice to parents of{" "}
              <Link href="/privacy#children">children under 13</Link>.
            </p>
          </Section>

          <Section id={PARTS.maker} title="Who makes Agathon">
            <p>
              Agathon is made and run by {LEGAL.operatorName}. It is in beta: features can change, and the tutor is AI, so
              it can be wrong. Check anything that matters.
            </p>
          </Section>

          <Section id={PARTS.contact} title="How to reach us">
            <p>
              Email <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>.{" "}
              {
                "A parent can write about a child's account, ask for a copy of their child's data, or ask us to delete it. For a refund, write from the account's email address with the date of the charge."
              }
            </p>
            <p>
              <Link href="/privacy">Privacy Policy</Link> · <Link href="/terms">Terms of Service</Link> ·{" "}
              <Link href="/refunds">Refund Policy</Link>
            </p>
          </Section>
        </div>
        <Join />
      </main>
      {/* After every drawing on the page: holds each until it is in view (inkStart.ts). */}
      <script dangerouslySetInnerHTML={{ __html: INK_START_SCRIPT }} />
    </div>
  );
}
