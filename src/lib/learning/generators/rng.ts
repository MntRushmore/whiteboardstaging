/**
 * A small seeded PRNG for practice problems: the same seed gives the same problems, on every
 * device and every run (mulberry32, a 32-bit state; plenty for picking numbers).
 */

export interface Rng {
  /** uniform in [0, 1) */
  next(): number;
  /** a whole number in [lo, hi], both ends included */
  int(lo: number, hi: number): number;
  /** a whole number in [lo, hi] other than those in `not` (lo when every one is excluded) */
  intExcept(lo: number, hi: number, not: readonly number[]): number;
  pick<T>(items: readonly T[]): T;
  /** true with probability p */
  chance(p: number): boolean;
  /** 1 or -1, evenly */
  sign(): 1 | -1;
  /** a shuffled copy */
  shuffle<T>(items: readonly T[]): T[];
}

/** FNV-1a over the string: a stable 32-bit number. */
export function hashText(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A seed from any number (negative, fractional, huge) and a salt (the skill). */
export function seedFrom(seed: number, salt: string): number {
  const s = Number.isFinite(seed) ? String(seed) : "0";
  return hashText(`${salt}:${s}`);
}

export function makeRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number): number => {
    const a = Math.ceil(Math.min(lo, hi));
    const b = Math.floor(Math.max(lo, hi));
    return a + Math.floor(next() * (b - a + 1));
  };
  return {
    next,
    int,
    intExcept(lo, hi, not) {
      const options: number[] = [];
      for (let v = Math.ceil(lo); v <= Math.floor(hi); v++) if (!not.includes(v)) options.push(v);
      return options.length ? options[Math.floor(next() * options.length)] : Math.ceil(lo);
    },
    pick(items) {
      return items[Math.floor(next() * items.length)];
    },
    chance(p) {
      return next() < p;
    },
    sign() {
      return next() < 0.5 ? 1 : -1;
    },
    shuffle(items) {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
  };
}
