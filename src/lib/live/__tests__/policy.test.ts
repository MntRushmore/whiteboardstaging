import { describe, expect, it } from "vitest";
import { HELP_MODES, type EngineVerdict, type HelpMode, type LineAnalysis, type LineKind } from "../contracts";
import { badgeFor, decide, isAnswerStart, isLoneRelation, isSingleSymbolLatex, localNoteFor, unjudgedReason, type PolicyInput } from "../policy";

function analysis(verdict: EngineVerdict, kind: LineKind = "equation", extra: Partial<LineAnalysis> = {}): LineAnalysis {
  return { kind, math: "2x+3=11", resultLatex: "", verdict, note: "", ...extra };
}

function input(over: Partial<PolicyInput> = {}): PolicyInput {
  return {
    mode: "suggest",
    analysis: analysis("ok"),
    confidence: 0.95,
    settled: false,
    auto: true,
    userAsked: false,
    hintsShownForLine: 0,
    openHintCount: 0,
    rewritesWithWarn: 0,
    liveShapeCount: 0,
    ...over,
  };
}

describe("decide — echo", () => {
  it("is silent for labels, incomplete lines and low confidence", () => {
    expect(decide(input({ analysis: analysis("none", "label") })).echo).toBe(false);
    expect(decide(input({ analysis: analysis("none", "incomplete") })).echo).toBe(false);
    expect(decide(input({ confidence: 0.59 })).echo).toBe(false);
    expect(decide(input({ confidence: 0.6 })).echo).toBe(true);
  });
  it("echoes in every mode including off", () => {
    for (const mode of HELP_MODES) expect(decide(input({ mode })).echo).toBe(true);
  });
});

describe("decide — badge table", () => {
  const verdicts: EngineVerdict[] = ["ok", "mismatch", "unknown", "none"];
  const expected: Record<EngineVerdict, string> = { ok: "ok", mismatch: "warn", unknown: "none", none: "none" };
  for (const mode of HELP_MODES) {
    for (const v of verdicts) {
      it(`${mode} x ${v}`, () => {
        const d = decide(input({ mode, analysis: analysis(v) }));
        expect(d.badge).toBe(mode === "off" ? "none" : expected[v]);
      });
    }
  }
  it("solved wins", () => {
    expect(decide(input({ analysis: analysis("ok", "equation", { solved: true }) })).badge).toBe("solved");
    expect(badgeFor("off", analysis("ok", "equation", { solved: true }))).toBe("none");
  });
  it("never warns from unknown", () => {
    expect(decide(input({ mode: "answer", analysis: analysis("unknown") })).badge).toBe("none");
  });
});

