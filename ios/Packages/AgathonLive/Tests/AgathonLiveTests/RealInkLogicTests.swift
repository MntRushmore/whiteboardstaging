import AgathonBoard
import AgathonBrain
import Foundation
import Testing
@testable import AgathonLive

/// The tutor's judging (not its reading) on the failure classes the real-ink bench's oracle run found
/// (docs/REAL-INK-BENCH.md, MODE=oracle: perfect reads, so only the tutor's own logic is tested). Every
/// case here is RE-DRAWN in a synthetic hand (`StudentHand`, `KidHands`) — the corpus is children's
/// ink, private, and never enters this public repo.
@MainActor
@Suite(.serialized)
struct RealInkLogicTests {
    // MARK: - a false fact is a slip, even after a solved line

    @Test func aFalseFactAfterASolvedLineIsRinged() async throws {
        // her own page: `4 + 4 = 8` (solved), then a false fact — it went unringed: taken for a new
        // problem of her own
        let f = try await RealInkFixesTests.fixture(problem: nil, lines: [("4 + 4 = 8", .calm, .work), ("2 \\times 3 + 1 = 8", .ring, .work)],
                                                    solved: nil)
        let r = await TrainingFixtureTests.replay(f)
        #expect(r.lines.last?.mark == .ring, "\(RealInkFixesTests.describe(r))")
        #expect(r.lines.first?.mark != .ring, "\(RealInkFixesTests.describe(r))")
    }

    @Test func aTrueFactAfterASolvedLineIsNeverRinged() async throws {
        let f = try await RealInkFixesTests.fixture(problem: nil, lines: [("4 + 4 = 8", .calm, .work), ("3 + 6 = 9", .calm, .work)],
                                                    solved: nil)
        let r = await TrainingFixtureTests.replay(f)
        #expect(!r.lines.contains { $0.mark == .ring || $0.mark == .question }, "\(RealInkFixesTests.describe(r))")
    }

    @Test func aFalseFactIsTheClaimOfAFact() {
        #expect(ArithmeticTruth.holds("2 \\times 3 + 1 = 8") == false)
        #expect(ArithmeticTruth.holds("4 + 4 = 8") == true)
        // a problem of her own with letters, or a sum still open, is no fact
        #expect(ArithmeticTruth.holds("3y = 9") == nil)
        #expect(ArithmeticTruth.holds("5 + 3 =") == nil)
    }

    // MARK: - right answers the page never counted (no tick, or not solved)

    @Test func rightAnswersOfOtherFormsAreTickedAndSolveThePage() async throws {
        let cases: [(problem: String, lines: [(String, TrainingExpect, TrainingPlace)])] = [
            // `y` in terms of `x`, under the tutor's line in x and y
            ("y - 5 = 2(x + 2)", [("y - 5 = 2x + 4", .calm, .work), ("y = 2x + 9", .tick, .work)]),
            // the derivative it asked for
            ("\\frac{d}{dx}(x^{4} + 5x)", [("4x^{3} + 5", .tick, .work)]),
            // an angle, written alone
            ("x + 41^{\\circ} = 90^{\\circ}", [("49^{\\circ}", .tick, .work)]),
        ]
        for c in cases {
            let f = try await RealInkFixesTests.fixture(problem: [c.problem], lines: c.lines, solved: true)
            let r = await TrainingFixtureTests.replay(f)
            #expect(r.pass == true, "\(c.problem): \(RealInkFixesTests.describe(r))")
        }
    }

    @Test func aWrongDerivativeIsRinged() async throws {
        let f = try await RealInkFixesTests.fixture(problem: ["\\frac{d}{dx}(x^{4} + 5x)"], lines: [("4x^{3} + 5x", .ring, .work)], solved: false)
        let r = await TrainingFixtureTests.replay(f)
        #expect(r.lines.first?.mark == .ring, "\(RealInkFixesTests.describe(r))")
    }

    // MARK: - a stacked sum with its answer written again under it

