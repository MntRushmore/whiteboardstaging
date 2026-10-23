import AgathonBoard
import AgathonBrain
import AgathonKit
import Foundation
import Testing
@testable import AgathonLive

/// The Live loop's learning record end to end on a test board: the kid's ink read, ticked and
/// ringed, Help me, Solve it, Now you try, a screen left, the board closed, Off, a readback, Ask's
/// problems written as a practice set, and Today's practice's stars — each turned into the attempt
/// the web would record, and saved.
@MainActor
@Suite(.serialized)
struct LearningLoopTests {
    @MainActor struct Recording {
        let store = FakeLearningStore()
        let storage = LearningMemoryStorage()
    }

    func connect(_ h: Harness, course: String? = "algebra1", daily: DailyPracticeStore? = nil) -> Recording {
        let r = Recording()
        h.loop.learning.connect(.init(store: r.store, userId: "u1", course: course, storage: r.storage, daily: daily))
        return r
    }

    func learned(_ h: Harness) async {
        await h.loop.learning.settled()
    }

    /// The clock moves on far enough for the save schedule, and the save lands.
    func saved(_ h: Harness) async {
        await learned(h)
        await h.pass(15_100)
        for _ in 0..<20 { await Task.yield() }
    }

    func only(_ h: Harness) throws -> LearningRecord {
        let all = h.loop.learning.attempts()
        #expect(all.count == 1, "one attempt: \(all.map { "\($0.problemLatex) \($0.outcome)" })")
        return try #require(all.first)
    }

    @Test func aProblemSolvedAloneIsAFirstTryAndSaved() async throws {
        let h = Harness(mode: .feedback)
        await h.start()
        let rec = connect(h)
        await h.write("2x + 3 = 11", at: Vec2(200, 120))
        await h.write("2x = 8", at: Vec2(200, 220))
        await h.write("x = 4", at: Vec2(200, 320))
        await h.pass(700)
        await learned(h)
        let a = try only(h)
        #expect(a.origin == .student)
        #expect(a.problemLatex == "2x + 3 = 11")
        #expect(a.skill == "two_step_equations")
        #expect(a.course == "algebra1")
        #expect(a.boardId == "test-board")
        #expect(a.outcome == .firstTry)
        #expect(a.linesWritten == 3 && a.linesRight == 2 && a.linesRinged == 0)
        #expect(a.finishedAt != nil)
        #expect(rec.store.rows.isEmpty, "not before the schedule says")
        await saved(h)
        #expect(rec.store.rows[a.id]?.outcome == .firstTry)
    }

    @Test func aSlipIsRingedAndItsMistakeNamed() async throws {
        let h = Harness(mode: .feedback)
        await h.start()
        _ = connect(h)
        await h.write("2x + 3 = 11", at: Vec2(200, 120))
        await h.write("2x = 8", at: Vec2(200, 220))
        await h.write("x = 5", at: Vec2(200, 320))
        await h.pass(700)
        // a ring waits for its line to look finished (`PageTiming.doubtHoldMs`)
        await h.pass(PageTiming.doubtHoldMs)
        await learned(h)
        let a = try only(h)
        #expect(a.outcome == .inProgress)
        #expect(a.linesRinged == 1 && a.linesRight == 1)
        #expect(!a.mistakes.isEmpty, "the board's own classifier named it: \(a.mistakes)")
        // the fix under it: self-corrected
        await h.write("x = 4", at: Vec2(200, 420))
        await h.pass(700)
        // a ring waits for its line to look finished (`PageTiming.doubtHoldMs`)
        await h.pass(PageTiming.doubtHoldMs)
        await learned(h)
        let fixed = try only(h)
        #expect(fixed.id == a.id)
        #expect(fixed.outcome == .selfCorrected)
    }

