import { notFound } from "next/navigation";
import { CARD_SIZE, CARD_TYPE, mathCard } from "@/components/seo/mathCard";
import { cardWords } from "@/lib/seo/levels";
import { mathSlugs } from "@/lib/seo/routes";

/**
 * The share card of every `/math/[slug]` page, a grade or course and a skill alike (docs/SEO.md):
 * the page's name, a sample problem in the board's hand, and "Agathon" (src/components/seo/mathCard.tsx).
 * Built at build time for every slug the route answers.
 */

export const runtime = "nodejs";
export const dynamicParams = false;
export const alt = "A page of Agathon's math library: its name and a sample problem, written by hand on a whiteboard.";
export const size = CARD_SIZE;
export const contentType = CARD_TYPE;

export function generateStaticParams(): { slug: string }[] {
  return mathSlugs().map((slug) => ({ slug }));
}

export default async function MathOpenGraphImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const words = cardWords(slug);
  if (!words) notFound();
  return mathCard({ eyebrow: words.eyebrow, title: words.title, problem: words.problem });
}
