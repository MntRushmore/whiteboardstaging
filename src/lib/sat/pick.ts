import { SAT_DOMAIN_SHARE, SAT_DOMAINS, SAT_LIMITS, type SatDomain } from "@/lib/sat/contracts";

/**
 * The adaptive pick behind GET /api/sat/next (docs/SAT-MODE.md): which questions to ask next.
 * Pure: the route hands it the live bank's metadata and the student's answers.
 *
 *  1. The pool is the live bank, narrowed by the request's domain / skill / difficulty.
 *  2. Never repeat within 30 days: each question is in a tier. 0 = never answered, 1 = last answered
 *     more than SAT_LIMITS.noRepeatDays ago, 2 = answered within them. Tier 2 is used only when
 *     tiers 0 and 1 together cannot fill the set (the bank, or the filter, is exhausted), and then
 *     the least recently answered first. Unseen questions always come before seen ones.
 *  3. The mix: with no domain or skill asked for, the set follows the section's mix (35/35/15/15,
 *     SAT_DOMAIN_SHARE) by largest remainder, ties broken at random so sets vary; a domain that
 *     runs out hands its share to the others.
 *  4. Within a domain and tier, a weighted draw without replacement, weight = skill × fit:
 *     - skill: weak skills weighted up, 1 + 2 × (1 − (correct + 1) / (answered + 2)): 1 for a skill
 *       always right, 2 for one never tried, near 3 for one always missed;
 *     - fit: exp(−1.2 × |difficulty − target|), where the domain's target follows its last ~10
 *       answers: their mean difficulty + 2.5 × (accuracy − 0.6), within 1..3 (60% right holds the
 *       level, all right moves up a whole level, 20% right moves down one). No answers yet: 1.5.
 *  5. The chosen set is shuffled.
 */

export type BankEntry = { id: string; domain: SatDomain; skill: string; difficulty: number };
export type PastAttempt = { question_id: string; correct: boolean; created_at: string | number };
export type PickFilter = { domain: SatDomain | null; skill: string | null; difficulty: 1 | 2 | 3 | null };

export type PickInput = {
  bank: readonly BankEntry[];
  attempts: readonly PastAttempt[];
  count: number;
  filter: PickFilter;
  now?: number;
  random?: () => number;
};

const DAY_MS = 86_400_000;
const START_TARGET = 1.5;

const ms = (t: string | number) => (typeof t === "number" ? t : Date.parse(t));

/** Weak skills weighted up (see the header). */
export function skillWeight(answered: number, correct: number): number {
  return 1 + 2 * (1 - (correct + 1) / (answered + 2));
}

/** The difficulty a domain's next questions aim at, from its newest answers (newest first). */
export function targetDifficulty(recent: ReadonlyArray<{ difficulty: number; correct: boolean }>): number {
  const last = recent.slice(0, SAT_LIMITS.recentPerDomain);
  if (!last.length) return START_TARGET;
  const mean = last.reduce((s, a) => s + a.difficulty, 0) / last.length;
  const acc = last.filter((a) => a.correct).length / last.length;
  return Math.min(3, Math.max(1, mean + 2.5 * (acc - 0.6)));
}

/** A weighted draw of `k` items without replacement. */
function drawWeighted<T>(items: readonly T[], weight: (t: T) => number, k: number, random: () => number): T[] {
  const left = items.map((t) => ({ t, w: Math.max(1e-6, weight(t)) }));
  const out: T[] = [];
  while (out.length < k && left.length) {
    const total = left.reduce((s, x) => s + x.w, 0);
    let r = random() * total;
    let i = 0;
    for (; i < left.length - 1; i++) {
      r -= left[i].w;
      if (r <= 0) break;
    }
    out.push(left[i].t);
    left.splice(i, 1);
  }
  return out;
}

