/**
 * The adaptive pick (src/lib/sat/pick.ts): unseen first, no repeat within 30 days unless the bank
 * is exhausted (then the least recently answered), the section's domain mix, weak skills weighted
 * up, difficulty following the domain's last answers, and the request's filters.
 */
import { describe, expect, it } from "vitest";
import { SAT_DOMAINS, SAT_SKILLS, type SatDomain } from "@/lib/sat/contracts";
import { domainQuotas, pickQuestions, skillWeight, targetDifficulty, type BankEntry, type PastAttempt } from "@/lib/sat/pick";

const NOW = Date.parse("2026-10-22T12:00:00Z");
const DAY = 86_400_000;

/** A seeded generator (mulberry32), so every run draws the same. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** n questions per skill and difficulty. */
function bank(n = 2): BankEntry[] {
  const out: BankEntry[] = [];
  for (const d of SAT_DOMAINS)
    for (const s of SAT_SKILLS[d])
      for (const diff of [1, 2, 3])
        for (let i = 0; i < n; i++) out.push({ id: `${d}-${s.slug}-${diff}${String(i).padStart(3, "0")}`, domain: d, skill: s.name, difficulty: diff });
  return out;
}

const NO_FILTER = { domain: null, skill: null, difficulty: null };

describe("pickQuestions", () => {
  it("returns `count` different questions, following the 35/35/15/15 mix", () => {
    const b = bank();
    const counts: Record<SatDomain, number> = { algebra: 0, advanced_math: 0, psda: 0, geometry_trig: 0 };
    for (let seed = 1; seed <= 200; seed++) {
      const ids = pickQuestions({ bank: b, attempts: [], count: 10, filter: NO_FILTER, now: NOW, random: seeded(seed) });
      expect(ids).toHaveLength(10);
      expect(new Set(ids).size).toBe(10);
      for (const id of ids) counts[b.find((q) => q.id === id)!.domain]++;
    }
    const total = 2000;
    expect(counts.algebra / total).toBeCloseTo(0.35, 1);
    expect(counts.advanced_math / total).toBeCloseTo(0.35, 1);
    expect(counts.psda / total).toBeCloseTo(0.15, 1);
    expect(counts.geometry_trig / total).toBeCloseTo(0.15, 1);
  });

  it("never repeats a question answered in the last 30 days while others are left", () => {
    const b = bank(1).filter((q) => q.domain === "algebra"); // 15 questions
    const attempts: PastAttempt[] = b.slice(0, 10).map((q, i) => ({ question_id: q.id, correct: true, created_at: NOW - i * DAY }));
    for (let seed = 1; seed <= 50; seed++) {
      const ids = pickQuestions({ bank: b, attempts, count: 5, filter: NO_FILTER, now: NOW, random: seeded(seed) });
      expect(ids.sort()).toEqual(b.slice(10).map((q) => q.id).sort());
    }
  });

  it("puts unseen questions before ones answered more than 30 days ago", () => {
    const b = bank(1).filter((q) => q.domain === "psda");
    const old = b.slice(0, 15).map((q) => ({ question_id: q.id, correct: false, created_at: NOW - 40 * DAY }));
    const unseen = new Set(b.slice(15).map((q) => q.id));
    const ids = pickQuestions({ bank: b, attempts: old, count: unseen.size, filter: NO_FILTER, now: NOW, random: seeded(7) });
    expect(new Set(ids)).toEqual(unseen);
    // asked for more than are unseen: the rest come from the old ones, never a recent one
    const more = pickQuestions({ bank: b, attempts: old, count: unseen.size + 3, filter: NO_FILTER, now: NOW, random: seeded(7) });
    expect(more.filter((id) => unseen.has(id))).toHaveLength(unseen.size);
  });

  it("when the bank is exhausted, repeats the least recently answered first", () => {
    const b = bank(1).filter((q) => q.domain === "geometry_trig").slice(0, 4);
    const attempts = b.map((q, i) => ({ question_id: q.id, correct: true, created_at: NOW - (i + 1) * DAY }));
    const ids = pickQuestions({ bank: b, attempts, count: 2, filter: NO_FILTER, now: NOW, random: seeded(3) });
    expect(ids.sort()).toEqual([b[2].id, b[3].id].sort());
  });

  it("follows the filters, and asks for no more than the pool holds", () => {
    const b = bank();
    const skill = "linear functions";
    const ids = pickQuestions({ bank: b, attempts: [], count: 10, filter: { domain: "algebra", skill, difficulty: 2 }, now: NOW, random: seeded(1) });
    expect(ids).toHaveLength(2);
    for (const id of ids) expect(b.find((q) => q.id === id)).toMatchObject({ skill, difficulty: 2 });
    const one = pickQuestions({ bank: b, attempts: [], count: 10, filter: { domain: "geometry_trig", skill: null, difficulty: null }, now: NOW, random: seeded(1) });
    expect(one).toHaveLength(10);
    expect(one.every((id) => id.startsWith("geometry_trig-"))).toBe(true);
    expect(pickQuestions({ bank: [], attempts: [], count: 10, filter: NO_FILTER, now: NOW })).toEqual([]);
  });

  it("weights weak skills up", () => {
    const b = bank(4).filter((q) => q.domain === "advanced_math");
    const weak = "nonlinear functions";
    // the student has missed every nonlinear-functions question and got the rest right (all long ago)
    const past: PastAttempt[] = [];
    for (const s of SAT_SKILLS.advanced_math) for (let i = 0; i < 10; i++) past.push({ question_id: `x-${s.slug}-${i}`, correct: s.name !== weak, created_at: NOW - 60 * DAY });
    // those ids are not in the bank: give them metadata by adding them as retired-but-known entries
    const known = past.map((p) => ({ id: p.question_id, domain: "advanced_math" as const, skill: SAT_SKILLS.advanced_math.find((s) => p.question_id.includes(s.slug))!.name, difficulty: 2 }));
    let weakCount = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const ids = pickQuestions({ bank: [...b, ...known], attempts: past, count: 6, filter: { domain: "advanced_math", skill: null, difficulty: null }, now: NOW, random: seeded(seed) });
      weakCount += ids.filter((id) => b.find((q) => q.id === id)?.skill === weak).length;
    }
    // a third of the skills, picked well over a third of the time
    expect(weakCount / 600).toBeGreaterThan(0.45);
  });

  it("aims difficulty at the domain's recent answers", () => {
    const b = bank(6).filter((q) => q.domain === "algebra");
    const hard = b.filter((q) => q.difficulty === 3).slice(0, 10);
    const allRightOnHard = hard.map((q, i) => ({ question_id: q.id, correct: true, created_at: NOW - (40 + i) * DAY }));
    let hardPicked = 0;
    let easyPicked = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const ids = pickQuestions({ bank: b, attempts: allRightOnHard, count: 5, filter: { domain: "algebra", skill: null, difficulty: null }, now: NOW, random: seeded(seed) });
      for (const id of ids) {
        const d = b.find((q) => q.id === id)!.difficulty;
        if (d === 3) hardPicked++;
        if (d === 1) easyPicked++;
      }
    }
    expect(hardPicked).toBeGreaterThan(easyPicked * 3);
  });
});

describe("the weights", () => {
  it("skillWeight: 2 untried, near 1 always right, near 3 always wrong", () => {
    expect(skillWeight(0, 0)).toBe(2);
    expect(skillWeight(20, 20)).toBeLessThan(1.2);
    expect(skillWeight(20, 0)).toBeGreaterThan(2.8);
  });
  it("targetDifficulty: 1.5 to start, up when right, down when wrong, within 1..3", () => {
    expect(targetDifficulty([])).toBe(1.5);
    expect(targetDifficulty(Array(10).fill({ difficulty: 2, correct: true }))).toBe(3);
    expect(targetDifficulty(Array(10).fill({ difficulty: 2, correct: false }))).toBe(1);
    expect(targetDifficulty([...Array(6).fill({ difficulty: 2, correct: true }), ...Array(4).fill({ difficulty: 2, correct: false })])).toBeCloseTo(2);
  });
  it("domainQuotas adds up and follows the shares", () => {
    const q = domainQuotas([...SAT_DOMAINS], 20, seeded(1));
    expect([...q.values()].reduce((s, n) => s + n, 0)).toBe(20);
    expect(q.get("algebra")).toBe(7);
    expect(q.get("psda")).toBe(3);
  });
});