    @Test func helpMeIsAnAskAHintAndTheModelsMistake() async throws {
        let h = Harness(mode: .feedback)
        await h.start()
        _ = connect(h)
        await h.write("2x + 3 = 11", at: Vec2(200, 120))
        await h.write("2x = 8", at: Vec2(200, 220))
        await h.write("x = 5", at: Vec2(200, 320))
        await h.pass(700)
        let lineId = try #require(h.loop.lines.values.first { $0.latex == "x = 5" }?.id)
        h.services.checkEvents = [[
            .meta(requestId: "r1", model: "m"),
            .annotation(try JSONDecoder().decode(Annotation.self, from: Data(#"{"lineId":"\#(lineId)","verdict":"warn","kind":"concept","message":"Look again at 8 divided by 2.","confidence":0.9}"#.utf8))),
            .done(count: 1, ms: 300),
        ]]
        h.loop.helpMe()
        await h.pass(100)
        await learned(h)
        var a = try only(h)
        #expect(a.asks == 1)
        #expect(a.hints == 1)
        #expect(a.mistakes["concept"] == 1, "the model's kind: \(a.mistakes)")
        // More help: the right step beside the ring, by hand
        let card = try #require(h.loop.hints.first)
        h.loop.moreHelp(card)
        await h.pass(100)
        await learned(h)
        a = try only(h)
        #expect(a.asks == 2)
        #expect(a.tutorSteps == 1)
        // the kid finishes it: with help
        await h.write("x = 4", at: Vec2(200, 420))
        await h.pass(700)
        await learned(h)
        #expect(try only(h).outcome == .withHelp)
    }

    @Test func solveItIsTheTutorsAndNowYouTryFollowsIt() async throws {
        let h = Harness(mode: .answer, auto: false)
        await h.start()
        let rec = connect(h)
        await h.write("5x + 2 = 17", at: Vec2(200, 120))
        await h.pass(700)
        h.loop.solveIt()
        await h.pass(200)
        await learned(h)
        let solved = try only(h)
        #expect(solved.outcome == .tutorSolved)
        #expect(solved.solves == 1 && solved.asks == 1)
        let offer = try #require(h.loop.offer)
        h.loop.takeOffer()
        await h.pass(100)
        await learned(h)
        let problem = try #require(h.board.problems.first { $0.origin == "nowYouTry" })
        #expect(problem.meta[LiveLoop.parentAttemptMeta]?.stringValue == solved.id, "the record knows what it follows")
        // the kid's line under it: a Now you try attempt, its parent the one solved
        let rect = try #require(problem.meta[LiveMeta.rect].flatMap(BrainRect.init(meta:)))
        await h.write("x = 3", at: Vec2(rect.x, rect.maxY + 40), reads: "x = 3")
        await h.pass(700)
        // a ring waits for its line to look finished (`PageTiming.doubtHoldMs`)
        await h.pass(PageTiming.doubtHoldMs)
        await learned(h)
        let tries = h.loop.learning.attempts().filter { $0.origin == .nowYouTry }
        let next = try #require(tries.first)
        #expect(next.parentId == solved.id)
        #expect(next.problemLatex == offer.problem.joined(separator: "; "))
        await saved(h)
        #expect(rec.store.rows[next.id]?.parentId == solved.id)
        // the parent was saved first (in the same batch or an earlier one)
        let order = rec.store.batches.flatMap { $0.map(\.id) }
        #expect((order.firstIndex(of: solved.id) ?? .max) <= (order.firstIndex(of: next.id) ?? -1))
    }

    @Test func leavingTheScreenEndsItsProblemsAndClosingTheBoardSavesThem() async throws {
        let h = Harness(mode: .feedback)
        await h.start()
        let rec = connect(h)
        await h.write("2x + 3 = 11", at: Vec2(200, 120))
        await h.write("2x = 8", at: Vec2(200, 220))
        await h.pass(700)
        await learned(h)
        #expect(try only(h).outcome == .inProgress)
        _ = h.board.addScreen()
        await h.pass(100)
        await learned(h)
        #expect(try only(h).outcome == .unfinished)
        h.loop.stop()
        for _ in 0..<40 { await Task.yield() }
        let id = try only(h).id
        #expect(rec.store.rows[id]?.outcome == .unfinished, "saved as the board closed")
        #expect(LearningDevice.readPending("u1", rec.storage).isEmpty)
        #expect(!LearningDevice.readBoardAttempts("u1", boardId: "test-board", rec.storage).isEmpty, "kept for the next visit")
    }

    @Test func offStillRecordsTheWorkAsFeedbackWouldMarkIt() async throws {
        let h = Harness(mode: .off)
        await h.start()
        _ = connect(h)
        await h.write("2x + 3 = 11", at: Vec2(200, 120))
        await h.write("2x = 8", at: Vec2(200, 220))
        await h.write("x = 5", at: Vec2(200, 320))
        await h.pass(700)
        await learned(h)
        #expect(h.board.marks.isEmpty, "Off marks nothing")
        let a = try only(h)
        #expect(a.linesRight == 1 && a.linesRinged == 1)
    }

    @Test func workReadBeforeThisSessionIsNotNewWork() async throws {
        let h = Harness(mode: .feedback)
        await h.start()
        await h.write("2x + 3 = 11", at: Vec2(200, 120))
        await h.write("2x = 8", at: Vec2(200, 220))
        await h.pass(700)
        h.loop.stop()
        // the board opened again: its lines come back from their records, unread
        let again = LiveLoop(board: h.board, boardId: "test-board", services: h.services,
                             settings: LiveSettings(enabled: true, mode: .feedback, auto: true, checking: .asIGo), brain: TestBrain.shared,
                             background: TestBrain.background, scheduler: h.scheduler, connectivity: h.connectivity)
        let store = FakeLearningStore()
        again.learning.connect(.init(store: store, userId: "u1", course: nil, storage: LearningMemoryStorage()))
        again.start()
        for _ in 0..<3 { await again.waitUntilIdle(timeout: .seconds(20)) }
        await again.learning.settled()
        #expect(again.learning.attempts().isEmpty, "a readback says nothing")
        // a new line of that problem: now its problem is told
        let ids = h.board.kidWrites(KidHands.strokes("x = 4", at: Vec2(200, 320)))
        await h.register(ids, reads: "x = 4")
        h.scheduler.advance(700)
        for _ in 0..<3 { await again.waitUntilIdle(timeout: .seconds(20)) }
        h.scheduler.advance(100)
        for _ in 0..<3 { await again.waitUntilIdle(timeout: .seconds(20)) }
        await again.learning.settled()
        let a = try #require(again.learning.attempts().first)
        #expect(a.linesWritten == 3 && a.outcome == .firstTry)
        again.stop()
    }

    @Test func asksProblemsWrittenAsAPracticeSetArePracticeAndTodaysPracticeCountsThem() async throws {
        let h = Harness(mode: .feedback)
        await h.start()
        let daily = FakeDailyStore()
        _ = connect(h, daily: daily)
        let today = h.loop.learning.daily(day: "2026-10-18", goal: 1)
        await learned(h)
        // Ask writes one problem of a practice set: its strokes carry the problem and its cell
        let screen = h.board.currentScreenID
        await h.loop.learning.writing(.practice) {
            let meta: Meta = [
                "chatProblem": .object(["n": .number(1), "lines": .array([.string("2x + 3 = 11")]),
                                        "cell": .object(["x": .number(150), "y": .number(80), "w": .number(600), "h": .number(500)])]),
                "handBlock": .string("hb_set_1"), "lineId": .string("chat"),
            ]
            let s = StrokeRecord(screen: screen, order: h.board.store.nextOrder(on: screen), author: .tutor, color: .tutor, width: 3,
                                 pressure: .real, x: 200, y: 100, points: [InkPoint(x: 0, y: 0), InkPoint(x: 120, y: 0), InkPoint(x: 240, y: 10)],
                                 start: 0, meta: meta)
            h.board.store.put(.stroke(s), origin: .tutor)
        }
        await learned(h)
        #expect(h.loop.learning.attempts().isEmpty, "a problem written and never touched is no record")
        // the kid works it in its cell
        await h.write("2x = 8", at: Vec2(200, 220))
        await h.write("x = 4", at: Vec2(200, 320))
        await h.pass(700)
        await learned(h)
        let a = try only(h)
        #expect(a.origin == .practice)
        #expect(a.problemLatex == "2x + 3 = 11", "the set's problem, not the kid's first line")
        #expect(a.outcome == .firstTry)
        // Today's practice: one done, one star, the goal reached, the day's row saved after a moment
        #expect(today.done == 1 && today.stars == 1)
        #expect(today.reachedNow)
        await h.pass(1_300)
        for _ in 0..<10 { await Task.yield() }
        #expect(daily.saves.last?.done == 1 && daily.saves.last?.stars == 1)
        today.celebrated()
        #expect(!today.reachedNow)
    }

    @Test func nothingIsRecordedWhenRecordingIsOff() async throws {
        let h = Harness(mode: .feedback)
        await h.start()
        h.loop.learning.isEnabled = false
        let rec = connect(h)
        await h.write("2x = 8", at: Vec2(200, 220))
        await h.write("x = 4", at: Vec2(200, 320))
        await h.pass(700)
        await saved(h)
        #expect(h.loop.learning.attempts().isEmpty)
        #expect(rec.store.batches.isEmpty)
    }

    @Test func signalsSaidBeforeTheRecordIsConnectedAreKept() async throws {
        let h = Harness(mode: .feedback)
        await h.start()
        await h.write("2x + 3 = 11", at: Vec2(200, 120))
        await h.write("2x = 8", at: Vec2(200, 220))
        await h.pass(700)
        #expect(h.loop.learning.attempts().isEmpty)
        _ = connect(h)
        await learned(h)
        #expect(try only(h).linesRight == 1)
    }
}

/// Today's practice's count, as the web's progressReducer counts.
struct DailyProgressTests {
    func r(_ id: String, _ outcome: LearningOutcome, origin: LearningOrigin = .practice, problem: String = "", board: String = "b1") -> LearningRecord {
        LearningRecord(id: id, boardId: board, problemLatex: problem.isEmpty ? "p\(id)" : problem, skill: "other", course: nil, origin: origin,
                       parentId: nil, outcome: outcome, startedAt: "2026-10-18T15:00:00.000Z", updatedAt: "2026-10-18T15:00:00.000Z", finishedAt: nil)
    }

    @Test func eachProblemOnceWithAStarWhenSolvedAlone() {
        var p = DailyProgress(goal: 5)
        for rec in [r("a", .inProgress), r("a", .firstTry), r("a", .firstTry), r("b", .withHelp), r("c", .selfCorrected)] { p.attempt(rec, boardId: "b1") }
        #expect(p.done == 3 && p.stars == 2 && !p.reachedNow)
        for id in ["d", "e"] { p.attempt(r(id, .tutorSolved), boardId: "b1") }
        #expect(p.done == 5 && p.reachedNow)
    }

    @Test func notTheStudentsOwnNorAnotherBoardsNorUnfinished() {
        var p = DailyProgress(goal: 5)
        p.attempt(r("a", .firstTry, origin: .student), boardId: "b1")
        p.attempt(r("b", .firstTry, origin: .nowYouTry), boardId: "b1")
        p.attempt(r("c", .firstTry, board: "b2"), boardId: "b1")
        p.attempt(r("d", .unfinished), boardId: "b1")
        p.attempt(r("e", .firstTry, origin: .tutorProblem), boardId: "b1")
        #expect(p.done == 1)
    }

    @Test func aProblemAnsweredAgainIsNotOneMoreAndTheStarFollowsItsLatestOutcome() {
        var p = DailyProgress(goal: 5)
        p.attempt(r("a", .firstTry, problem: "2x + 3 = 11"), boardId: "b1")
        p.attempt(r("a2", .firstTry, problem: "2x+3 = 11"), boardId: "b1")
        #expect(p.done == 1 && p.stars == 1)
        p.attempt(r("a", .withHelp, problem: "2x + 3 = 11"), boardId: "b1")
        #expect(p.stars == 0)
        p.saved(stars: 1)
        #expect(p.stars == 1, "never fewer than the row was saved with")
    }

    @Test func whatWasCountedElsewhereIsNotCountedAgain() {
        var p = DailyProgress(goal: 5)
        p.attempt(r("a", .firstTry, problem: "7 + 5"), boardId: "b1")
        p.restore(done: 3, stars: 2, counted: [DailyProgress.problemKey("7 + 5")])
        #expect(p.done == 3 && p.stars == 2)
        p.attempt(r("z", .firstTry, problem: "7+5"), boardId: "b1")
        #expect(p.done == 3)
        #expect(p.counted.contains("p:7+5"))
    }
}
