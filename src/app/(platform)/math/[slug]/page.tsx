import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LevelPage, levelMetadata } from "@/components/seo/LevelPage";
import { SkillPage, skillMetadata } from "@/components/seo/SkillPage";
import { levelBySlug, mathSlugs, skillBySlug } from "@/lib/seo/routes";

/**
 * The math library's pages (docs/SEO.md): a grade or a course (`/math/3rd-grade`, LevelPage) and a
 * skill (`/math/long-division`, SkillPage) share this one segment; their slugs never collide
 * (src/lib/seo/routes.ts, tested). Every page is built at build time and nothing else answers here.
 */

export const dynamicParams = false;

export function generateStaticParams(): { slug: string }[] {
  return mathSlugs().map((slug) => ({ slug }));
}

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const level = levelBySlug(slug);
  if (level) return levelMetadata(level);
  const skill = skillBySlug(slug);
  return skill ? skillMetadata(skill) : {};
}

export default async function MathPage({ params }: Props) {
  const { slug } = await params;
  const level = levelBySlug(slug);
  if (level) return <LevelPage level={level} />;
  const skill = skillBySlug(slug);
  if (skill) return <SkillPage id={skill} />;
  notFound();
}
