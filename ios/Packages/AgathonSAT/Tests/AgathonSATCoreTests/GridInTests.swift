import Testing
@testable import AgathonSATCore

/// The grid-in rules (docs/SAT-MODE.md, "SPR rules"; the web's src/lib/sat/answer.ts).
struct GridInTests {
    func typed(_ keys: [SATGridIn.Key]) -> (String, SATGridIn.Problem?) {
        var text = ""
        var last: SATGridIn.Problem?
        for k in keys {
            let r = SATGridIn.press(k, on: text)
            text = r.text
            last = r.refused
        }
        return (text, last)
    }

    @Test func fiveCharactersSixWithAMinus() {
        #expect(typed([.digit(1), .digit(2), .digit(3), .digit(4), .digit(5)]).0 == "12345")
        let full = typed([.digit(1), .digit(2), .digit(3), .digit(4), .digit(5), .digit(6)])
        #expect(full.0 == "12345")
        #expect(full.1 == .full)
        #expect(typed([.minus, .digit(1), .digit(2), .digit(3), .digit(4), .digit(5)]).0 == "-12345")
        #expect(typed([.minus, .point, .digit(6), .digit(6), .digit(6), .digit(6), .digit(6)]).0 == "-.6666")
        #expect(SATGridIn.problem("123456") == .full)
        #expect(SATGridIn.problem("-123456") == .full)
        #expect(SATGridIn.problem("-12345") == nil)
    }

    @Test func aMinusOnlyFirst() {
        let r = typed([.digit(3), .minus])
        #expect(r.0 == "3")
        #expect(r.1 == .minusFirst)
        #expect(SATGridIn.problem("3-2") == .minusFirst)
    }

    @Test func fractionsAndDecimalsButNotBoth() {
        #expect(typed([.digit(3), .slash, .digit(4)]).0 == "3/4")
        #expect(typed([.point, .digit(7), .digit(5)]).0 == ".75")
        #expect(typed([.digit(1), .point, .digit(5), .slash]).1 == .fractionOrDecimal)
        #expect(typed([.digit(3), .slash, .digit(4), .point]).1 == .fractionOrDecimal)
        #expect(typed([.digit(1), .point, .point]).1 == .twoPoints)
        // a slash needs a whole number before it, once
        #expect(typed([.slash]).0 == "")
        #expect(typed([.digit(1), .slash, .digit(2), .slash]).0 == "1/2")
        #expect(SATGridIn.problem("1.5/2") == .fractionOrDecimal)
    }

    @Test func mixedNumbersAreNotAnswers() {
        #expect(SATGridIn.problem("1 1/2") == .mixedNumber)
        #expect(SATGridIn.type("1 1/2", on: "").refused == .mixedNumber)
        #expect(SATGridIn.type("1 1/2", on: "").text == "")
        // a hardware keyboard: a space after a number
        #expect(SATGridIn.type(" ", on: "1").refused == .mixedNumber)
        #expect(SATGridIn.type("3/2", on: "").text == "3/2")
        #expect(SATGridIn.type("−4", on: "").text == "-4")
        #expect(SATGridIn.type("x", on: "4").refused == .notAllowed)
    }

    @Test func unfinishedAnswersWait() {
        #expect(SATGridIn.problem("") == .empty)
        #expect(SATGridIn.problem("-") == .unfinished)
        #expect(SATGridIn.problem("3/") == .unfinished)
        #expect(SATGridIn.problem("3.") == .unfinished)
        #expect(SATGridIn.problem("3/0") == .zeroDenominator)
        #expect(SATGridIn.problem(".5") == nil)
        #expect(SATGridIn.problem("0.5") == nil)
        #expect(SATGridIn.problem("-3/4") == nil)
    }

    @Test func valuesAndTheAcceptedForms() {
        #expect(SATGridIn.value("3/4") == 0.75)
        #expect(SATGridIn.value("-3/4") == -0.75)
        #expect(SATGridIn.value(".75") == 0.75)
        #expect(SATGridIn.value("3/") == nil)
        let twoThirds = ["2/3", ".6666", ".6667", "0.666", "0.667"]
        #expect(SATGridIn.isCorrect("2/3", accepted: twoThirds))
        #expect(SATGridIn.isCorrect(".6667", accepted: twoThirds))
        #expect(SATGridIn.isCorrect("4/6", accepted: twoThirds))
        // not as precise as the space allows
        #expect(!SATGridIn.isCorrect(".67", accepted: twoThirds))
        #expect(!SATGridIn.isCorrect(".66", accepted: twoThirds))
        // the same value written another way is right, as on the test
        #expect(SATGridIn.isCorrect("6/8", accepted: ["3/4", ".75"]))
        #expect(SATGridIn.isCorrect("0.75", accepted: ["3/4"]))
        #expect(SATGridIn.isCorrect("1.50", accepted: ["1.5", "3/2"]))
        #expect(!SATGridIn.isCorrect("-3/4", accepted: ["3/4"]))
        #expect(!SATGridIn.isCorrect("1 1/2", accepted: ["3/2"]))
        #expect(SATGridIn.display("-4") == "−4")
    }

    @Test func everyFixtureGridInIsRightInEachAcceptedForm() {
        for q in SATFixtures.questions where q.format == .spr {
            for a in q.answer.accepted ?? [] { #expect(SATGridIn.isCorrect(a, accepted: q.answer.accepted ?? []), "\(q.id): \(a)") }
        }
    }
}
