import Foundation
import Testing
@testable import AgathonSATCore

/// Rung 2 when the next step is the answer (2026-10-23 review): never the answer on the page, a pointer.
struct LastStepTests {
    static let oneVar = SATQuestion(
        id: "algebra-linear-one-var-0103", domain: .algebra, skill: "linear equations in one variable", difficulty: 1, format: .mcq,
        stem: "What value of $x$ satisfies the equation $5(x - 4) = 2x + 37$?",
        choices: [SATChoice(key: "A", text: "$11$"), SATChoice(key: "B", text: "$13$"), SATChoice(key: "C", text: "$19$"), SATChoice(key: "D", text: "$\\frac{57}{7}$")],
        answer: SATAnswer(key: "C"),
        solution: SATSolution(steps: [.init(text: "Distribute the 5.", math: "5x - 20 = 2x + 37"), .init(text: "Subtract $2x$ and add 20 to both sides.", math: "3x = 57"),
                                      .init(text: "Divide by 3.", math: "x = 19")]))
    static let line = SATQuestion(
        id: "algebra-linear-functions-0118", domain: .algebra, skill: "linear functions", difficulty: 1, format: .mcq, stem: "Which equation?",
        choices: [SATChoice(key: "A", text: "$h=\\frac{2}{3}w+6$"), SATChoice(key: "B", text: "$h=\\frac{3}{2}w+6$")], answer: SATAnswer(key: "B"),
        solution: SATSolution(steps: [.init(text: "The slope.", math: "\\frac{12-6}{4-0}=\\frac{3}{2}"), .init(text: "So the equation is", math: "h=\\frac{3}{2}w+6")]))
    static let system = SATQuestion(
        id: "algebra-linear-systems-0105", domain: .algebra, skill: "systems of two linear equations", difficulty: 1, format: .spr, stem: "…",
        answer: SATAnswer(accepted: ["-17/3", "-5.666", "-5.667"]),
        solution: SATSolution(steps: [.init(text: "Subtract.", math: "2x=38"), .init(text: "Substitute $x=19$ into the second equation and solve for $y$.", math: "3y=21-38=-17, y=-\\frac{17}{3}")]))

    @Test func aStepThatIsTheAnswerIsKnown() {
        #expect(SATLastStep.revealsAnswer("x = 19", of: Self.oneVar))
        #expect(!SATLastStep.revealsAnswer("3x = 57", of: Self.oneVar))
        #expect(!SATLastStep.revealsAnswer("5x - 2x = 37 + 20", of: Self.oneVar))
        #expect(SATLastStep.revealsAnswer("h = \\frac{3}{2}w + 6", of: Self.line))
        #expect(!SATLastStep.revealsAnswer("y = 6x + b", of: Self.line))
        #expect(SATLastStep.revealsAnswer("y=-\\frac{17}{3}", of: Self.system))
        #expect(!SATLastStep.revealsAnswer("x = 19", of: Self.system))
    }

    @Test func thePointerSaysHowNeverTheResult() {
        #expect(SATLastStep.pointer(explanation: "Divide both sides by 3 to get x = 19.", for: Self.oneVar) == "One step left: divide both sides by 3.")
        #expect(SATLastStep.pointer(explanation: "Divide both sides by 3: $x = 19$.", for: Self.oneVar) == "One step left: divide both sides by 3.")
        // no words from the model: the bank's step
        #expect(SATLastStep.pointer(explanation: nil, for: Self.oneVar) == "One step left: divide by 3.")
        #expect(SATLastStep.pointer(explanation: "", for: Self.oneVar) == "One step left: divide by 3.")
        // the bank's words only announce the result: a plain pointer
        #expect(SATLastStep.pointer(explanation: nil, for: Self.line) == "One step left: finish it from your last line.")
        #expect(SATLastStep.pointer(explanation: "Substitute 19 for x into the second equation, then solve for y = -17/3.", for: Self.system)
                == "One step left: substitute 19 for x into the second equation, then solve for y.")
    }
}
