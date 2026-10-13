import type { Metadata } from "next";
import { LANDING_COPY } from "@/components/landing/copy";
import { AskDemo } from "@/components/landing/AskDemo";
import { Devices } from "@/components/landing/Devices";
import { landingFontClass } from "@/components/landing/fonts";
import { GrownUps } from "@/components/landing/GrownUps";
import { Hero, HeroReplay } from "@/components/landing/Hero";
import { Honest } from "@/components/landing/Honest";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { INK_START_SCRIPT } from "@/components/landing/inkStart";
import { Join } from "@/components/landing/Join";
import { LandingNav } from "@/components/landing/LandingNav";
import { PracticePicker } from "@/components/landing/PracticePicker";
import { Pricing } from "@/components/landing/Pricing";
import { ProblemStrip } from "@/components/landing/ProblemStrip";
import { Questions } from "@/components/landing/Questions";
import { SessionHop } from "@/components/landing/SessionHop";
import { StickyJoin } from "@/components/landing/StickyJoin";
import { TornEdge } from "@/components/landing/TornEdge";
import { LANDING_PATH, siteOrigin } from "@/lib/landing/links";
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
 */

const copy = LANDING_COPY.meta;

/** Where the page lives: the site's root (LANDING_PATH). */
const CANONICAL = LANDING_PATH;

export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin(process.env.NEXT_PUBLIC_SITE_URL)),
  title: copy.title,
  description: copy.description,
  alternates: { canonical: CANONICAL },
  // The app's pages stay out of search (the root layout's noindex); this one page exists to be found
  // by parents, so it opts back in. One line to revert if the owner wants the whole site hidden.
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    url: CANONICAL,
    siteName: "Agathon",
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
    <div className={`${styles.page} ${landingFontClass}`}>
      <SessionHop />
      <LandingNav />
      <main>
        <Hero />
        {/* v4: wherever one band's paper meets another color, a torn edge (TornEdge): the strip is a
            torn strip of white, the dark bands and the deeper cream ones whole torn sheets */}
        <TornEdge tone="deep" edge="top" seed={5} />
        <HeroReplay />
        <TornEdge tone="white" edge="top" seed={11} />
        <ProblemStrip />
        <TornEdge tone="white" edge="bottom" seed={12} />
        {/* a phone's bottom Join bar, while these are on screen (StickyJoin) */}
        <StickyJoin>
          <HowItWorks />
          <TornEdge tone="brown" edge="top" seed={21} depth={10} fiber />
          <Honest />
          <TornEdge tone="brown" edge="bottom" seed={22} depth={10} fiber />
          <AskDemo />
          <TornEdge tone="deep" edge="top" seed={31} />
          <Devices />
          <TornEdge tone="deep" edge="bottom" seed={32} />
          <PracticePicker />
          <TornEdge tone="brown" edge="top" seed={41} depth={10} fiber />
          <GrownUps />
          <TornEdge tone="brown" edge="bottom" seed={42} depth={10} fiber />
          <Pricing />
          <TornEdge tone="deep" edge="bottom" seed={51} />
          <Questions />
        </StickyJoin>
        <TornEdge tone="blue" edge="top" seed={61} depth={10} fiber />
        <Join />
        <TornEdge tone="blue" edge="bottom" seed={62} depth={10} />
      </main>
      {/* After every drawing on the page: holds each until it is in view (no hydration needed). */}
      <script dangerouslySetInnerHTML={{ __html: INK_START_SCRIPT }} />
    </div>
  );
}
