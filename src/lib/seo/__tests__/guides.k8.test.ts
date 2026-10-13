import { describe, expect, it } from "vitest";
import { GRADE_PATHS, gradeLabel, gradeOfSkill } from "@/lib/learning/grades";
import type { TopicId } from "@/lib/learning/topics";
import { K8_GUIDES } from "../guides/k8";
import { SKILL_IDS, SKILL_SLUGS } from "../routes";
import type { SkillGuide } from "../skillGuide";

/** Every skill on a grade's path, once (a skill on two paths, like negative numbers, counts once). */
const PATH_SKILLS = [...new Set(Object.values(GRADE_PATHS).flat())] as TopicId[];

const entries = Object.entries(K8_GUIDES) as [TopicId, SkillGuide][];

/** A guide's words, every field. */
function allText(g: SkillGuide): string[] {
  return [g.title, g.what, ...g.steps, ...g.slips.flatMap((s) => [s.slip, s.fix]), ...g.faq.flatMap((f) => [f.q, f.a])];
}

/** A text's sentences: a break after . ! or ? (and a closing quote) where the next word does not start in lower case. */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?][”"]?)\s+(?=[^a-z])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ------------------------------------------------------------------ the arithmetic checker

const SUPERSCRIPT: Readonly<Record<string, string>> = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9" };
const SUP = "⁰¹²³⁴⁵⁶⁷⁸⁹";

type Tok = { k: "num"; v: number; whole: boolean } | { k: "frac"; v: number } | { k: "pow"; v: number } | { k: "op"; v: string };

/** One side of a chain as tokens: numbers, fractions (`3/4`, no spaces), mixed numbers (`2 1/4`), `%`, powers, √ and the operators. Null when it is not plain numbers. */
function tokenize(side: string): Tok[] | null {
  const out: Tok[] = [];
  let i = 0;
  let spaced = false;
  while (i < side.length) {
    const ch = side[i];
    if (ch === " ") {
      spaced = true;
      i++;
      continue;
    }
    const frac = /^(\d+)\/(\d+)/.exec(side.slice(i));
    if (frac) {
      const v = Number(frac[1]) / Number(frac[2]);
      const prev = out.at(-1);
      // a mixed number: a whole number, a space, then a fraction ("2 1/4")
      if (prev && prev.k === "num" && prev.whole && spaced) out[out.length - 1] = { k: "num", v: prev.v + v, whole: false };
      else out.push({ k: "frac", v });
      i += frac[0].length;
    } else if (/\d/.test(ch)) {
      const num = /^\d+(?:\.\d+)?/.exec(side.slice(i))![0];
      out.push({ k: "num", v: Number(num), whole: !num.includes(".") });
      i += num.length;
    } else if (ch === "%") {
      const prev = out.at(-1);
      if (!prev || (prev.k !== "num" && prev.k !== "frac")) return null;
      prev.v /= 100;
      i++;
    } else if (SUP.includes(ch)) {
      let digits = "";
      while (i < side.length && SUP.includes(side[i])) digits += SUPERSCRIPT[side[i++]];
      out.push({ k: "pow", v: Number(digits) });
    } else if ("+−×÷/·()√".includes(ch)) {
      out.push({ k: "op", v: ch });
      i++;
    } else return null;
    spaced = false;
  }
  return out;
}

/** The value of a side (operators in the usual order, a number before "(" multiplies it), or null when it does not parse. */
function evaluate(side: string): number | null {
  const toks = tokenize(side);
  if (!toks || toks.length === 0) return null;
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => peek()?.k === "op" && peek()!.v === v;
  const expr = (): number => {
    let v = term();
    while (isOp("+") || isOp("−")) v = (toks[p++].v as string) === "+" ? v + term() : v - term();
    return v;
  };
  const term = (): number => {
    let v = unary();
    for (;;) {
      if (isOp("×") || isOp("·")) {
        p++;
        v *= unary();
      } else if (isOp("÷") || isOp("/")) {
        p++;
        v /= unary();
      } else if (isOp("(") || isOp("√")) v *= unary();
      else return v;
    }
  };
  const unary = (): number => {
    if (isOp("−")) {
      p++;
      return -unary();
    }
    return power();
  };
  const power = (): number => {
    let v = atom();
    while (peek()?.k === "pow") v **= toks[p++].v as number;
    return v;
  };
  const atom = (): number => {
    const t = toks[p++];
    if (!t) throw new Error("end");
    if (t.k === "num" || t.k === "frac") return t.v;
    if (t.k === "op" && t.v === "(") {
      const v = expr();
      if (!isOp(")")) throw new Error("no )");
      p++;
      return v;
    }
    if (t.k === "op" && t.v === "√") return Math.sqrt(power());
    throw new Error(`unexpected ${t.v}`);
  };
  try {
    const v = expr();
    return p === toks.length && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/** A run of plain numbers, operators and "=" (a "." only inside a number). */
const CHAIN = new RegExp(`[0-9(√−](?:[0-9 /+−×÷·()√%=${SUP}]|\\.(?=\\d))*[0-9)%${SUP}]`, "g");

/** A side with the parentheses a sentence put around the chain taken off ("(7 − 4 = 3)"). */
function balanced(side: string): string {
  let s = side.trim();
  const depth = (x: string) => [...x].filter((c) => c === "(").length - [...x].filter((c) => c === ")").length;
  while (depth(s) > 0 && s.startsWith("(")) s = s.slice(1).trim();
  while (depth(s) < 0 && s.endsWith(")")) s = s.slice(0, -1).trim();
  return s;
}

/**
 * Every chain of plain numbers joined by "=" in a text ("6 × 7 = 42", "3/4 + 1/6 = 9/12 + 2/12 =
 * 11/12", "25% of 80 = 20") that does not add up. A chain that is part of something with a letter in
 * it ("x + 5 = 12", "A = 8 × 5 = 40", "= 16π") is not plain numbers and is left alone.
 */
function wrongChains(text: string): string[] {
  const t = text.replace(/(\d)% of /g, "$1% × ");
  const wrong: string[] = [];
  for (const m of t.matchAll(CHAIN)) {
    const chain = m[0];
    if (!chain.includes("=")) continue;
    const before = t.slice(0, m.index);
    const after = t.slice(m.index + chain.length);
    const prev = before.trimEnd().slice(-1);
    // part of a longer expression: an operator before it, a letter or a ratio's colon glued to it
    // ("2x", "x:4 = 5:20"), a minus with a left side ("y − 9 = …")
    if (prev && "+−×÷·/=<>≤≥≠^".includes(prev)) continue;
    if (before.length > 0 && /[\p{L}\d):]/u.test(before.slice(-1))) continue;
    if (chain.startsWith("− ")) continue;
    if (after.length > 0 && /[\p{L}(:]/u.test(after[0])) continue;
    if (/^\s*[+−×÷·/=^]/.test(after)) continue;
    const values = chain.split("=").map((side) => evaluate(balanced(side)));
    if (values.some((v) => v === null)) continue;
    const [first, ...rest] = values as number[];
    if (rest.some((v) => Math.abs(v - first) > 1e-9 * Math.max(1, Math.abs(first)))) wrong.push(chain);
  }
  return wrong;
}

describe("the arithmetic checker", () => {
  it("works out the chains the guides write", () => {
    expect(wrongChains("so 864 ÷ 4 = 216 and 3/4 + 1/6 = 9/12 + 2/12 = 11/12.")).toEqual([]);
    expect(wrongChains("4 3/4 + 2 3/4 = 6 6/4 = 7 1/2, 3² + 4² = 9 + 16 = 25 = 5², √49 = 7, 2(8) + 2(5) = 26")).toEqual([]);
    expect(wrongChains("25% of 80 = 20, then (−4) × (−8) = 32 and 6 ÷ 1/3 = 18 (7 − 4 = 3).")).toEqual([]);
  });

  it("catches a wrong one", () => {
    expect(wrongChains("So 47 + 38 = 75.")).toEqual(["47 + 38 = 75"]);
    expect(wrongChains("1/2 + 1/3 = 2/5")).toEqual(["1/2 + 1/3 = 2/5"]);
    expect(wrongChains("Then 6 × 7 = 42 = 41.")).toEqual(["6 × 7 = 42 = 41"]);
    expect(wrongChains("15% of 80 = 1200")).toEqual(["15% × 80 = 1200"]);
  });

  it("leaves algebra and answers with π alone", () => {
    expect(wrongChains("x + 5 = 12, A = 8 × 5 = 41, y − 9 = −4(x − 3), C = 2 × 3 = 6π, 2x = 11 + 3, x:4 = 5:20")).toEqual([]);
  });
});

// ------------------------------------------------------------------ the guides

describe("K–8 skill guides", () => {
  it("has a guide for every skill on a grade's path, and only those", () => {
    expect(PATH_SKILLS).toHaveLength(37);
    expect(Object.keys(K8_GUIDES).sort()).toEqual([...PATH_SKILLS].sort());
    for (const [id] of entries) expect(gradeOfSkill(id), id).not.toBeNull();
  });

  it("titles each guide with its page's own words, once", () => {
    const titles = entries.map(([, g]) => g.title);
    expect(new Set(titles).size).toBe(titles.length);
    for (const [id, g] of entries) {
      expect(g.title.length, id).toBeLessThanOrEqual(50);
      expect(g.title[0], id).toBe(g.title[0].toUpperCase());
      // the slug's words are all in the title ("two-digit-addition" → "Two-digit addition")
      const words = g.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ");
      for (const w of SKILL_SLUGS[id].split("-")) expect(words, `${id}: ${w}`).toContain(w);
    }
  });

  it("keeps every part to its size", () => {
    for (const [id, g] of entries) {
      const n = sentences(g.what).length;
      expect(n, `${id} what: ${n} sentences`).toBeGreaterThanOrEqual(2);
      expect(n, `${id} what: ${n} sentences`).toBeLessThanOrEqual(4);
      expect(g.steps.length, id).toBeGreaterThanOrEqual(3);
      expect(g.steps.length, id).toBeLessThanOrEqual(6);
      for (const s of g.steps) {
        expect(sentences(s), `${id} step: ${s}`).toHaveLength(1);
        expect(s, id).toMatch(/\.$/);
      }
      expect(g.slips.length, id).toBeGreaterThanOrEqual(2);
      expect(g.slips.length, id).toBeLessThanOrEqual(4);
      for (const { slip, fix } of g.slips) {
        expect(sentences(slip).length, `${id} slip: ${slip}`).toBeLessThanOrEqual(2);
        expect(sentences(fix).length, `${id} fix: ${fix}`).toBeGreaterThanOrEqual(1);
        expect(sentences(fix).length, `${id} fix: ${fix}`).toBeLessThanOrEqual(3);
      }
      expect(g.faq.length, id).toBeGreaterThanOrEqual(2);
      expect(g.faq.length, id).toBeLessThanOrEqual(4);
      for (const { q, a } of g.faq) {
        expect(q, id).toMatch(/\?$/);
        expect(sentences(a).length, `${id} answer: ${a}`).toBeGreaterThanOrEqual(1);
        expect(sentences(a).length, `${id} answer: ${a}`).toBeLessThanOrEqual(3);
      }
    }
  });

  it("answers what grade learns it the way the grade paths have it", () => {
    for (const [id, g] of entries) {
      const first = g.faq[0];
      expect(first.q, id).toMatch(/^What grade learns /);
      expect(first.a.toLowerCase(), id).toContain(gradeLabel(gradeOfSkill(id))!.toLowerCase());
    }
  });

  it("links 2 to 5 other real skills, never itself", () => {
    for (const [id, g] of entries) {
      expect(g.related.length, id).toBeGreaterThanOrEqual(2);
      expect(g.related.length, id).toBeLessThanOrEqual(5);
      expect(new Set(g.related).size, id).toBe(g.related.length);
      expect(g.related, id).not.toContain(id);
      for (const r of g.related) expect(SKILL_IDS, `${id} → ${r}`).toContain(r);
    }
  });

  it("writes plain text with the math in Unicode: no LaTeX, no ASCII stand-ins", () => {
    for (const [id, g] of entries) {
      for (const text of allText(g)) {
        expect(text, id).not.toMatch(/[\\${}]/);
        expect(text, id).not.toMatch(/\*\*|__|`|^#|\[.*\]\(/);
        // − is the minus sign; ^, <=, >=, sqrt and a times x are a keyboard's stand-ins
        expect(text, id).not.toMatch(/\s-\s|\s-\d|\(-|\^|<=|>=|sqrt|\bpi\b|\d \* \d|\d x \d/);
        expect(text, id).toBe(text.trim());
      }
    }
  });

  it("follows the landing page's words: US English, no claims, no prices", () => {
    for (const [id, g] of entries) {
      const text = allText(g).join("\n");
      expect(text, id).not.toMatch(/practis|\bmaths\b|\bticks?\b|\bticked\b|\brings?\b|\bringed\b|ring round|colour|centre|\bbrackets?\b|the way round|favourite/i);
      expect(text, id).not.toMatch(/\b\d[\d,]*\+(?=\s|$|[".,;:!?)])|testimonial|rated|review|trusted by|thousands|millions|#1|best|guarantee|proven|raise[sd]? (their )?grades/i);
      expect(text, id).not.toMatch(/★|⭐|\$|\btrial\b|\bsubscri|per month|\ba month\b|\ba year\b|annual|\bprice of agathon/i);
      // a percent is an outcome number anywhere but in the percents guide's own math
      if (id !== "percents") expect(text, id).not.toMatch(/\d+\s?%/);
    }
  });

  it("names Agathon in at most one answer per guide, and only for what it does", () => {
    for (const [id, g] of entries) {
      const outside = [g.title, g.what, ...g.steps, ...g.slips.flatMap((s) => [s.slip, s.fix])];
      for (const text of outside) expect(text, id).not.toMatch(/Agathon|Help me/);
      expect(g.faq.filter((f) => /Agathon/.test(f.a)).length, id).toBeLessThanOrEqual(1);
      for (const { a } of g.faq) {
        // Help me offers a hint or the next step; never promise it hands out answers
        for (const s of sentences(a).filter((x) => x.includes("Help me"))) expect(s, id).toMatch(/hint|next step/);
      }
    }
  });

  it("does the math right: every chain of plain numbers adds up", () => {
    for (const [id, g] of entries) {
      // a slip shows the wrong work on purpose; everything else must be right
      const right = [g.what, ...g.steps, ...g.slips.map((s) => s.fix), ...g.faq.map((f) => f.a)];
      for (const text of right) expect(wrongChains(text), `${id}: ${text}`).toEqual([]);
    }
  });

  it("writes each guide for its own skill: no sentence shared between guides", () => {
    const seen = new Map<string, TopicId>();
    for (const [id, g] of entries) {
      for (const s of allText(g).flatMap(sentences)) {
        if (s.length < 40) continue;
        const other = seen.get(s);
        expect(other === undefined || other === id, `"${s}" in ${other} and ${id}`).toBe(true);
        seen.set(s, id);
      }
    }
    const questions = entries.flatMap(([, g]) => g.faq.map((f) => f.q));
    expect(new Set(questions).size).toBe(questions.length);
  });
});
