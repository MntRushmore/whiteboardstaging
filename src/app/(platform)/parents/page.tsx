import type { Metadata } from "next";
import { LANDING_COPY } from "@/components/landing/copy";
import { AskDemo } from "@/components/landing/AskDemo";
import { Devices } from "@/components/landing/Devices";
import { GrownUps } from "@/components/landing/GrownUps";
import { Hero } from "@/components/landing/Hero";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { INK_START_SCRIPT } from "@/components/landing/inkStart";
import { Join } from "@/components/landing/Join";
import { LandingNav } from "@/components/landing/LandingNav";
import { PracticePicker } from "@/components/landing/PracticePicker";
import { Pricing } from "@/components/landing/Pricing";
import { ProblemStrip } from "@/components/landing/ProblemStrip";
import { Questions } from "@/components/landing/Questions";
import { StickyJoin } from "@/components/landing/StickyJoin";
import { LANDING_PATH, siteOrigin } from "@/lib/landing/links";
import styles from "@/components/landing/landing.module.css";

/**
 * The landing page (v3, 2026-10-12; docs/LANDING-V3.md): what a signed-out visitor to agathon.app
 * sees, and the link parents send each other. What Agathon is (the hero's replay), a problem from
 * every grade, how it works, Ask, the devices it runs on, what kids practice, what grown-ups see,
 * the price and the questions, ending in the way in; the platform layout adds the legal footer.
 * Server-rendered and static: no auth wait, nothing on it depends on who is looking. Its words are
 * in src/components/landing/copy.ts; its ink draws itself as it comes into view (inkStart.ts).
 */

const copy = LANDING_COPY.meta;

export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin(process.env.NEXT_PUBLIC_SITE_URL)),
  title: copy.title,
  description: copy.description,
  alternates: { canonical: LANDING_PATH },
  // The app's pages stay out of search (the root layout's noindex); this one page exists to be found
  // by parents, so it opts back in. One line to revert if the owner wants the whole site hidden.
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    url: LANDING_PATH,
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
    <div className={styles.page}>
      <LandingNav />
      <main>
        <Hero />
        <ProblemStrip />
        <HowItWorks />
        <AskDemo />
        <Devices />
        <PracticePicker />
        <GrownUps />
        <Pricing />
        <Questions />
        <Join />
      </main>
      <StickyJoin />
      {/* After every drawing on the page: holds each until it is in view (no hydration needed). */}
      <script dangerouslySetInnerHTML={{ __html: INK_START_SCRIPT }} />
    </div>
  );
}