describe("decide — runLlmCheck ladder", () => {
  // Auto on: an unknown line is checked once the student has paused (the settle), not on a
  // per-line timer — so a read that lands after the pause is due at once.
  const cases: Array<[HelpMode, EngineVerdict, boolean, boolean, number, boolean]> = [
    // mode, verdict, settled, userAsked, hintsShown, expected
    ["off", "mismatch", true, true, 0, false],
    ["off", "unknown", true, false, 0, false],
    ["feedback", "mismatch", false, false, 0, false],
    ["feedback", "mismatch", false, true, 0, true],
    ["feedback", "unknown", false, false, 0, false],
    ["feedback", "unknown", true, false, 0, true],
    ["feedback", "ok", true, false, 0, false],
    // a mismatch the engine found is ringed and answered locally: no model hint
    ["suggest", "mismatch", false, false, 0, false],
    ["suggest", "mismatch", true, false, 1, false],
    ["suggest", "mismatch", false, true, 1, true],
    ["suggest", "unknown", true, false, 0, true],
    ["suggest", "ok", true, false, 0, false],
    ["answer", "mismatch", true, false, 0, false],
    ["answer", "unknown", false, false, 0, false],
    ["answer", "unknown", true, false, 0, true],
  ];
  for (const [mode, verdict, settled, userAsked, hintsShownForLine, expected] of cases) {
    it(`${mode} ${verdict} settled=${settled} asked=${userAsked} hints=${hintsShownForLine} -> ${expected}`, () => {
      const d = decide(input({ mode, analysis: analysis(verdict), settled, userAsked, hintsShownForLine }));
      expect(d.runLlmCheck).toBe(expected);
    });
  }

  it("never calls the LLM in off mode for any combination", () => {
    for (const verdict of ["ok", "mismatch", "unknown", "none"] as EngineVerdict[]) {
      for (const userAsked of [true, false]) {
        expect(decide(input({ mode: "off", analysis: analysis(verdict), userAsked, settled: true })).runLlmCheck).toBe(false);
      }
    }
  });

  it("only checks unknown lines of checkable kinds", () => {
    expect(decide(input({ mode: "feedback", analysis: analysis("unknown", "text"), settled: true })).runLlmCheck).toBe(false);
    expect(decide(input({ mode: "feedback", analysis: analysis("unknown", "chem"), settled: true })).runLlmCheck).toBe(false);
    expect(decide(input({ mode: "feedback", analysis: analysis("unknown", "expression"), settled: true })).runLlmCheck).toBe(true);
  });

  it("a line with nothing to judge (a first line, `2 + 3`) is read back, never sent to a model", () => {
    for (const kind of ["equation", "expression"] as const) {
      const d = decide(input({ mode: "feedback", analysis: analysis("none", kind), settled: true }));
      expect(d.echo).toBe(true);
      expect(d.runLlmCheck).toBe(false);
    }
  });

  it("does not check silent lines even in suggest", () => {
    expect(decide(input({ analysis: analysis("mismatch", "incomplete") })).runLlmCheck).toBe(false);
    expect(decide(input({ confidence: 0.3, analysis: analysis("mismatch") })).runLlmCheck).toBe(false);
  });
});

describe("decide — results, hints, steps, chem, cap", () => {
  const calc = analysis("none", "expression", { math: "3.2*4.5", resultLatex: "14.4" });
  const trailing = analysis("none", "expression", { math: "3+4=", resultLatex: "7" });

  it("shows calculator results in every mode, but only once the student has settled", () => {
    for (const mode of HELP_MODES) {
      expect(decide(input({ mode, analysis: calc, settled: true })).showResult).toBe(true);
      expect(decide(input({ mode, analysis: calc, settled: false })).showResult).toBe(false);
    }
  });

  it("answers a trailing `=` in Solve only, and only once settled", () => {
    expect(decide(input({ mode: "answer", analysis: trailing, settled: false })).showResult).toBe(false);
    expect(decide(input({ mode: "answer", analysis: trailing, settled: true })).showResult).toBe(true);
  });

  it("never hands over a bare answer in Feedback or Suggest, however long the student waits", () => {
    for (const mode of ["off", "feedback", "suggest"] as const) {
      for (const settled of [false, true]) {
        for (const userAsked of [false, true]) {
          const d = decide(input({ mode, analysis: trailing, settled, userAsked }));
          expect(d.showResult).toBe(false);
        }
      }
    }
  });

  it("an explicit ask bypasses the settle wait but not the mode gate", () => {
    expect(decide(input({ mode: "answer", analysis: trailing, settled: false, userAsked: true })).showResult).toBe(true);
    expect(decide(input({ mode: "feedback", analysis: calc, settled: false, userAsked: true })).showResult).toBe(true);
    expect(decide(input({ mode: "suggest", analysis: trailing, settled: false, userAsked: true })).showResult).toBe(false);
  });

  it("settling never turns a silent line into a spoken one", () => {
    // the settle gate only ever *permits* a result; it cannot create an echo, a badge or a check
    const silent = input({ analysis: analysis("mismatch", "incomplete"), settled: true });
    expect(decide(silent).echo).toBe(false);
    expect(decide(silent).showResult).toBe(false);
    for (const settled of [false, true]) {
      const d = decide(input({ mode: "suggest", analysis: analysis("mismatch"), settled }));
      expect(d.badge).toBe("warn");
      expect(d.allowHint).toBe(true);
      expect(d.runLlmCheck).toBe(false);
    }
  });

  it("allows one hint per line in suggest/answer only, and none while a card is open", () => {
    expect(decide(input({ mode: "feedback" })).allowHint).toBe(false);
    expect(decide(input({ mode: "suggest" })).allowHint).toBe(true);
    expect(decide(input({ mode: "answer" })).allowHint).toBe(true);
    expect(decide(input({ mode: "suggest", hintsShownForLine: 1 })).allowHint).toBe(false);
    expect(decide(input({ mode: "suggest", openHintCount: 1 })).allowHint).toBe(false);
  });

  it("steps only in answer mode on an explicit tap", () => {
    expect(decide(input({ mode: "answer", userAsked: true })).allowSteps).toBe(true);
    expect(decide(input({ mode: "answer", userAsked: false })).allowSteps).toBe(false);
    expect(decide(input({ mode: "suggest", userAsked: true })).allowSteps).toBe(false);
  });

  it("reveals chem balance only in answer mode", () => {
    expect(decide(input({ mode: "answer" })).revealChemBalance).toBe(true);
    expect(decide(input({ mode: "suggest" })).revealChemBalance).toBe(false);
  });

  it("offers a hint prompt after two rewrites with warn", () => {
    expect(decide(input({ rewritesWithWarn: 1 })).offerHintPrompt).toBe(false);
    expect(decide(input({ rewritesWithWarn: 2 })).offerHintPrompt).toBe(true);
    expect(decide(input({ mode: "off", rewritesWithWarn: 5 })).offerHintPrompt).toBe(false);
  });

  it("caps at 60 live shapes: echo only", () => {
    const d = decide(input({ liveShapeCount: 60, analysis: analysis("mismatch") }));
    expect(d.capped).toBe(true);
    expect(d.echo).toBe(true);
    expect(d.badge).toBe("none");
    expect(d.runLlmCheck).toBe(false);
    expect(d.allowHint).toBe(false);
  });
});

