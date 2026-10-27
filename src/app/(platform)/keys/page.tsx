import type { Metadata } from "next";
import { KeysPage } from "@/components/keys/KeysPage";
import { daySeed } from "@/lib/keys/generate";

export const metadata: Metadata = {
  title: "Today's practice",
  description: "Today's practice with just a keyboard: adding, taking away, times, fractions and equations, checked step by step.",
};

/**
 * Keys (docs/KEYS.md): Today's practice on a laptop or Chromebook, with only a keyboard. A signed-in
 * kid gets the day's set from their path and record; signed out, the day's adding set (seeded by the
 * date, here, so the server's page and the browser's agree). For QA: `?seed=` picks another set,
 * `?skill=times_tables` a set of one skill, and `?p=26+?6=92|47+38` exactly these problems.
 */
export default async function KeysRoute({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const asked = Number(one(sp.seed));
  const seeded = Number.isFinite(asked) && Boolean(one(sp.seed));
  const seed = seeded ? Math.trunc(asked) : daySeed(new Date());
  const skill = one(sp.skill) ?? null;
  return <KeysPage seed={seed} list={one(sp.p) ?? null} fixed={seeded || Boolean(skill)} skill={skill} />;
}
