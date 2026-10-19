import AgathonBrain
import Foundation
import Testing
@testable import AgathonLive

/// The pure pieces of problem pages (docs/PROBLEM-PAGES.md): the held line's policy, the settings'
/// new default, reading a line in its page's context, the readings it may have been, and the
/// keypad's typing as LaTeX.
@MainActor
struct ProblemPagesLogicTests {
    static let ok: LineAnalysis = try! JSONDecoder().decode(LineAnalysis.self, from: Data(#"{"kind":"equation","math":"4 * x == 12","resultLatex":"","verdict":"ok","note":""}"#.utf8))
    static let slip: LineAnalysis = try! JSONDecoder().decode(LineAnalysis.self, from: Data(#"{"kind":"equation","math":"4 * x == 13","resultLatex":"","verdict":"mismatch","note":"Re-check the arithmetic here"}"#.utf8))
    static let sum: LineAnalysis = try! JSONDecoder().decode(LineAnalysis.self, from: Data(#"{"kind":"expression","math":"36 + 2","resultLatex":"38","verdict":"none","note":""}"#.utf8))

    @Test func aHeldLineSaysNothingButKeepsItsReading() {
        for analysis in [Self.ok, Self.slip] {
            for mode in [LiveMode.feedback, .suggest, .answer] {
                let held = LivePolicy.decide(.init(mode: mode, analysis: analysis, confidence: 0.98, settled: true, auto: true, userAsked: false,
                                                   latex: "4x = 13", held: true))
                #expect(held.echo, "the reading stands")
                #expect(held.badge == "none" && !held.runLlmCheck && !held.allowHint && !held.allowSteps && !held.showResult,
                        "\(mode) \(analysis.verdict): \(held)")
                // released: as before
                let released = LivePolicy.decide(.init(mode: mode, analysis: analysis, confidence: 0.98, settled: true, auto: true, userAsked: false,
                                                       latex: "4x = 13"))
                #expect(released.badge == (analysis.verdict == "ok" ? "ok" : "warn"))
            }
        }
        // the grown-ups' answers after `=` still come at once: they asked for them
        let homework = LivePolicy.decide(.init(mode: .feedback, analysis: Self.sum, confidence: 0.98, settled: false, auto: true, userAsked: false,
                                               latex: "36 + 2 =", answerOnEquals: true, held: true))
        #expect(homework.showResult && homework.badge == "none")
    }

    @Test func checkWhenDoneIsTheDefaultForOldSettingsTooOnceItShips() throws {
        // the pages ship first; check when done and "I read" with the second part
        let expected: CheckTiming = ProblemPagesRollout.secondPart ? .whenDone : .asIGo
        #expect(LiveSettings.default.checking == expected)
        #expect(LiveSettings.default.showReadings == ProblemPagesRollout.secondPart)
        // saved before the setting existed
        let old = try JSONDecoder().decode(LiveSettings.self, from: Data(#"{"enabled":true,"mode":"suggest","auto":false,"handwriting":true,"celebrations":true}"#.utf8))
        #expect(old.checking == expected && old.mode == .suggest && !old.auto && old.showReadings == ProblemPagesRollout.secondPart)
        // a grown-up's switch back to as-they-go is kept
        var s = LiveSettings.default
        s.checking = .asIGo
        s.showReadings = false
        let back = try JSONDecoder().decode(LiveSettings.self, from: JSONEncoder().encode(s))
        #expect(back.checking == .asIGo && !back.showReadings)
        // an unknown value (a newer app's) reads as the default
        let newer = try JSONDecoder().decode(LiveSettings.self, from: Data(#"{"checking":"someday"}"#.utf8))
        #expect(newer.checking == expected)
    }

    @Test func aTimesWhereNoProductCanBeIsThePagesLetter() {
        let x: Set<Character> = ["x"]
        #expect(ReadingContext.correct("2 \\times + 3 = 11", letters: x) == "2x + 3 = 11")
        #expect(ReadingContext.correct("4 \\times = 12", letters: x) == "4x = 12")
        #expect(ReadingContext.correct("\\times = 4", letters: x) == "x = 4")
        #expect(ReadingContext.correct("2 \\times^{2} + 1", letters: x) == "2x^{2} + 1")
        #expect(ReadingContext.correct("2X + 3 = 11", letters: x) == "2x + 3 = 11")
        #expect(ReadingContext.correct("\\chi = 3", letters: x) == "x = 3")
        // a product stays a product; a read that needs nothing stays; no digit ever changes
        #expect(ReadingContext.correct("4 \\times 3 = 12", letters: x) == nil)
        #expect(ReadingContext.correct("2x + 3 = 11", letters: x) == nil)
        #expect(ReadingContext.correct("x = 5", letters: x) == nil)
        // arithmetic (no letters) and a page with two letters: no guess at which
        #expect(ReadingContext.correct("4 \\times = 12", letters: []) == nil)
        #expect(ReadingContext.correct("4 \\times = 12", letters: ["x", "y"]) == nil)
        // a page with an X of its own keeps it
        #expect(ReadingContext.correct("2X = 4", letters: ["x", "X"]) == nil)
        // the letters of a problem: outside commands and \text
        #expect(ReadingContext.letters(["\\frac{a}{b} = 3y", "\\text{find } x"]) == ["a", "b", "y", "x"])
        #expect(ReadingContext.letters(["18 + 15 - 19", "\\sqrt{16} \\times 2"]).isEmpty)
    }

    /// The eval's misreads (docs/eval/mpx-supernet.md): a look-alike of the page's letter is a reason
    /// to ask, and its letter the sheet's suggestion — never a swap.
    @Test func aLookAlikeOfThePagesLetterIsAReasonToAsk() {
        #expect(ReadingContext.asks("0=5", letters: ["a"]))
        #expect(ReadingContext.suggestions("0=5", letters: ["a"]) == ["a=5"])
        #expect(ReadingContext.asks("6^{x}=10", letters: ["e", "x"]))
        #expect(ReadingContext.suggestions("6^{x}=10", letters: ["e", "x"]).first == "e^{x}=10")
        #expect(ReadingContext.asks(";^{23}", letters: ["i"]) && ReadingContext.asks("U=3", letters: ["u"]))
        #expect(ReadingContext.asks("(0+b)^{2}", letters: ["a", "b"]))
        #expect(ReadingContext.asks("4 \\times = 12", letters: ["x"]))
        // a digit inside a number is no reason to ask (`10`), but the sheet may still suggest it (`2a`)
        #expect(!ReadingContext.asks("10 - 5 = 5", letters: ["a"]))
        #expect(!ReadingContext.asks("b=20-3", letters: ["a", "b"]))
        #expect(ReadingContext.suggestions("b=20-3", letters: ["a", "b"]).contains("b=2a-3"))
        // the letter is there: nothing to ask
        #expect(!ReadingContext.asks("a = 5", letters: ["a"]) && !ReadingContext.asks("x = 4", letters: ["x"]))
        #expect(!ReadingContext.asks("0 = 5", letters: []), "arithmetic has no letters to look like")
        // the second opinion's read comes first in the sheet
        #expect(ReadingAlternatives.candidates("0=5", letters: ["a"], prior: ["a = 5"]).first == "a = 5")
    }

    @Test func theReadingsItMayHaveBeen() {
        let x: Set<Character> = ["x"]
        #expect(ReadingAlternatives.candidates("4 \\times = 12", letters: x).first == "4x = 12")
        #expect(ReadingAlternatives.candidates("x = s", letters: x).contains("x = 5"))
        #expect(ReadingAlternatives.candidates("x = 1o", letters: x).contains("x = 10"))
        #expect(ReadingAlternatives.candidates("z + 3 = 5", letters: x).contains("2 + 3 = 5"))
        // the second reader's reading comes first after the context's
        let withReread = ReadingAlternatives.candidates("x = s", letters: x, also: ["x = 8"])
        #expect(withReread.first == "x = 8" && withReread.contains("x = 5"))
        // a letter the page uses stays a letter: on an s page, s is no 5
        #expect(!ReadingAlternatives.candidates("s = 5", letters: ["s"]).contains("5 = 5"))
        // never the read itself, never twice, at most the limit
        let c = ReadingAlternatives.candidates("2 \\times + 3 = 11", letters: x, also: ["2 \\times + 3 = 11", "2x + 3 = 11"])
        #expect(!c.contains("2 \\times + 3 = 11") && c.filter { $0 == "2x + 3 = 11" }.count == 1)
        #expect(ReadingAlternatives.candidates("l s z o g t b X", letters: [], limit: 3).count <= 3)
    }

    @Test func theKeypadTypesLaTeX() {
        #expect(PlainMath.latex("4x = 12") == "4x = 12")
        #expect(PlainMath.latex("3/4 + 1/8") == "\\frac{3}{4} + \\frac{1}{8}")
        #expect(PlainMath.latex("(x+1)/2 = 3") == "\\frac{x+1}{2} = 3")
        #expect(PlainMath.latex("2x/3") == "\\frac{2x}{3}")
        #expect(PlainMath.latex("x^2 = 9") == "x^{2} = 9")
        #expect(PlainMath.latex("x² − 1") == "x^{2} - 1")
        #expect(PlainMath.latex("√16 = 4") == "\\sqrt{16} = 4")
        #expect(PlainMath.latex("√(x+1)") == "\\sqrt{x+1}")
        #expect(PlainMath.latex("2×3 = 6") == "2 \\times 3 = 6")
        #expect(PlainMath.latex("12÷4 = 3") == "12 \\div 4 = 3")
        // and back for editing a reading
        #expect(PlainMath.plain("\\frac{3}{4} + x^{2}") == "3/4 + x²")
        // the keypad's keys
        var typed = ""
        let keypad = MathKeypad(text: .init(get: { typed }, set: { typed = $0 }))
        for face in ["4", "x", "=", "1", "2"] {
            let key = MathKeypad.rows.flatMap { $0 }.first { $0.face == face }!
            keypad.press(key)
        }
        #expect(typed == "4x = 12")
        keypad.press(MathKeypad.rows[0][4]) // ⌫
        keypad.press(MathKeypad.rows[0][4])
        keypad.press(MathKeypad.rows[0][4])
        #expect(typed == "4x", "a spaced = goes as one")
    }
}