describe("decide — the Auto switch", () => {
  const helpModes = ["feedback", "suggest", "answer"] as const;
  const trailing = analysis("none", "expression", { math: "3+4=", resultLatex: "7" });
  const calc = analysis("none", "expression", { math: "3.2*4.5", resultLatex: "14.4" });

  it("Auto on: ticks and rings at once, answers and model checks at the pause, in every help mode", () => {
    for (const mode of helpModes) {
      expect(decide(input({ mode, analysis: analysis("ok") })).badge).toBe("ok");
      expect(decide(input({ mode, analysis: analysis("mismatch") })).badge).toBe("warn");
      expect(decide(input({ mode, analysis: analysis("unknown"), settled: true })).runLlmCheck).toBe(true);
      expect(decide(input({ mode, analysis: calc, settled: true })).showResult).toBe(true);
    }
    expect(decide(input({ mode: "answer", analysis: trailing, settled: true })).showResult).toBe(true);
  });

  it("Auto off: the line is still read back, but nothing unasked — no mark, no answer, no model, no hint", () => {
    for (const mode of helpModes) {
      for (const verdict of ["ok", "mismatch", "unknown", "none"] as EngineVerdict[]) {
        const d = decide(input({ mode, analysis: analysis(verdict), settled: true, auto: false }));
        expect(d.echo, `${mode} ${verdict}`).toBe(true);
        expect(d.badge, `${mode} ${verdict}`).toBe("none");
        expect(d.runLlmCheck, `${mode} ${verdict}`).toBe(false);
        expect(d.allowHint, `${mode} ${verdict}`).toBe(false);
      }
      expect(decide(input({ mode, analysis: calc, settled: true, auto: false })).showResult).toBe(false);
    }
    expect(decide(input({ mode: "answer", analysis: trailing, settled: true, auto: false })).showResult).toBe(false);
    const chem = analysis("mismatch", "chem", { chem: { balanced: false, balancedLatex: "2H_2+O_2" } });
    expect(decide(input({ mode: "answer", analysis: chem, auto: false })).revealChemBalance).toBe(false);
  });

  it("Auto off, asked: the tap marks, answers and checks as Auto would have", () => {
    for (const mode of helpModes) {
      const asked = (a: LineAnalysis) => decide(input({ mode, analysis: a, auto: false, userAsked: true }));
      expect(asked(analysis("ok")).badge).toBe("ok");
      expect(asked(analysis("mismatch")).badge).toBe("warn");
      expect(asked(analysis("unknown")).runLlmCheck).toBe(true);
    }
    expect(decide(input({ mode: "answer", analysis: trailing, auto: false, userAsked: true })).showResult).toBe(true);
    // the mode gate still holds: asking in Feedback asks for feedback, not the answer
    expect(decide(input({ mode: "feedback", analysis: trailing, auto: false, userAsked: true })).showResult).toBe(false);
  });

  it("Off mode is the same whichever way the switch is (the switch is not shown there)", () => {
    for (const a of [analysis("ok"), analysis("mismatch"), calc]) {
      for (const settled of [false, true]) {
        const on = decide(input({ mode: "off", analysis: a, settled, auto: true }));
        const off = decide(input({ mode: "off", analysis: a, settled, auto: false }));
        expect(off).toEqual(on);
      }
    }
  });
});

