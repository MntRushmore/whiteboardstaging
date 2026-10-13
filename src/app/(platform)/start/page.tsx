import type { Metadata } from "next";
import { HandMath } from "@/components/landing/HandMath";
import { InkCheck } from "@/components/landing/InkMark";
import { StartFlow } from "@/components/start/StartFlow";
import { siteOrigin } from "@/lib/landing/links";
import { START_PATH } from "@/lib/start/contracts";

/**
 * /start (2026-10-13, docs/START-FLOW.md): the new onboarding, before the account. Every Join Agathon
 * goes here. A few questions, one per screen, the try board, the plan, then the account; the
 * flow is the client's (`StartFlow`). The first screen is in the server's HTML, with its two cards'
 * ink written here in the board's hand, so the page paints at once; the rest of the handwriting comes
 * from the static `GET /api/start/ink` after the first answer.
 */
export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin(process.env.NEXT_PUBLIC_SITE_URL)),
  title: { absolute: "Make a math plan · Agathon" },
  description: "A few quick questions, a problem to try, and a math plan for your kid, before you make an account.",
  alternates: { canonical: START_PATH },
  // a step of sign-up, not a page to land on from search
  robots: { index: false, follow: true },
};

export default function StartPage() {
  return (
    <StartFlow
      motifs={{
        parent: <InkCheck pen={2.6} />,
        kid: <HandMath latex="2 + 3" ink="kid" size={64} seed={4} pen={4.5} />,
      }}
    />
  );
}
