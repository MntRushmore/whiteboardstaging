import type { Metadata } from "next";
import { LANDING_COPY } from "@/components/landing/copy";
import { Closing } from "@/components/landing/Closing";
import { GrownUps } from "@/components/landing/GrownUps";
import { Hero } from "@/components/landing/Hero";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { LandingNav } from "@/components/landing/LandingNav";
import { PracticePicker } from "@/components/landing/PracticePicker";
import { Pricing } from "@/components/landing/Pricing";
import { Questions } from "@/components/landing/Questions";
import { LANDING_PATH, siteOrigin } from "@/lib/landing/links";
import styles from "@/components/landing/landing.module.css";

/**
 * /parents: the page a signed-out visitor lands on (a signed-out `/` comes here, query kept), and
 * the link parents send each other. What Agathon is, how it works, what kids practise, what
 * grown-ups see, the price and the questions, ending in the way in; the platform layout adds the
 * legal footer. Server-rendered and static: no auth wait, nothing on it depends on who is looking.
 * Its words are in src/components/landing/copy.ts.
 */

const copy = LANDING_COPY.meta;

export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin(process.env.NEXT_PUBLIC_SITE_URL)),
  title: copy.title,
  description: copy.description,
  alternates: { canonical: LANDING_PATH },
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
        <HowItWorks />
        <PracticePicker />
        <GrownUps />
        <Pricing />
        <Questions />
        <Closing />
      </main>
    </div>
  );
}
