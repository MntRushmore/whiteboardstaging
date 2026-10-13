import { LANDING_COPY } from "@/components/landing/copy";
import { CARD_SIZE, CARD_TYPE, mathCard } from "@/components/seo/mathCard";

/**
 * The share card of the math library's hub (`/math`, docs/SEO.md): "Math practice for kids", three
 * problems from three grades written by hand and checked, and "Kindergarten to 8th grade". The
 * problems are the landing page's strip's, whose test holds every one of them right.
 */

export const runtime = "nodejs";
export const alt = "Agathon's math library: math practice for kids from kindergarten to 8th grade, with problems written by hand and checked.";
export const size = CARD_SIZE;
export const contentType = CARD_TYPE;

/** Kindergarten's, 3rd grade's and 6th grade's problems from the landing page's strip. */
const ROW: string[] = ["K", "3rd", "6th"].flatMap((grade) => LANDING_COPY.strip.items.filter((item) => item.grade === grade).map((item): string => item.latex));

export default async function MathHubOpenGraphImage() {
  return mathCard({ eyebrow: LANDING_COPY.hero.eyebrow, title: "Math practice for kids", row: ROW });
}
