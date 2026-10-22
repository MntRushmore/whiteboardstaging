import AgathonBoard
import AgathonBrain
import Foundation
import Testing
@testable import AgathonLive

/// The classes of misjudgement the real-ink bench found in children's own handwriting
/// (docs/REAL-INK-BENCH.md), each held here in a SYNTHETIC hand — the corpus is private and never
/// enters this repo. Each case is the read production gave for the real ink, recorded against
/// synthetic strokes (`TrainingFixtureTests.syntheticFixture`), so what is tested is the tutor's logic
/// on that read.
@MainActor
@Suite(.serialized)
struct RealInkFixesTests {
    static func describe(_ r: TrainingFixtureTests.Outcome) -> String {
        r.lines.map { "\($0.written) → \($0.read ?? "-") [\($0.mark.rawValue)/\($0.expect?.rawValue ?? "-")] \($0.why?.text ?? "")" }.joined(separator: " | ")
            + (r.why.map { " — \($0.text)" } ?? "")
    }

    // MARK: - a child's mark is no line to ask about

    @Test func aMarkWithNoDigitAndNoLetterGetsNoQuestion() {
        #expect(LivePolicy.isMarkOnly("\\text { ( ) }"))
        #expect(LivePolicy.isMarkOnly("( \\quad )"))
        #expect(LivePolicy.isMarkOnly("\\rightarrow"))
        #expect(LivePolicy.isMarkOnly("\\checkmark"))
        #expect(!LivePolicy.isMarkOnly("12"))
        #expect(!LivePolicy.isMarkOnly("x"))
        #expect(!LivePolicy.isMarkOnly("\\pi"))
        #expect(!LivePolicy.isMarkOnly("\\text { ten }"))
        #expect(LivePolicy.unjudgedReason(latex: "\\text { ( ) }", confidence: 0.99, provider: .mathpix, analysis: nil) == nil)
    }

    // MARK: - the answer without its letter

    @Test func aLoneRightNumberUnderAnEquationIsTheAnswer() async throws {
        let f = try await TrainingFixtureTests.syntheticFixture(problem: ["\\frac{x}{2} - 5 = 1"], lines: [("12", .tick, .answer)], solved: true)
        let r = await TrainingFixtureTests.replay(f)
        #expect(r.pass == true, "\(Self.describe(r))")
    }

    @Test func aLoneWrongNumberIsNeverRinged() async throws {
        // it may be a side sum: no ring (a "?" or nothing), and the page not solved
        let f = try await TrainingFixtureTests.syntheticFixture(problem: ["2x + 3 = 11"], lines: [("8", .calm, .work)], solved: false)
        let r = await TrainingFixtureTests.replay(f)
        #expect(!r.lines.contains { $0.mark == .ring }, "\(Self.describe(r))")
    }

    // MARK: - her notes of what she does to both sides

    @Test func notesReadIntoTheLineAreNotJudged() async throws {
        // production read "×4  ×4" written beside x/4 = 3 into the line: both right lines were ringed
        let f = try await TrainingFixtureTests.syntheticFixture(problem: ["\\frac{x}{4} - 4 = -1"],
                                                                lines: [("\\frac{x}{4} = 3 \\quad \\times 4", .calm, .work), ("x = 12", .tick, .answer)],
                                                                solved: true)
        let r = await TrainingFixtureTests.replay(f)
        #expect(!r.lines.contains { $0.mark == .ring }, "\(Self.describe(r))")
        #expect(r.pass == true, "\(Self.describe(r))")
    }

    @Test func notesNeverHideASlip() async throws {
        let f = try await TrainingFixtureTests.syntheticFixture(problem: ["\\frac{x}{4} - 4 = -1"],
                                                                lines: [("\\frac{x}{4} = 5 \\quad \\times 4", .ring, .work)], solved: false)
        let r = await TrainingFixtureTests.replay(f)
        #expect(r.lines.first?.mark == .ring, "\(Self.describe(r))")
    }
}
