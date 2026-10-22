import { SAT_LIMITS, type SatQuestion } from "@/lib/sat/contracts";

/**
 * Checking an answer the way the test does (docs/SAT-MODE.md, "SPR rules").
 *
 * A grid-in (spr) answer is a whole number, a decimal (".75" or "0.75") or a fraction ("3/4"),
 * with an optional leading minus. A positive answer fills at most 5 characters and a negative one
 * at most 6 (the minus counts). Mixed numbers ("1 1/2") are not answers. A decimal must be as
 * precise as the space allows, which is why the bank lists every accepted form (".6666", ".6667",
 * "2/3") instead of comparing values loosely: ".67" is wrong for 2/3. Equal values written another
 * way that the list does not name ("6/8" for "3/4", "1.50" for "1.5") are still right, as they are
 * on the test.
 */

const SPR_RE = /^-?(?:\d+|\d*\.\d+|\d+\/\d+)$/;

/** Is `s` something a student could grid in? (Shape and length only, not whether it is right.) */
export function sprFormatOk(s: string): boolean {
  const t = s.trim();
  if (!SPR_RE.test(t)) return false;
  const max = t.startsWith("-") ? SAT_LIMITS.sprMaxNegative : SAT_LIMITS.sprMaxPositive;
  if (t.length > max) return false;
  if (t.includes("/") && Number(t.split("/")[1]) === 0) return false;
  return true;
}

/** The value of a grid-in answer, or null when it is not one. */
export function sprValue(s: string): number | null {
  const t = s.trim();
  if (!SPR_RE.test(t)) return null;
  if (t.includes("/")) {
    const neg = t.startsWith("-");
    const [a, b] = t.replace(/^-/, "").split("/").map(Number);
    if (!b) return null;
    return (neg ? -1 : 1) * (a / b);
  }
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

/** Is a grid-in answer right? Exactly a listed form, or the same value as a listed fraction / exact form. */
export function isSprCorrect(chosen: string, accepted: readonly string[]): boolean {
  const t = chosen.trim();
  if (!sprFormatOk(t)) return false;
  if (accepted.some((a) => a.trim() === t)) return true;
  const v = sprValue(t);
  if (v === null) return false;
  // the same value as a listed form ("6/8" = "3/4"). Equal, not close: ".66" is not ".6666"
  return accepted.some((a) => {
    const av = sprValue(a);
    return av !== null && Math.abs(av - v) < 1e-9;
  });
}

/** Is `chosen` the right answer to `q`? An mcq compares the key ("b" is "B"). */
export function isCorrect(q: Pick<SatQuestion, "format" | "answer">, chosen: string): boolean {
  if (q.format === "mcq") return "key" in q.answer && chosen.trim().toUpperCase() === q.answer.key;
  return "accepted" in q.answer && isSprCorrect(chosen, q.answer.accepted);
}
