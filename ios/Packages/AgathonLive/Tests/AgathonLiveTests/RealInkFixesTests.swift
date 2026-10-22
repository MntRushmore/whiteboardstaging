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

    /// A fixture written in the synthetic clean hand (`StudentHand`, which writes any LaTeX), its reads
    /// recorded as `TrainingFixtureTests.syntheticFixture` records them: each line read as `reads[k]`
    /// (the read production gave for the real ink) or as written.
    static func fixture(problem: [String]?, lines: [(String, TrainingExpect, TrainingPlace)], reads: [String?] = [],
                        solved: Bool?) async throws -> TrainingFixture {
        try await TestBrain.shared.load()
        var flines: [TrainingFixture.Line] = []
        var y = 268.0
        for (k, (latex, expect, place)) in lines.enumerated() {
            let ink = try #require(try await StudentHand.ink(latex, hand: .clean, brain: TestBrain.shared), "the hand can't write \(latex)")
            let at = place == .answer ? Vec2(300, 768) : Vec2(160, y)
            y += 90
            let read = k < reads.count ? (reads[k] ?? latex) : latex
            flines.append(TrainingFixture.Line(written: latex, expect: expect, value: nil, place: place,
                                               strokes: ink.map { s in TrainingStroke(x: s.map { $0.x + at.x }, y: s.map { $0.y + at.y }) },
                                               read: read, mark: .none))
        }
        let r = TrainingCaseResult(kind: .bench, caseKey: "real-ink", category: .multiStep, grade: .g78, topic: "algebra", hand: "clean",
                                   problem: problem ?? [], spec: nil, lines: [], strokes: [], solvedExpected: solved, solvedGot: false, pass: nil)
        var f = TrainingFixture(r, settings: .init())
        f.lines = flines
        f.status = "fixed"
        let labeling = LabelingServices()
        _ = await TrainingFixtureTests.replay(f, labeling: labeling)
        f.reads = labeling.recorded
        return f
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

    @Test func herNotesOfWhatSheDoesToBothSidesGetNoQuestion() {
        #expect(LivePolicy.isOperationNote("\\times 2"))
        #expect(LivePolicy.isOperationNote("+4 \\quad +4"))
        #expect(LivePolicy.isOperationNote("\\div -7"))
        #expect(LivePolicy.isOperationNote("-9"))
        #expect(!LivePolicy.isOperationNote("2 \\times 3"))
        #expect(!LivePolicy.isOperationNote("x = 4"))
        #expect(!LivePolicy.isOperationNote("+"))
    }

    // MARK: - the answer without its letter

    @Test func aLoneRightNumberUnderAnEquationIsTheAnswer() async throws {
        let f = try await Self.fixture(problem: ["\\frac{x}{2} - 5 = 1"], lines: [("12", .tick, .answer)], solved: true)
        let r = await TrainingFixtureTests.replay(f)
        #expect(r.pass == true, "\(Self.describe(r))")
    }

    @Test func aLoneWrongNumberIsNeverRinged() async throws {
        // it may be a side sum: no ring (a "?" or nothing), and the page not solved
        let f = try await Self.fixture(problem: ["2x + 3 = 11"], lines: [("8", .calm, .work)], solved: false)
        let r = await TrainingFixtureTests.replay(f)
        #expect(!r.lines.contains { $0.mark == .ring }, "\(Self.describe(r))")
    }

    // MARK: - her notes of what she does to both sides

    @Test func notesReadIntoTheLineAreNotJudged() async throws {
        // production read "×4  ×4" written beside x/4 = 3 into the line: both right lines were ringed
        let f = try await Self.fixture(problem: ["\\frac{x}{4} - 4 = -1"],
                                       lines: [("\\frac{x}{4} = 3 \\quad \\times 4", .calm, .work), ("x = 12", .tick, .answer)],
                                       reads: ["\\frac{x}{4}=3 \\quad \\times 4", "x=12"], solved: true)
        let r = await TrainingFixtureTests.replay(f)
        #expect(!r.lines.contains { $0.mark == .ring }, "\(Self.describe(r))")
        #expect(r.pass == true, "\(Self.describe(r))")
    }

    @Test func notesNeverHideASlip() async throws {
        let f = try await Self.fixture(problem: ["\\frac{x}{4} - 4 = -1"],
                                       lines: [("\\frac{x}{4} = 5 \\quad \\times 4", .ring, .work)], solved: false)
        let r = await TrainingFixtureTests.replay(f)
        #expect(r.lines.first?.mark == .ring, "\(Self.describe(r))")
    }
}
