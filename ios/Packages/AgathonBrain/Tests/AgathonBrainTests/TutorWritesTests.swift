import Foundation
import Testing
@testable import AgathonBrain

/// "The tutor writes it out" through JavaScriptCore (docs/TUTOR-WRITES.md): the step the brain chooses
/// and checks, and a stacked sum's next column placed in the tutor's hand. The choices themselves are
/// tested in vitest (`src/lib/live/__tests__/tutorStep.test.ts`, `stackStep.test.ts`); this holds the
/// bridge to them.
@Suite(.serialized)
struct TutorWritesTests {
    let brain = Brain()

    @Test func oneCheckedStepThenTheAnswerHeldBack() async throws {
        try await brain.load()
        let first = try await brain.tutorStep(problem: [], work: ["2x + 3 = 11"], answer: false)
        #expect(first.kind == .step && first.writes && first.checked)
        #expect(first.step == "2x = 8")
        #expect(first.why == "Subtract 3 from both sides.")
        let last = try await brain.tutorStep(problem: [], work: ["2x + 3 = 11", "2x = 8"], answer: false)
        #expect(last.kind == .lastStep && !last.writes)
        #expect(!last.why.contains("4"))
        let answer = try await brain.tutorStep(problem: [], work: ["2x + 3 = 11", "2x = 8"], answer: true)
        #expect(answer.kind == .answer && answer.step == "x = 4")
    }

    @Test func fractionsGoOnAfterTheKidsEquals() async throws {
        try await brain.load()
        let r = try await brain.tutorStep(problem: [], work: ["\\frac{1}{2} + \\frac{1}{3} ="], answer: false)
        #expect(r.kind == .step && r.inline)
        #expect(r.step == "\\frac{3}{6} + \\frac{2}{6}")
    }

    @Test func aModelsStepMustFollow() async throws {
        try await brain.load()
        #expect(try await brain.checkStep(from: "2x + 3 = 11", step: "2x = 8").ok)
        #expect(try await !brain.checkStep(from: "2x + 3 = 11", step: "2x = 14").ok)
        #expect(try await brain.checkStep(from: "2x = 8", step: "x = 4").solved)
    }

    @Test func aStackedSumsNextColumnInItsColumns() async throws {
        try await brain.load()
        // 286 over +680, a rule, nothing under it: glyphs 18 wide, 30 tall, columns 24 apart
        func row(_ text: String, _ y: Double) -> String {
            let n = text.count
            let glyphs = (0..<n).map { i in #"{"x":\#(400 - Double(n - 1 - i) * 24),"y":\#(y),"w":18,"h":30}"# }
            let x0 = 400 - Double(n - 1) * 24
            return #"{"rect":{"x":\#(x0),"y":\#(y),"w":\#(418 - x0),"h":30},"glyphs":[\#(glyphs.joined(separator: ","))]}"#
        }
        let json = #"{"rule":"r","strokeIds":[],"marks":[],"markRects":[],"rows":[\#(row("286", 100)),\#(row("+680", 145))],"answer":null,"more":false,"ruleRect":{"x":304,"y":184,"w":126,"h":3},"digit":30}"#
        let stack = try JSONDecoder().decode(JSONValue.self, from: Data(json.utf8))
        let latex = "\\begin{array}{r} 286 \\\\ +680 \\\\ \\hline \\end{array}"
        let ones = try await brain.stackStep(latex: latex, confidence: 1, stack: stack, tutor: [], answer: false, inkBottom: nil, zoom: nil, lineId: "l")
        #expect(ones.kind == .step && ones.key == "+ 286 680")
        #expect(ones.parts.map(\.part) == ["a0"])
        let plan = try #require(ones.parts.first?.plan)
        #expect(abs(plan.bounds.x + plan.bounds.w / 2 - 409) < 3, "centred in the ones column")
        #expect(plan.bounds.y > 187, "under the rule")
        let tens = try await brain.stackStep(latex: latex, confidence: 1, stack: stack, tutor: ["a0"], answer: false, inkBottom: nil, zoom: nil, lineId: "l")
        #expect(tens.parts.map(\.part) == ["a1", "c2"])
        #expect(tens.why == "Tens: 8 + 8 = 16. Write 6 and carry the 1.")
        let last = try await brain.stackStep(latex: latex, confidence: 1, stack: stack, tutor: ["a0", "a1", "c2"], answer: false, inkBottom: nil, zoom: nil, lineId: "l")
        #expect(last.kind == .lastStep && last.parts.isEmpty)
    }
}
