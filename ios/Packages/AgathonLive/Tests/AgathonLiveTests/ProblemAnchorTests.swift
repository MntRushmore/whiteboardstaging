import AgathonBoard
import AgathonBrain
import AgathonKit
import Foundation
import Testing
@testable import AgathonLive

/// The owner's board (2026-10-18): the kid wrote `36 + 24 =` and the tutor answered it; the tutor
/// then wrote "Now you try" `36 + 43` under it, and the kid wrote `= 79` beside that problem, on its
/// row. The `= 79` is the answer to the tutor's problem, never a step of the first sum.
@MainActor
@Suite(.serialized)
struct ProblemAnchorTests {
    /// `36 + 24 =` (ink of the fixture's `36 + 2 =`, read as the owner wrote it) in Solve, answered.
    func firstSum(_ h: Harness) async -> [RecordID] {
        let ids = await h.write("36 + 2 =", at: Vec2(200, 120), reads: "36 + 24 =")
        await h.pass(3_500)
        return ids
    }

    /// The kid's `= <answer>` beside the tutor's problem, on its row: the `= 8` of `2x = 8`'s ink.
    func answerBeside(_ h: Harness, _ problem: ProblemRecord, reads: String) async -> [RecordID] {
        let rect = try! #require(problem.meta[LiveMeta.rect].flatMap(BrainRect.init(meta:)))
        let ink = Array(KidHands.strokes("2x = 8", at: Vec2(0, 0)).dropFirst(3))
        let xs = ink.flatMap { $0.map(\.x) }, ys = ink.flatMap { $0.map(\.y) }
        let dx = rect.maxX + 14 - (xs.min() ?? 0)
        let dy = rect.y + rect.h / 2 - ((ys.min() ?? 0) + (ys.max() ?? 0)) / 2
        let ids = h.board.kidWrites(ink.map { $0.map { Vec2($0.x + dx, $0.y + dy) } })
        await h.register(ids, reads: reads)
        return ids
    }

    func tutorProblem(_ h: Harness) async throws -> ProblemRecord {
        #expect(await h.loop.writeProblem(["36 + 43"], origin: "nowYouTry", parent: "36 + 24 ="))
        await h.pass(100)
        return try #require(h.board.problems.first { $0.origin == "nowYouTry" })
    }

    func answers(_ h: Harness) -> [String] {
        h.board.writes.compactMap { w in w.meta[LiveMeta.answerFor] != nil || w.meta[LiveMeta.nextStepFor] != nil || w.meta[LiveMeta.solvedLatex] != nil || w.meta[LiveMeta.suggestFor] != nil ? "\(w.latex.joined(separator: " | ")) [\(w.meta.keys.sorted().joined(separator: ","))]" : nil }
            + h.board.store.records.values.compactMap { if case .math(let m) = $0 { return "typeset \(m.latex)" } else { return nil } }
    }

    @Test func theSumIsAnsweredOnce() async throws {
        let h = Harness(mode: .answer)
        await h.start()
        _ = await firstSum(h)
        let written = answers(h)
        #expect(h.board.tutorStrokes(withMeta: "answerFor", "36 + 24 =").first?.meta["answerLatex"]?.stringValue == "60")
        #expect(written.count == 1, "one answer, once: \(written)")
        // asking for help on it again writes nothing more
        h.loop.helpMe()
        await h.pass(3_000)
        h.loop.solveIt()
        await h.pass(3_000)
        #expect(answers(h).count == 1, "still one answer: \(answers(h))")
        // Next step's Help me on the answered sum: its `=` already has the answer, nothing under it
        h.loop.settings.mode = .suggest
        await h.pass(100)
        h.loop.helpMe()
        await h.pass(3_000)
        #expect(answers(h).count == 1, "no '= 60' under the line: \(answers(h))")
    }

    @Test func anAnswerStartedWithEqualsUnderASumThatEndsWithOneIsNeverRinged() async throws {
        // no tutor problem at all: `36 + 24 =`, then `= 79` under it — whose answer is that? Quiet.
        let h = Harness(mode: .answer)
        await h.start()
        _ = await firstSum(h)
        let ink = Array(KidHands.strokes("2x = 8", at: Vec2(0, 0)).dropFirst(3))
        let ids = h.board.kidWrites(ink.map { $0.map { Vec2($0.x + 230, $0.y + 230) } })
        await h.register(ids, reads: "= 79")
        await h.pass(3_500)
        #expect(h.board.mark(on: "= 79") != .ring)
        #expect(h.board.tutorStrokes(withMeta: "suggestFor").isEmpty)
    }

    @Test func workUnderTheTutorsProblemIsJudgedAgainstIt() async throws {
        // the kid's own sum above, the tutor's problem under it, the kid's lines under that
        let h = Harness(mode: .feedback)
        await h.start()
        await h.write("2x + 3 = 11", at: Vec2(200, 120), reads: "4x = 12")
        await h.write("x = 3", at: Vec2(200, 220))
        await h.pass(700)
        #expect(await h.loop.writeProblem(["2x + 3 = 11"], origin: "nowYouTry", parent: "4x = 12"))
        await h.pass(100)
        let rect = try #require(h.board.problems.first { $0.origin == "nowYouTry" }?.meta[LiveMeta.rect].flatMap(BrainRect.init(meta:)))
        await h.write("2x = 8", at: Vec2(rect.x, rect.maxY + 40))
        await h.pass(700)
        #expect(h.board.mark(on: "2x = 8") == .tick, "2x = 8 follows from the tutor's 2x + 3 = 11, not from the kid's x = 3")
        #expect(h.board.mark(on: "x = 3") == .tick)
    }

    @Test func theRightAnswerBesideTheTutorsProblemIsTicked() async throws {
        let h = Harness(mode: .answer)
        await h.start()
        _ = await firstSum(h)
        let problem = try await tutorProblem(h)
        let before = answers(h)
        _ = await answerBeside(h, problem, reads: "= 79")
        await h.pass(3_500)
        #expect(h.board.mark(on: "= 79") == .tick, "79 is 36 + 43")
        #expect(answers(h) == before, "nothing written for it: \(answers(h))")
        #expect(h.loop.lines.values.first { $0.latex == "= 79" }?.analysis?.verdict == "ok")
    }

    @Test func aWrongAnswerBesideTheTutorsProblemIsRingedAgainstItsOwnSum() async throws {
        let h = Harness(mode: .answer)
        await h.start()
        _ = await firstSum(h)
        let problem = try await tutorProblem(h)
        _ = await answerBeside(h, problem, reads: "= 89")
        await h.pass(3_500)
        #expect(h.board.mark(on: "= 89") == .ring)
        let step = h.board.tutorStrokes(withMeta: "suggestFor", "= 89")
        #expect(step.first?.meta["handLine"]?.stringValue.map { $0.contains("79") } == true, "the right step is 36 + 43's: \(step.first?.meta["handLine"]?.stringValue ?? "none")")
        #expect(!answers(h).contains { $0.contains("= 60") && $0.contains("suggestFor") })
        // the ring keeps off the tutor's problem
        let ring = try #require(h.board.marks.first { $0.kind == .ring })
        let ringBox = try #require(BrainRect.around(ring.strokes.compactMap { h.board.store.stroke($0) }.map(StrokeBounds.of)))
        let rect = try #require(problem.meta[LiveMeta.rect].flatMap(BrainRect.init(meta:)))
        #expect(ringBox.x >= rect.maxX, "the ring starts after the problem: ring \(ringBox), problem \(rect)")
    }
}