    @Test func aStackedProductWithItsAnswerCopiedOutUnderItIsTicked() async throws {
        try await TestBrain.shared.load()
        // 23 × 4 = 92 worked as a stack, the answer copied out neater under it: never ticked (the
        // ink's extra row was taken for long multiplication's); a wrong copy-out is still no tick
        for (answer, again, expect, solved) in [("92", "92", TrainingExpect.tick, true), ("92", "29", .calm, false)] {
            let spec = TrainingCase(id: "cs-mul-again-\(again)", category: .columnSum, grade: .g34, topic: "mul", problem: ["23 \\times 4"],
                                    lines: [TrainingCatalogue.work(TrainingCatalogue.stack("23 \\\\ \\times 4 \\\\ \\hline \(answer) \\\\ \(again)"), expect)],
                                    solved: solved)
            let services = BenchServices(mode: .oracle, upstream: nil, cache: .init(), hintsFromServer: false, maxRecognize: 0, maxOther: 0)
            let r = await HeadlessBench.run(.init(spec: spec, hand: .clean), services: services, oracle: true)
            #expect(!r.lines.contains { $0.mark == .ring }, "\(BenchFixesTests.describe(r))")
            if expect == .tick { #expect(r.pass == true, "\(BenchFixesTests.describe(r))") }
        }
    }

    // MARK: - her notes of what she does to both sides, under the tutor's problem

    /// A fixture whose lines are each made of pieces written where given (the synthetic clean hand),
    /// each line read as `read` (or its pieces' LaTeX joined).
    static func piecesFixture(problem: [String], lines: [(pieces: [(String, Vec2)], read: String, expect: TrainingExpect)],
                              solved: Bool?) async throws -> TrainingFixture {
        try await TestBrain.shared.load()
        var flines: [TrainingFixture.Line] = []
        for line in lines {
            var strokes: [TrainingStroke] = []
            for (latex, at) in line.pieces {
                let ink = try #require(try await StudentHand.ink(latex, hand: .clean, brain: TestBrain.shared), "the hand can't write \(latex)")
                strokes += ink.map { s in TrainingStroke(x: s.map { $0.x + at.x }, y: s.map { $0.y + at.y }) }
            }
            flines.append(TrainingFixture.Line(written: line.read, expect: line.expect, value: nil, place: .work, strokes: strokes, read: line.read, mark: .none))
        }
        let r = TrainingCaseResult(kind: .bench, caseKey: "real-ink-logic", category: .multiStep, grade: .g78, topic: "algebra", hand: "clean",
                                   problem: problem, spec: nil, lines: [], strokes: [], solvedExpected: solved, solvedGot: false, pass: nil)
        var f = TrainingFixture(r, settings: .init())
        f.lines = flines
        f.status = "fixed"
        let labeling = LabelingServices()
        _ = await TrainingFixtureTests.replay(f, labeling: labeling)
        f.reads = labeling.recorded
        return f
    }

    @Test func theSameNoteUnderEachSideOfTheTutorsProblemIsOneLineAndNoQuestion() async throws {
        // `-3x` under each side of the tutor's `7x + 4 = 3x + 16`, far apart: two lines, two "?"s
        let f = try await Self.piecesFixture(problem: ["7x + 4 = 3x + 16"], lines: [
            (pieces: [("-3x", Vec2(160, 268)), ("-3x", Vec2(560, 270))], read: "-3x \\quad -3x", expect: .calm),
            (pieces: [("4x + 4 = 16", Vec2(160, 358))], read: "4x + 4 = 16", expect: .calm),
            (pieces: [("x = 3", Vec2(160, 448))], read: "x = 3", expect: .tick),
        ], solved: true)
        let r = await TrainingFixtureTests.replay(f)
        #expect(r.lines.first?.pieces == 1, "\(RealInkFixesTests.describe(r))")
        #expect(!r.lines.contains { $0.mark == .question || $0.mark == .ring }, "\(RealInkFixesTests.describe(r))")
        #expect(r.pass == true, "\(RealInkFixesTests.describe(r))")
    }

    // MARK: - check when done: the "?" waits for the check

    /// Ink the tutor cannot read, on a problem page checked when done: no "?" while the kid works (the
    /// read of half a line fails), its "?" with the check.
    @Test func anUnreadableLineGetsItsQuestionAtTheCheckNotMidWork() async throws {
        let pages = ProblemPagesLoopTests()
        let h = pages.harness(checking: .whenDone)
        await h.start()
        pages.problemPage(h, ["2x + 3 = 11"])
        h.services.failNextReads([ErrorPathTests.http(503, #"{"error":"recognizer_failed","message":"unreadable","unreadable":true}"#)])
        await h.write("2x = 8", at: Vec2(200, 280))
        await h.pass(LiveTiming.unreadableChipMs + 1_000)
        #expect(!h.board.marks.contains { $0.kind == .question }, "no \"?\" while they work: \(h.board.marks.map(\.kind))")
        h.loop.checkPage()
        await h.pass(500)
        #expect(h.board.marks.contains { $0.kind == .question && $0.why == "unread" }, "the \"?\" comes with the check")
    }

    @Test func checkingAsIGoStillAsksAboutUnreadableInk() async throws {
        let h = Harness(mode: .feedback, checking: .asIGo)
        await h.start()
        h.services.failNextReads([ErrorPathTests.http(503, #"{"error":"recognizer_failed","message":"unreadable","unreadable":true}"#)])
        await h.write("2x = 8", at: Vec2(200, 150))
        await h.pass(LiveTiming.unreadableChipMs + 1_000)
        #expect(h.board.marks.first?.kind == .question)
    }

    @Test func aLineWrittenAfterTheCheckWaitsForTheNextOne() async throws {
        let pages = ProblemPagesLoopTests()
        let h = pages.harness(checking: .whenDone)
        await h.start()
        pages.problemPage(h, ["2x + 3 = 11"])
        await h.write("2x = 8", at: Vec2(200, 280))
        await h.pass(1_500)
        h.loop.checkPage()
        await h.pass(500)
        #expect(h.board.mark(on: "2x = 8") == .tick)
        h.services.failNextReads([ErrorPathTests.http(503, #"{"error":"recognizer_failed","message":"unreadable","unreadable":true}"#)])
        await h.write("x = 4", at: Vec2(200, 360))
        await h.pass(LiveTiming.unreadableChipMs + 1_000)
        #expect(!h.board.marks.contains { $0.kind == .question }, "the new line's \"?\" waits: \(h.board.marks.map(\.kind))")
        h.loop.checkPage()
        await h.pass(500)
        #expect(h.board.marks.contains { $0.kind == .question })
    }
}