function shuffle<T>(items: T[], random: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/** Split `count` across domains by their share (largest remainder, ties at random). */
export function domainQuotas(domains: readonly SatDomain[], count: number, random: () => number): Map<SatDomain, number> {
  const total = domains.reduce((s, d) => s + SAT_DOMAIN_SHARE[d], 0);
  const raw = domains.map((d) => ({ d, x: (count * SAT_DOMAIN_SHARE[d]) / total, tie: random() }));
  const out = new Map(raw.map((r) => [r.d, Math.floor(r.x)]));
  let left = count - [...out.values()].reduce((s, n) => s + n, 0);
  for (const r of [...raw].sort((a, b) => b.x - Math.floor(b.x) - (a.x - Math.floor(a.x)) || a.tie - b.tie)) {
    if (left <= 0) break;
    out.set(r.d, out.get(r.d)! + 1);
    left--;
  }
  return out;
}

/** The ids to ask next, at most `count` (fewer only when the pool itself is smaller). */
export function pickQuestions(input: PickInput): string[] {
  const now = input.now ?? Date.now();
  const random = input.random ?? Math.random;
  const { filter } = input;
  const meta = new Map(input.bank.map((q) => [q.id, q]));

  const pool = input.bank.filter(
    (q) => (!filter.domain || q.domain === filter.domain) && (!filter.skill || q.skill === filter.skill) && (!filter.difficulty || q.difficulty === filter.difficulty),
  );
  const count = Math.max(0, Math.min(input.count, pool.length));
  if (!count) return [];

  // the student's record, newest first
  const attempts = [...input.attempts].filter((a) => Number.isFinite(ms(a.created_at))).sort((a, b) => ms(b.created_at) - ms(a.created_at));
  const lastSeen = new Map<string, number>();
  const skills = new Map<string, { answered: number; correct: number }>();
  const recentByDomain = new Map<SatDomain, Array<{ difficulty: number; correct: boolean }>>();
  for (const a of attempts) {
    if (!lastSeen.has(a.question_id)) lastSeen.set(a.question_id, ms(a.created_at));
    const q = meta.get(a.question_id);
    if (!q) continue; // retired since: not part of the live record
    const s = skills.get(q.skill) ?? { answered: 0, correct: 0 };
    s.answered++;
    if (a.correct) s.correct++;
    skills.set(q.skill, s);
    const r = recentByDomain.get(q.domain) ?? [];
    if (r.length < SAT_LIMITS.recentPerDomain) r.push({ difficulty: q.difficulty, correct: a.correct });
    recentByDomain.set(q.domain, r);
  }

  const cutoff = now - SAT_LIMITS.noRepeatDays * DAY_MS;
  const tierOf = (id: string) => {
    const seen = lastSeen.get(id);
    return seen === undefined ? 0 : seen < cutoff ? 1 : 2;
  };
  const targets = new Map(SAT_DOMAINS.map((d) => [d, targetDifficulty(recentByDomain.get(d) ?? [])]));
  const weight = (q: BankEntry) => {
    const s = skills.get(q.skill) ?? { answered: 0, correct: 0 };
    return skillWeight(s.answered, s.correct) * Math.exp(-1.2 * Math.abs(q.difficulty - targets.get(q.domain)!));
  };

  // tiers 0 and 1 per domain (tier 0 first); tier 2 kept aside for an exhausted bank
  const fresh = new Map<SatDomain, { t0: BankEntry[]; t1: BankEntry[] }>();
  const recent: BankEntry[] = [];
  for (const q of pool) {
    const tier = tierOf(q.id);
    if (tier === 2) {
      recent.push(q);
      continue;
    }
    const f = fresh.get(q.domain) ?? { t0: [], t1: [] };
    (tier === 0 ? f.t0 : f.t1).push(q);
    fresh.set(q.domain, f);
  }

  const chosen: BankEntry[] = [];
  const freshTotal = [...fresh.values()].reduce((s, f) => s + f.t0.length + f.t1.length, 0);
  let want = Math.min(count, freshTotal);
  let domains = SAT_DOMAINS.filter((d) => fresh.has(d));
  // a set within one domain (or one skill) takes all of it from there
  while (want > 0 && domains.length) {
    const quotas = filter.domain || filter.skill ? new Map(domains.map((d) => [d, want])) : domainQuotas(domains, want, random);
    for (const d of domains) {
      const f = fresh.get(d)!;
      const k = Math.min(quotas.get(d) ?? 0, want);
      const fromT0 = drawWeighted(f.t0, weight, k, random);
      const fromT1 = drawWeighted(f.t1, weight, k - fromT0.length, random);
      for (const q of [...fromT0, ...fromT1]) {
        chosen.push(q);
        f.t0 = f.t0.filter((x) => x !== q);
        f.t1 = f.t1.filter((x) => x !== q);
      }
      want -= fromT0.length + fromT1.length;
    }
    // what a domain could not give is shared among those with questions left
    domains = domains.filter((d) => fresh.get(d)!.t0.length + fresh.get(d)!.t1.length > 0);
  }

  // the bank is exhausted: the least recently answered of the last 30 days
  if (chosen.length < count) {
    recent.sort((a, b) => (lastSeen.get(a.id) ?? 0) - (lastSeen.get(b.id) ?? 0));
    chosen.push(...recent.slice(0, count - chosen.length));
  }

  return shuffle(chosen.map((q) => q.id), random);
}
