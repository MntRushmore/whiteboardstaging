import AgathonBoard
import AgathonBrain
import Foundation
import Testing
@testable import AgathonLive

/// The classes of misjudgement the production bench found (docs/TRAINING-CENTER.md, "The headless
/// bench"), each fixed and held here: the catalogue's cases through the real loop with perfect reads
/// (the bench's oracle: a line is read as exactly what was written), so what is tested is the tutor's
/// logic — the columns, the judging, the marks. The reads the recognizer really gave are held by the
/// regression fixtures (`TrainingFixtureTests`).
@MainActor
@Suite(.serialized)
struct BenchFixesTests {
    /// A catalogue case in a hand, with perfect reads.
    static func run(_ id: String, hand: TrainingHand = .clean) async throws -> TrainingCaseResult {
        try await TestBrain.shared.load()
        let spec = try #require(TrainingCatalogue.all.first { $0.id == id }, "no case \(id)")
        let services = BenchServices(mode: .oracle, upstream: nil, cache: .init(), hintsFromServer: false, maxRecognize: 0, maxOther: 0)
        return await HeadlessBench.run(.init(spec: spec, hand: hand), services: services, oracle: true)
    }

    static func describe(_ r: TrainingCaseResult) -> String {
        r.lines.map { "\($0.written) → \($0.read ?? "-") [\($0.mark.rawValue)/\($0.expect?.rawValue ?? "-")] \($0.why?.text ?? "")" }.joined(separator: " | ")
            + (r.why.map { " — \($0.text)" } ?? "")
    }

    // MARK: - stacked sums

    @Test(arguments: ["cs-add-ok", "cs-add-slip", "cs-sub-ok", "cs-mul-ok", "cs-mul-slip", "cs-own-ok"])
    func aStackedSumIsWorkedAsASum(_ id: String) async throws {
        let r = try await Self.run(id)
        #expect(r.pass == true, "\(id): \(Self.describe(r))")
    }

    @Test func aStackedSumsMarksGoAfterItsAnswerAndRoundTheWrongDigit() {
        #expect(LiveLoop.looksStacked("\\begin{array}{r}\n286 \\\\\n+680 \\\\\n\\hline 966\n\\end{array}"))
        #expect(LiveLoop.looksStacked("\\frac{+680}{966}"))
        #expect(!LiveLoop.looksStacked("\\frac{3}{4}"))
        #expect(!LiveLoop.looksStacked("\\begin{array}{l} 400+364=764 \\\\ +3=767 \\end{array}"))
    }

    // MARK: - the answer spot is the work's last step

    @Test(arguments: ["rt-767-slip", "rt-52-17-slip", "ms-both-slip", "ms-dist-slip", "ms-3x5-slip"])
    func anAnswerCarriedOnFromASlipIsNotRingedAgain(_ id: String) async throws {
        for hand in [TrainingHand.clean, .small] {
            let r = try await Self.run(id, hand: hand)
            #expect(r.pass == true, "\(id)@\(hand.name): \(Self.describe(r))")
            #expect(r.lines.filter { $0.mark == .ring }.count == 1, "one ring, on the slip: \(Self.describe(r))")
        }
    }

    // MARK: - a page of the kid's own

    @Test(arguments: ["op-alg-ok", "op-alg-slip", "op-sum-ok"])
    func aProblemOfTheKidsOwnHeadsItsWork(_ id: String) async throws {
        let r = try await Self.run(id)
        #expect(r.pass == true, "\(id): \(Self.describe(r))")
    }

    // MARK: - never ring a correct line

    @Test func twoFactsSideBySideAreNoSlip() async throws {
        let r = try await Self.run("sp-side-column-ok")
        #expect(!r.lines.contains { $0.mark == .ring }, Self.describe(r))
        #expect(ArithmeticTruth.trueAsMeant("10 \\times 7=70 \\quad 8 \\times 7=56"))
        #expect(ArithmeticTruth.trueAsMeant("10 \\times 7=708 \\times 7=56"))
        #expect(!ArithmeticTruth.trueAsMeant("10 \\times 7=70 \\quad 8 \\times 7=58"))
        #expect(!ArithmeticTruth.trueAsMeant("10 \\times 7=718 \\times 7=56"))
    }

    @Test func anEqualsReadAsAMinusIsNoSlip() {
        #expect(ArithmeticTruth.trueAsMeant("18 \\times 7=70+56-126"))
        // a real slip stays one
        #expect(!ArithmeticTruth.trueAsMeant("18 \\times 7=70+56-136"))
        #expect(!ArithmeticTruth.trueAsMeant("52-17=45"))
        #expect(!ArithmeticTruth.trueAsMeant("5-9=4"))
    }

    // MARK: - the answer worked on after a solving line

    @Test func theProblemsLetterGivenAWrongValueIsRingedAndThePageNotSolved() async throws {
        let r = try await Self.run("n-eq-slip")
        #expect(r.pass == true, Self.describe(r))
        #expect(r.solvedGot == false)
    }
}
