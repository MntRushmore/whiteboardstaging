import { describe, expect, it } from "vitest";
import { HELP_MODES, LIVE_TIMING, type EngineVerdict, type HelpMode, type LineAnalysis, type LineKind } from "../contracts";
import { badgeFor, decide, isSingleSymbolLatex, localNoteFor, type PolicyInput } from "../policy";

function analysis(verdict: EngineVerdict, kind: LineKind = "equation", extra: Partial<LineAnalysis> = {}): LineAnalysis {
  return { kind, math: "2x+3=11", resultLatex: "", verdict, note: "", ...extra };
}

function input(over: Partial<PolicyInput> = {}): PolicyInput {
  return {
    mode: "suggest",
    voiceActive: false,
    analysis: analysis("ok"),
    confidence: 0.95,
    idleMs: 0,
    settled: false,
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
  const idle = LIVE_TIMING.unknownIdleMs;
  const cases: Array<[HelpMode, EngineVerdict, boolean, number, boolean, number, boolean]> = [
    // mode, verdict, voice, idleMs, userAsked, hintsShown, expected
    ["off", "mismatch", false, idle, true, 0, false],
    ["off", "unknown", false, idle, false, 0, false],
    ["feedback", "mismatch", false, 0, false, 0, false],
    ["feedback", "mismatch", false, 0, true, 0, true],
    ["feedback", "unknown", false, 0, false, 0, false],
    ["feedback", "unknown", false, idle, false, 0, true],
    ["feedback", "ok", false, idle, false, 0, false],
    ["suggest", "mismatch", false, 0, false, 0, true],
    ["suggest", "mismatch", false, 0, false, 1, false],
    ["suggest", "mismatch", false, 0, true, 1, true],
    ["suggest", "unknown", false, idle, false, 0, true],
    ["suggest", "ok", false, idle, false, 0, false],
    ["answer", "mismatch", false, 0, false, 0, true],
    ["answer", "unknown", false, idle - 1, false, 0, false],
    ["suggest", "mismatch", true, 0, false, 0, false],
    ["answer", "mismatch", true, idle, true, 0, false],
    ["feedback", "unknown", true, idle, true, 0, false],
  ];
  for (const [mode, verdict, voiceActive, idleMs, userAsked, hintsShownForLine, expected] of cases) {
    it(`${mode} ${verdict} voice=${voiceActive} idle=${idleMs} asked=${userAsked} hints=${hintsShownForLine} -> ${expected}`, () => {
      const d = decide(input({ mode, analysis: analysis(verdict), voiceActive, idleMs, userAsked, hintsShownForLine }));
      expect(d.runLlmCheck).toBe(expected);
    });
  }

  it("never calls the LLM in off mode for any combination", () => {
    for (const verdict of ["ok", "mismatch", "unknown", "none"] as EngineVerdict[]) {
      for (const userAsked of [true, false]) {
        expect(decide(input({ mode: "off", analysis: analysis(verdict), userAsked, idleMs: 99999 })).runLlmCheck).toBe(false);
      }
    }
  });

  it("never calls the LLM while voice is active", () => {
    for (const mode of HELP_MODES) {
      expect(decide(input({ mode, voiceActive: true, analysis: analysis("mismatch"), userAsked: true, idleMs: 99999 })).runLlmCheck).toBe(false);
    }
  });

  it("only checks unknown lines of checkable kinds", () => {
    expect(decide(input({ mode: "feedback", analysis: analysis("unknown", "text"), idleMs: idle })).runLlmCheck).toBe(false);
    expect(decide(input({ mode: "feedback", analysis: analysis("unknown", "chem"), idleMs: idle })).runLlmCheck).toBe(false);
    expect(decide(input({ mode: "feedback", analysis: analysis("unknown", "expression"), idleMs: idle })).runLlmCheck).toBe(true);
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
          const d = decide(input({ mode, analysis: trailing, settled, userAsked, idleMs: LIVE_TIMING.unknownIdleMs }));
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
      expect(d.runLlmCheck).toBe(true);
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