describe("localNoteFor", () => {
  it("phrases chemistry by mode and never in off", () => {
    const chem = analysis("mismatch", "chem", { chem: { balanced: false, balancedLatex: "4Fe+3O_2" }, note: "Not balanced yet" });
    expect(localNoteFor(chem, "off")).toBe("");
    expect(localNoteFor(chem, "suggest")).toBe("Count the atoms on each side");
    expect(localNoteFor(chem, "answer")).toBe("Not balanced yet");
    const units = analysis("mismatch", "expression", { units: { ok: false }, note: "" });
    expect(localNoteFor(units, "feedback")).toBe("These units don't add together");
  });
});

describe("decide — silent kinds and lone symbols (B2/B8)", () => {
  it("is silent for prose ('text') lines", () => {
    const d = decide(input({ mode: "feedback", analysis: analysis("ok", "text") }));
    expect(d.echo).toBe(false);
    expect(d.badge).toBe("none");
    expect(d.runLlmCheck).toBe(false);
  });

  it("is silent for a lone Greek letter, a single character or decorations only", () => {
    for (const latex of ["\\Delta", "\\theta", "\\triangle", "x", "5", "\\checkmark", "\\text { I }", "\\mathrm{I}", "\\cdots", "\\rightarrow", "-", "="]) {
      expect(isSingleSymbolLatex(latex), latex).toBe(true);
      const d = decide(input({ analysis: analysis("ok", "expression"), latex }));
      expect(d.echo, latex).toBe(false);
      expect(d.badge, latex).toBe("none");
    }
  });

  it("still echoes real math, including lines that start with a Greek letter", () => {
    for (const latex of ["2x+3=11", "x^{2}", "\\Delta x = 5", "\\pi r^{2}", "3.2 \\mathrm{~kg} \\cdot 9.8", "y=x^{2}-4", "\\frac{1}{2}", "ab", "12"]) {
      expect(isSingleSymbolLatex(latex), latex).toBe(false);
      expect(decide(input({ latex })).echo, latex).toBe(true);
    }
  });

  it("treats an undefined latex as not-a-lone-symbol (kind decides)", () => {
    expect(decide(input({ latex: undefined })).echo).toBe(true);
    expect(decide(input({ latex: "" })).echo).toBe(true);
  });
});

