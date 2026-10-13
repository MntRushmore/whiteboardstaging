/**
 * The words of a skill's page in the math library (`/math/long-division`, docs/SEO.md): what the
 * skill is, how to do it, the slips kids make and the questions parents ask. Written by hand for
 * each skill: this is what makes each page worth reading (and quoting), next to the worked example
 * and the practice set the app's own generators write.
 *
 * Plain text only, with the math in Unicode (×, ÷, −, ², √, ≤) so that every reader, a search
 * engine, an AI answer engine or a screen reader, reads it the way a parent would. US English.
 *
 * K–8 skills (any skill on a grade's path) are in guides/k8.ts, the high-school ones in guides/hs.ts.
 */
import type { TopicId } from "@/lib/learning/topics";
import { HS_GUIDES } from "./guides/hs";
import { K8_GUIDES } from "./guides/k8";

export interface SkillGuide {
  /** The words a parent searches for, used in the h1 and the title: "Long division", "Adding fractions with unlike denominators". */
  title: string;
  /** One paragraph (2–4 sentences): what the skill is and why it matters, plain enough for a kid to follow. */
  what: string;
  /** How to do it, in order: 3–6 short steps, each one sentence. */
  steps: string[];
  /** The slips kids make with this skill (2–4), each with how to spot and fix it. */
  slips: { slip: string; fix: string }[];
  /** Questions parents ask about this skill (2–4), each answered in 1–3 sentences. */
  faq: { q: string; a: string }[];
  /** 2–5 other skills to link: what comes before it and what comes after. */
  related: TopicId[];
}

/** Every skill's guide that is written so far (all of them once both guide files are in). */
export const SKILL_GUIDES: Readonly<Partial<Record<TopicId, SkillGuide>>> = { ...K8_GUIDES, ...HS_GUIDES };

export function skillGuide(id: TopicId): SkillGuide | null {
  return SKILL_GUIDES[id] ?? null;
}
