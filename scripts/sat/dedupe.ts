/**
 * Near-duplicate stems (scripts/sat/pipeline.ts): two questions of the same skill whose stems,
 * with every number and every math expression blanked, share most of their word pairs are the same
 * question with new numbers, and two built on the same equation are the same question however they
 * are worded. The later one (in bank order) is dropped to draft.
 */

/** The stem's word pairs, numbers and math blanked ("a bakery sells # muffins …"). */
export function shingles(stem: string): Set<string> {
  const words = stem
    .toLowerCase()
    .replace(/\$\$[\s\S]*?\$\$|\$[^$]*\$/g, " M ")
    .replace(/\d+(\.\d+)?/g, " # ")
    .replace(/[^a-z#\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + 1 < words.length; i++) out.add(`${words[i]} ${words[i + 1]}`);
  if (words.length === 1) out.add(words[0]);
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  let both = 0;
  for (const x of a) if (b.has(x)) both++;
  return both / (a.size + b.size - both);
}

export const NEAR_DUPLICATE = 0.8;

/**
 * The stem's substantial math (an equation or expression of 7+ characters, spaces removed): two
 * questions of a skill built on the same equation are the same question, however they are worded.
 */
export function mathOf(stem: string): Set<string> {
  const out = new Set<string>();
  for (const m of stem.matchAll(/\$\$([\s\S]+?)\$\$|\$([^$]+?)\$/g)) {
    const t = (m[1] ?? m[2]).replace(/\s+/g, "");
    if (t.length >= 7 && /[=<>]|\\le|\\ge/.test(t)) out.add(t);
  }
  return out;
}

/**
 * For each question, the id of an earlier one of the same skill it nearly duplicates, or nothing.
 * Short stems (under 6 word pairs: "Solve $…$.") compare their math too, since the words alone say little.
 */
export function nearDuplicates(items: ReadonlyArray<{ id: string; skill: string; stem: string }>): Map<string, string> {
  const out = new Map<string, string>();
  const seen: Array<{ id: string; skill: string; sh: Set<string>; raw: string; math: Set<string> }> = [];
  for (const it of items) {
    const sh = shingles(it.stem);
    const raw = it.stem.replace(/\s+/g, " ").trim().toLowerCase();
    const math = mathOf(it.stem);
    const twin = seen.find(
      (s) => s.skill === it.skill && (s.raw === raw || (sh.size >= 6 && jaccard(s.sh, sh) >= NEAR_DUPLICATE) || [...math].some((m) => s.math.has(m))),
    );
    if (twin) out.set(it.id, twin.id);
    seen.push({ id: it.id, skill: it.skill, sh, raw, math });
  }
  return out;
}