describe("unjudgedReason — a line the tutor read but cannot judge", () => {
  const line = (latex: string, kind: LineKind | null = "equation", verdict: EngineVerdict = "ok", over: { confidence?: number; provider?: string } = {}) => ({
    latex,
    confidence: over.confidence ?? 0.97,
    provider: over.provider ?? "mathpix",
    analysis: kind ? analysis(verdict, kind) : null,
  });

  it("a lone number or symbol, a label, half a line, prose, LaTeX the engine cannot read: unjudged", () => {
    expect(unjudgedReason(line("2", "label", "none"))).toBe("unjudged");
    expect(unjudgedReason(line("2", "expression", "none"))).toBe("unjudged");
    expect(unjudgedReason(line("\\Delta", "unknown", "unknown"))).toBe("unjudged");
    expect(unjudgedReason(line("2x", "label", "none"))).toBe("unjudged");
    expect(unjudgedReason(line("\\sin x =", "incomplete", "none"))).toBe("unjudged");
    expect(unjudgedReason(line("\\text{help}", "text", "none"))).toBe("unjudged");
    expect(unjudgedReason(line("x^{2} \\|", "unknown", "unknown"))).toBe("unjudged");
  });

  it("a read that failed, came back empty or unsure: unread", () => {
    expect(unjudgedReason(line("", "unknown", "unknown", { provider: "none" }))).toBe("unread");
    expect(unjudgedReason(line("", null))).toBe("unread");
    expect(unjudgedReason(line("2x = 8", "equation", "ok", { confidence: 0.3 }))).toBe("unread");
  });

  it("judgeable, whatever its verdict; nothing to say about a line not read or not analysed yet", () => {
    expect(unjudgedReason(line("2x = 8"))).toBeNull();
    expect(unjudgedReason(line("x = 5", "equation", "mismatch"))).toBeNull();
    // a model check is coming for it
    expect(unjudgedReason(line("2x + y = 8", "equation", "unknown"))).toBeNull();
    // readable maths with nothing to compare
    expect(unjudgedReason(line("x = 6", "assignment", "none"))).toBeNull();
    expect(unjudgedReason(line("", null, "none", { provider: "none" }))).toBeNull();
    expect(unjudgedReason(line("2x = 8", null))).toBeNull();
  });

  it("an `=` on its own is an answer being started: no ? while its number is still to come", () => {
    expect(unjudgedReason(line("=", "incomplete", "none"))).toBeNull();
    expect(unjudgedReason(line(" = ", "incomplete", "none"))).toBeNull();
    expect(unjudgedReason(line("<", "unknown", "unknown"))).toBeNull();
    expect(unjudgedReason(line("\\geq", "unknown", "unknown"))).toBeNull();
    expect(unjudgedReason(line("=", "incomplete", "none", { confidence: 0.4 }))).toBeNull();
    // ...and so is a negative answer's start: a minus, `= -`
    expect(unjudgedReason(line("-", "unknown", "unknown"))).toBeNull();
    expect(unjudgedReason(line("=-", "incomplete", "none"))).toBeNull();
    expect(unjudgedReason(line("= -", "incomplete", "none"))).toBeNull();
    // ...once the number is there it is judged as ever
    expect(unjudgedReason(line("= 7", "expression", "none"))).toBeNull();
    expect(unjudgedReason(line("3 =", "incomplete", "none"))).toBe("unjudged");
    expect(unjudgedReason(line("- -", "unknown", "unknown"))).toBe("unjudged");
  });
});

describe("isLoneRelation / isAnswerStart", () => {
  it("a relation and nothing else", () => {
    for (const s of ["=", " = ", "{=}", "<", ">", "\\le", "\\geq", "\\neq", "\\approx", "\\text{=}"]) expect(isLoneRelation(s), s).toBe(true);
    for (const s of ["", "-", "==7", "= 7", "x =", "\\leq 3", "\\sim", "\\lessdot"]) expect(isLoneRelation(s), s).toBe(false);
  });

  it("an answer's signs, its number still to come", () => {
    for (const s of ["=", "-", " - ", "=-", "= -", "\\ge -", "<-"]) expect(isAnswerStart(s), s).toBe(true);
    for (const s of ["", "-3", "=-3", "--", "-=", "x-", "= 7", "\\backslash"]) expect(isAnswerStart(s), s).toBe(false);
  });
});
