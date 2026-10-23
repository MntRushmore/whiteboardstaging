/**
 * SAT v2's notes stage (scripts/sat/notes.ts), its pure parts: reading the writer, the mechanical
 * checks (lengths, the lint, the numeric re-check of each mistake), reading the verifier, the merge
 * that keeps only notes passing all three (a failing note is dropped, the question kept), a
 * person's overrides, and the balance read. No model is called. And the checked-in bank: every
 * live question's notes pass the mechanical checks, and the samples carry their hand-written notes.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SatQuestionSchema, type SatQuestion } from "@/lib/sat/contracts";
import { noteIssues, questionIssues } from "@/lib/sat/lint";
import { mistakeCheck } from "../../scripts/sat/cas";
import { applyManual, forVerifier, mechanicalChecks, mergeNotes, parseCandidate, parseVerdict, readBalance } from "../../scripts/sat/notes";
import { notesVerifierPrompt, notesWriterPrompt } from "../../scripts/sat/prompts";

const ROOT = join(__dirname, "..", "..");
const SAMPLE = JSON.parse(readFileSync(join(ROOT, "docs", "sat", "sample-20.json"), "utf8")) as SatQuestion[];
const BANK = JSON.parse(readFileSync(join(ROOT, "data", "sat", "bank.json"), "utf8")) as SatQuestion[];
const bare = (q: SatQuestion): SatQuestion => {
  const { nudge, common_wrong, ...rest } = q;
  void nudge;
  void common_wrong;
  return { ...rest, choices: q.choices ? q.choices.map(({ key, text }) => ({ key, text })) : null, solution: { steps: q.solution.steps, desmos_tip: q.solution.desmos_tip } };
};
const mcq = bare(SAMPLE[0]); // 3x - 7 = 11: A 4/3, B 6 (right), C 18, D 54
const spr = bare(SAMPLE[1]); // 14

describe("the numeric re-check of a mistake", () => {
  it("a check that lands on the choice passes; elsewhere fails; what cannot be read is skipped", () => {
    expect(mistakeCheck("$\\frac{4}{3}$", "(11-7)/3").result).toBe("pass");
    expect(mistakeCheck("$54$", "(11+7)*3").result).toBe("pass");
    expect(mistakeCheck("$54$", "(11+7)/3").result).toBe("fail");
    expect(mistakeCheck("-11", "(5-16)").result).toBe("pass");
    expect(mistakeCheck("33.42", "1170/35").result).toBe("pass");
    expect(mistakeCheck("$2x^2 - 11x - 12$", "2*x^2-8*x-3*x-12").result).toBe("pass");
    expect(mistakeCheck("$2x^2 - 11x - 12$", "2*x^2-5*x-12").result).toBe("fail");
    // a coefficient against an expression, a sentence, no check: skipped (the verifier decides)
    expect(mistakeCheck("$2x^2 - 11x - 12$", "-8-3").result).toBe("skipped");
    expect(mistakeCheck("Exactly one", "1").result).toBe("skipped");
    expect(mistakeCheck("$6$", null).result).toBe("skipped");
  });
});

describe("the writer's notes", () => {
  const raw = {
    id: mcq.id,
    nudge: " What could you do to both sides? ",
    whys: { A: { why: "Subtracted 7 instead of adding it: $3x = 4$.", check: "(11-7)/3" }, b: { why: "On the right one.", check: "6" }, C: { why: "Stopped at $3x = 18$.", check: "11+7" }, D: { why: "Divided by \\dfrac{1}{3}: $18 \\cdot 3$.", check: "(11+7)/3" } },
    common_wrong: [{ answer: "1", why: "nope", check: "1" }],
    desmos_steps: "null",
  };

  it("reads the reply (LaTeX normalized; spr-only notes ignored on an mcq; a 'null' string is null)", () => {
    const c = parseCandidate(mcq, raw);
    expect(c.nudge).toBe("What could you do to both sides?");
    expect(Object.keys(c.whys).sort()).toEqual(["A", "B", "C", "D"]);
    expect(c.whys.D!.why).toBe("Divided by \\frac{1}{3}: $18 \\cdot 3$.");
    expect(c.common_wrong).toEqual([]);
    expect(c.desmos_steps).toBeNull();
    expect(parseCandidate(mcq, { ...raw, desmos_steps: [{ text: "Type it", math: "$y=3x-7$" }] }).desmos_steps).toEqual([{ text: "Type it", math: "y=3x-7" }]);
    expect(parseCandidate(mcq, { ...raw, desmos_steps: [] }).desmos_steps).toBeUndefined();
  });

  it("checks each note mechanically: a why on the right choice, one whose arithmetic lands elsewhere, LaTeX outside the subset", () => {
    const c = parseCandidate(mcq, raw);
    const m = mechanicalChecks(mcq, c);
    expect(m.nudge).toMatchObject({ ok: true });
    expect(m["why A"]).toMatchObject({ ok: true, numeric: "pass" });
    expect(m["why B"]).toMatchObject({ ok: false, reason: expect.stringMatching(/correct choice/) });
    expect(m["why C"]).toMatchObject({ ok: true, numeric: "pass" });
    expect(m["why D"]).toMatchObject({ ok: false, reason: expect.stringMatching(/numeric/) });
    // only what passed goes to the verifier
    expect(forVerifier(c, m)).toEqual({ nudge: c.nudge, whys: { A: c.whys.A!.why, C: c.whys.C!.why } });
    // a leaking nudge, a too-long why
    const leak = mechanicalChecks(mcq, { ...c, nudge: "Is it 6?", whys: { A: { why: "x".repeat(141), check: null } } });
    expect(leak.nudge.ok).toBe(false);
    expect(leak["why A"]).toMatchObject({ ok: false, reason: expect.stringMatching(/longer than 140/) });
  });

  it("a grid-in's common wrong answers: valid, wrong, once, at most 3, arithmetic that lands", () => {
    const c = parseCandidate(spr, {
      id: spr.id,
      nudge: "What could you multiply both sides by?",
      common_wrong: [
        { answer: "6", why: "Multiplied only $x$ by the fraction.", check: "1/(2/3-1/2)" },
        { answer: 14, why: "Right.", check: "14" },
        { answer: "-11", why: "Missed the 5.", check: "5-16" },
        { answer: "-11.0", why: "Same.", check: "5-16" },
        { answer: "26", why: "Missed a 4.", check: "26" },
        { answer: "27", why: "Lands elsewhere.", check: "26" },
      ],
    });
    const m = mechanicalChecks(spr, c);
    expect(m["common_wrong 6"]).toMatchObject({ ok: true, numeric: "pass" });
    expect(m["common_wrong 14"].ok).toBe(false);
    expect(m["common_wrong -11"].ok).toBe(true);
    expect(m["common_wrong -11.0"].reason).toMatch(/listed twice/);
    expect(m["common_wrong 26"].ok).toBe(true);
    expect(m["common_wrong 27"].reason).toMatch(/numeric/);
    // a fourth good one is one too many
    const four = mechanicalChecks(spr, { ...c, common_wrong: [...c.common_wrong.filter((w) => ["6", "-11", "26"].includes(w.answer)), { answer: "2", why: "Another slip.", check: "2" }] });
    expect(four["common_wrong 2"].reason).toMatch(/more than 3/);
  });
});

describe("the verifier and the merge", () => {
  const c = parseCandidate(mcq, {
    nudge: "What could you do to both sides?",
    whys: { A: { why: "Subtracted 7 instead of adding it: $3x = 4$.", check: "(11-7)/3" }, C: { why: "Stopped at $3x = 18$.", check: "11+7" }, D: { why: "Multiplied by 3: $18 \\cdot 3$.", check: "18*3" } },
    desmos_steps: [{ text: "Type both sides.", math: "y=3x-7" }],
  });
  const m = mechanicalChecks(mcq, c);
  const sent = forVerifier(c, m);

  it("reads only the notes that were sent (a missing answer stays missing)", () => {
    const v = parseVerdict({ nudge: { ok: true }, whys: { A: { ok: true, result: "4/3" }, C: { ok: false, reason: "no", result: "18" }, B: { ok: true } }, desmos_steps: { ok: "yes" } }, sent);
    expect(Object.keys(v).sort()).toEqual(["nudge", "why A", "why C"]);
    expect(v["why C"]).toEqual({ ok: false, reason: "no", result: "18" });
  });

  it("keeps a note only when it passed all three; the question keeps its status; old notes are replaced", () => {
    const v = parseVerdict({ nudge: { ok: true, reason: "" }, whys: { A: { ok: true }, C: { ok: false, reason: "lands on 6" } }, desmos_steps: { ok: true } }, sent);
    const withOld: SatQuestion = { ...mcq, nudge: "old", choices: mcq.choices!.map((x) => (x.key === "C" ? { ...x, why: "old" } : x)) };
    const r = mergeNotes(withOld, c, m, v);
    expect(r.q.nudge).toBe(c.nudge);
    expect(r.q.choices!.map((x) => x.why)).toEqual([c.whys.A!.why, undefined, undefined, undefined]);
    expect(r.q.solution.desmos_steps).toEqual(c.desmos_steps);
    expect(r.q.status).toBe("live");
    expect(r.kept.sort()).toEqual(["desmos_steps", "nudge", "why A"]);
    expect(r.dropped).toEqual({ "why C": "verifier: lands on 6", "why D": "verifier: no answer for this note" });
    expect(SatQuestionSchema.safeParse(r.q).success).toBe(true);
    expect(questionIssues(r.q)).toEqual([]);
    // no verifier at all: nothing but a writer's "Desmos does not help" survives
    const none = mergeNotes(withOld, { ...c, desmos_steps: null }, m, null);
    expect(none.q.nudge).toBeUndefined();
    expect(none.q.choices!.every((x) => x.why === undefined)).toBe(true);
    expect(none.q.solution.desmos_steps).toBeNull();
    expect(none.dropped.nudge).toBe("verifier: not run");
    // no notes written: the question, bare
    expect(mergeNotes(withOld, null, {}, null).q).toEqual(mcq);
  });

  it("a person's override drops or replaces a note, and must itself pass the checks", () => {
    const q: SatQuestion = { ...mcq, nudge: "What first?", choices: mcq.choices!.map((x) => (x.key === "A" ? { ...x, why: "Wrong idea." } : x)) };
    const fixed = applyManual(q, { drop: ["nudge"], why: { A: "Subtracted 7 instead of adding it: $3x = 4$." } });
    expect(fixed.nudge).toBeUndefined();
    expect(fixed.choices![0].why).toBe("Subtracted 7 instead of adding it: $3x = 4$.");
    expect(() => applyManual(q, { why: { B: "The right one." } })).toThrow(/fails a check/);
    expect(() => applyManual(q, { drop: ["hint"] })).toThrow(/unknown note/);
  });

  it("the prompts carry the question, its answer and the notes, and nothing random", () => {
    const w = notesWriterPrompt([{ ...mcq, distractors: { A: "Subtracts 7." } }]);
    expect(w).toContain(mcq.id);
    expect(w).toContain("Correct answer: B");
    expect(w).toContain("A: Subtracts 7.");
    expect(notesWriterPrompt([mcq])).toBe(notesWriterPrompt([mcq]));
    const v = notesVerifierPrompt([{ q: mcq, notes: sent }]);
    expect(v).toContain("why A (the student picked A)");
    expect(v).toContain("[type: y=3x-7]");
  });
});

describe("the balance", () => {
  it("is total_credits - total_usage, or null when it cannot be read", async () => {
    const ok = (async () => new Response(JSON.stringify({ data: { total_credits: 90, total_usage: 77.5 } }))) as unknown as typeof fetch;
    expect(await readBalance(ok)).toBe(12.5);
    expect(await readBalance((async () => new Response("{}", { status: 401 })) as unknown as typeof fetch)).toBeNull();
    expect(await readBalance((async () => { throw new Error("offline"); }) as unknown as typeof fetch)).toBeNull();
  });
});

describe("the checked-in notes", () => {
  it("every live question's notes fit the contract and pass the note checks", () => {
    for (const q of BANK.filter((x) => x.status === "live")) {
      expect(SatQuestionSchema.safeParse(q).success, q.id).toBe(true);
      expect(noteIssues(q), q.id).toEqual([]);
    }
  });
  it("the samples carry their hand-written notes into the bank", () => {
    for (const s of SAMPLE) {
      const q = BANK.find((x) => x.id === s.id)!;
      expect(s.nudge, s.id).toBeTruthy();
      expect(q.nudge, s.id).toBe(s.nudge);
      expect(q.choices, s.id).toEqual(s.choices);
      expect(q.common_wrong, s.id).toEqual(s.common_wrong);
      expect(q.solution, s.id).toEqual(s.solution);
    }
  });
});
