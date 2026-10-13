import type { Metadata } from "next";
import { LANDING_COPY } from "@/components/landing/copy";
import { AskDemo } from "@/components/landing/AskDemo";
import { GrownUps } from "@/components/landing/GrownUps";
import { Hero } from "@/components/landing/Hero";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { INK_START_SCRIPT } from "@/components/landing/inkStart";
import { Join } from "@/components/landing/Join";
import { LandingNav } from "@/components/landing/LandingNav";
import { PracticePicker } from "@/components/landing/PracticePicker";
import { Pricing } from "@/components/landing/Pricing";
import { Questions } from "@/components/landing/Questions";
import { SessionHop } from "@/components/landing/SessionHop";
import { StickyJoin } from "@/components/landing/StickyJoin";
import { JsonLd } from "@/components/seo/JsonLd";
import { LANDING_PATH } from "@/lib/landing/links";
import { landingJsonLd } from "@/lib/seo/landingJsonLd";
import { OPEN_GRAPH_DEFAULTS } from "@/lib/seo/site";
import styles from "@/components/landing/landing.module.css";

/**
 * The landing page (v3, 2026-10-12; docs/LANDING-V3.md): what a signed-out visitor to agathon.app
 * sees, and the link parents send each other. What Agathon is (the hero's replay), a problem from
 * every grade, how it works, Ask, the devices it runs on, what kids practice, what grown-ups see,
 * the price and the questions, ending in the way in (the Join band); the platform layout adds the
 * legal footer. Its address is agathon.app/ itself (a rewrite serves it to a signed-out "/";
 * /parents keeps working), so that is its canonical URL.
 * Server-rendered and static: no auth wait, nothing on it depends on who is looking. Its words are
 * in src/components/landing/copy.ts; its ink draws itself as it comes into view (inkStart.ts).
 * For search (docs/SEO.md): a whole title with the words parents search for, and structured data
 * (src/lib/seo/landingJsonLd.ts) that says what Agathon is, its plan, and the Questions band's answers.
 */

const copy = LANDING_COPY.meta;

/** Where the page lives: the site's root (LANDING_PATH). */
const CANONICAL = LANDING_PATH;

export const metadata: Metadata = {
  // the whole title: the brand leads, so the root layout's " · Agathon" is not added (its
  // metadataBase makes the canonical and og:url absolute)
  title: { absolute: copy.title },
  description: copy.description,
  alternates: { canonical: CANONICAL },
  // The app's pages stay out of search (the root layout's noindex); this one page exists to be found
  // by parents, so it opts back in. One line to revert if the owner wants the whole site hidden.
  robots: { index: true, follow: true },
  openGraph: {
    ...OPEN_GRAPH_DEFAULTS,
    url: CANONICAL,
    title: copy.ogTitle,
    description: copy.description,
  },
  twitter: {
    card: "summary_large_image",
    title: copy.ogTitle,
    description: copy.description,
  },
};

export default function ParentsPage() {
  return (
    <div className={styles.page}>
      <SessionHop />
      <LandingNav />
      <main>
        <Hero />
        {/* a phone's bottom Join bar, while these are on screen (StickyJoin) */}
        <StickyJoin>
          <HowItWorks />
          <AskDemo />
          <PracticePicker />
          <GrownUps />
          <Pricing />
          <Questions />
        </StickyJoin>
        <Join />
      </main>
      {/* After every drawing on the page: holds each until it is in view (no hydration needed). */}
      <script dangerouslySetInnerHTML={{ __html: INK_START_SCRIPT }} />
      {/* What the page is, for search and answer engines (data, never run): after the page, so the
          session hop stays its first script. */}
      <JsonLd data={landingJsonLd()} />
    </div>
  );
}
