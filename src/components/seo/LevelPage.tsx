/**
 * A grade's or a course's page in the math library (`/math/3rd-grade`, `/math/algebra-1`).
 * STUB from the SEO contract (docs/SEO.md): the seo-levels branch replaces this file.
 */
import type { Metadata } from "next";
import type { Level } from "@/lib/seo/routes";

export function levelMetadata(level: Level): Metadata {
  return { title: level.slug };
}

export function LevelPage({ level }: { level: Level }) {
  return <main><h1>{level.slug}</h1></main>;
}
