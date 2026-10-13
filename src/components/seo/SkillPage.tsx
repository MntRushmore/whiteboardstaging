/**
 * One skill's page in the math library (`/math/long-division`).
 * STUB from the SEO contract (docs/SEO.md): the seo-skills branch replaces this file.
 */
import type { Metadata } from "next";
import type { TopicId } from "@/lib/learning/topics";

export function skillMetadata(id: TopicId): Metadata {
  return { title: id };
}

export function SkillPage({ id }: { id: TopicId }) {
  return <main><h1>{id}</h1></main>;
}
