import type { Metadata } from "next";
import { KeysPage } from "@/components/keys/KeysPage";
import { daySeed } from "@/lib/keys/generate";

export const metadata: Metadata = {
  title: "Today's practice",
  description: "Today's practice with just a keyboard: two-digit adding, checked step by step.",
};

/**
 * Keys (docs/KEYS.md): Today's practice on a laptop or Chromebook, with only a keyboard. The set is
 * the day's (seeded by the date, here, so the server's page and the browser's agree); `?seed=` picks
 * another set and `?p=26+?6=92|47+38` gives exactly these problems, for QA.
 */
export default async function KeysRoute({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const asked = Number(one(sp.seed));
  const seed = Number.isFinite(asked) && one(sp.seed) ? Math.trunc(asked) : daySeed(new Date());
  return <KeysPage seed={seed} list={one(sp.p) ?? null} />;
}
