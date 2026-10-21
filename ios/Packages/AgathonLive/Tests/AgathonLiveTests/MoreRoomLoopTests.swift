import AgathonBoard
import AgathonBrain
import AgathonKit
import Foundation
import Testing
@testable import AgathonLive

/// "More room" in the loop (docs/PROBLEM-PAGES.md), on the test clock with the real brain: a problem
/// whose work runs off the bottom of its page goes on on a new page, and the pages are one problem's
/// work — the column flows from the bottom of page 1 to the top of page 2 (a running total, an answer
/// started with `=`), a check on any page checks every page and marks each on its own page, Next shows
/// on whichever page is on show once the problem is solved and goes past its pages, the long pause
/// and the safety net cover the page left, the learning record counts one attempt, and "New page for
/// this one" still gives a second problem a page of its own.
@MainActor
@Suite(.serialized)
struct MoreRoomLoopTests {
    /// A problem page of a set (`index` of `count`) with the tutor's problem across its top, as
    /// `ProblemPageWriter` writes it, on the current screen; and the next problem's page after it.
    @discardableResult
    func problemPage(_ h: Harness, _ problem: [String], index: Int = 1, count: Int = 2) -> RecordID {
        let screen = h.board.currentScreenID
        h.board.setProblemPage(ProblemPage(setId: "daily:test", index: index, count: count, origin: "practice"), on: screen)
        let meta: Meta = ["chatProblem": .object(["n": 1, "lines": .array(problem.map { .string($0) }),
                                                  "cell": .object(["x": 40, "y": 40, "w": 1520, "h": 840])]),
                          "lineId": "chat", "live": true, "source": "ai", "handBlock": "hb_test"]
        for k in 0..<3 {
            let s = StrokeRecord(screen: screen, order: h.board.store.nextOrder(on: screen), author: .tutor, color: .tutor, width: 4,
                                 pressure: .real, x: 88, y: 64 + Double(k) * 20,
                                 points: [InkPoint(x: 0, y: 0), InkPoint(x: 160, y: 6), InkPoint(x: 320, y: 0)], meta: meta)
            h.board.store.put(.stroke(s), origin: .tutor)
        }
        // the set's next problem, on the page after
        var next = ScreenRecord(order: h.board.store.screenOrder(after: screen))
        next.problemPage = ProblemPage(setId: "daily:test", index: index + 1, count: count, origin: "practice")
        h.board.store.put(.screen(next), origin: .tutor)
        h.loop.problemsChanged()
        return next.id
    }

    func harness(mode: LiveMode = .feedback, auto: Bool = true, checking: CheckTiming = .whenDone) -> Harness {
        let h = Harness(mode: mode, auto: auto, checking: checking)
        h.loop.pages.extras = true
        h.loop.settings.showReadings = true
        return h
    }

    /// The tutor's mark on the line that reads `latex` on `screen` (the page on show by default).
    func mark(_ h: Harness, _ latex: String, on screen: RecordID? = nil) -> AgathonBoard.MarkKind? {
        let page = screen ?? h.board.currentScreenID
        guard let l = h.board.lineRecords.first(where: { $0.latex == latex && $0.screen == page }) else { return nil }
        return h.board.marks.first { $0.target == l.id && $0.screen == page }?.kind
    }

    func line(_ h: Harness, _ latex: String) -> LiveLine? {
        h.loop.lines.values.first { $0.latex == latex }
    }

    /// Goes on to a new page for the problem, as the kid's tap does.
    func moreRoom(_ h: Harness) async -> RecordID {
        h.loop.moreRoom()
        await h.idle()
        return h.board.currentScreenID
    }

    // MARK: - the column flows on

    /// The owner's running total (`403 + 364 − 336`), its first step at the bottom of page 1: on page 2,
    /// `+3 = 767` goes on from `400 + 364 = 764` (read alone, with nothing above it, it is left unjudged)
    /// and `−336 = 431` answers the problem.
    @Test func aRunningTotalGoesOnAcrossThePageBreak() async throws {
        let h = harness(checking: .asIGo)
        await h.start()
        let first = h.board.currentScreenID
        let nextProblem = problemPage(h, ["403 + 364 - 336"])
        await h.pass(500)
        #expect(!h.loop.pages.moreRoom, "room left on the page")
        // big handwriting: its first step already in the last row — More room
        await h.write("x = 4", at: Vec2(200, 600), reads: "400+364=764")
        await h.pass(3_000)
        #expect(mark(h, "400+364=764") == .tick)
        #expect(h.loop.pages.moreRoom, "the work reached the last row")
        let second = await moreRoom(h)
        #expect(second != first)
        #expect(h.board.store.screenIDs == [first, second, nextProblem], "right after the problem's page, before the next problem")
        let page = try #require(h.board.store[second]?.screen?.problemPage)
        #expect(page.continues == first && page.index == 1 && page.count == 2 && page.hasAnswerSpot)
        #expect(h.board.store[first]?.screen?.problemPage?.more == true)
        #expect(!h.loop.pages.moreRoom)
        #expect(h.loop.pages.readings.isEmpty, "page 1's lines are not this page's")
        // the work goes on at the top of page 2
        await h.write("x = 3", at: Vec2(200, 230), reads: "+3=767")
        await h.write("x = 5", at: Vec2(200, 330), reads: "-336=431")
        await h.pass(5_000)
        #expect(mark(h, "+3=767") == .tick, "\(String(describing: line(h, "+3=767")?.analysis))")
        #expect(mark(h, "-336=431") == .tick)
        #expect(line(h, "-336=431")?.analysis?.solved == true, "\(String(describing: line(h, "-336=431")?.analysis))")
        #expect(h.loop.pages.action == .next(last: false), "solved: Next")
        // its marks on its own page; page 1's stay on page 1
        #expect(h.board.marks.filter { $0.screen == second }.count == 2)
        #expect(mark(h, "400+364=764", on: first) == .tick)
        // the problem's record lists its lines on both pages, in order; each line points at it
        let problem = try #require(h.board.problems.first { $0.origin != "student" })
        #expect(problem.screen == first)
        let order = problem.lines.compactMap { id in h.board.lineRecords.first { $0.id == id }?.latex }
        #expect(order == ["400+364=764", "+3=767", "-336=431"], "\(order)")
        #expect(h.board.lineRecords.filter { $0.screen == second }.allSatisfy { $0.problem == problem.id })
        // back to page 1 and on again: page 2 is judged the same (its work still goes on from page 1)
        h.board.goToScreen(first)
        await h.pass(500)
        #expect(h.loop.pages.action == .next(last: false), "Next on whichever page of the problem is on show")
        h.board.goToScreen(second)
        await h.pass(500)
        #expect(line(h, "+3=767")?.analysis?.verdict == "ok")
        #expect(mark(h, "+3=767") == .tick)
    }

    /// An answer started with `=` at the top of page 2 answers the line at the bottom of page 1.
    @Test func anAnswerStartedWithEqualsGoesOnFromThePageBefore() async throws {
        let h = harness(checking: .asIGo)
        await h.start()
        problemPage(h, ["403 + 364 - 336"])
        await h.write("x = 4", at: Vec2(200, 300), reads: "400+364=764")
        await h.write("x = 3", at: Vec2(200, 420), reads: "764+3=767")
        await h.write("2x = 8", at: Vec2(200, 600), reads: "767-336")
        await h.pass(3_000)
        _ = await moreRoom(h)
        await h.write("x = 5", at: Vec2(200, 230), reads: "=431")
        await h.pass(4_000)
        #expect(mark(h, "=431") == .tick, "\(String(describing: line(h, "=431")?.analysis))")
        #expect(line(h, "=431")?.analysis?.solved == true)
    }

    // MARK: - check when done covers every page

    @Test func aCheckOnPage2ChecksPage1AndMarksEachPageAndTheRecordCountsOneAttempt() async throws {
        let h = harness(checking: .whenDone)
        await h.start()
        let store = FakeLearningStore()
        h.loop.learning.connect(.init(store: store, userId: "u1", course: "algebra1", storage: LearningMemoryStorage()))
        let first = h.board.currentScreenID
        problemPage(h, ["2x + 3 = 11"])
        await h.write("2x = 8", at: Vec2(200, 600))
        await h.pass(3_000)
        #expect(h.board.marks.isEmpty, "quiet while they work")
        let second = await moreRoom(h)
        // nothing written here yet, page 1's work still to check: Check shows
        #expect(h.loop.pages.action == .check)
        // the answer, in page 2's answer spot: the check covers page 1 too
        await h.write("x = 4", at: Vec2(300, 768))
        await h.pass(2_500)
        #expect(mark(h, "x = 4") == .tick)
        #expect(mark(h, "2x = 8", on: first) == .tick, "page 1's step, marked on page 1")
        #expect(h.board.marks.allSatisfy { m in h.board.lineRecords.first { $0.id == m.target }?.screen == m.screen }, "every mark on its line's page")
        #expect(h.board.lineRecords.first { $0.latex == "2x = 8" }?.meta[PageMeta.checked]?.stringValue == "2x = 8")
        #expect(h.loop.pages.solved && h.loop.pages.action == .next(last: false))
        #expect(h.loop.hints.isEmpty && h.loop.note == nil)
        // one attempt for the problem, with its lines on both pages
        await h.loop.learning.settled()
        let all = h.loop.learning.attempts()
        #expect(all.count == 1, "\(all.map { "\($0.problemLatex) \($0.outcome) \($0.linesWritten)" })")
        let a = try #require(all.first)
        #expect(a.problemLatex == "2x + 3 = 11")
        #expect(a.linesWritten == 2 && a.linesRight == 2 && a.outcome == .firstTry, "\(a)")
        #expect(h.loop.learn.keys.isEmpty || Set(h.loop.learn.keys.orderedValues).count <= 1)
        _ = second
    }

    @Test func aSlipOnPage1IsRingedThereAndPointedAtFromPage2() async throws {
        let h = harness(checking: .whenDone)
        await h.start()
        let first = h.board.currentScreenID
        problemPage(h, ["2x + 3 = 11"])
        await h.write("2x = 8", at: Vec2(200, 600), reads: "2x=6")
        await h.pass(3_000)
        _ = await moreRoom(h)
        await h.write("x = 3", at: Vec2(300, 768))
        await h.pass(2_500)
        #expect(mark(h, "2x=6", on: first) == .ring, "the slip, ringed on its own page")
        #expect(mark(h, "x = 3") != .ring, "carried on from the slip: no ring of its own")
        #expect(!h.loop.pages.solved)
        if h.loop.hints.isEmpty {
            #expect(h.loop.note == LiveCopy.Pages.lookBack(1), "\(String(describing: h.loop.note))")
        }
    }

    @Test func theLongPauseOnPage2ChecksTheWorkLeftOnPage1() async throws {
        let h = harness(checking: .whenDone)
        await h.start()
        let first = h.board.currentScreenID
        problemPage(h, ["2x + 3 = 11"])
        await h.write("2x = 8", at: Vec2(200, 600))
        await h.pass(2_000)
        _ = await moreRoom(h)
        await h.pass(5_000)
        #expect(h.board.marks.isEmpty, "still thinking")
        // 9 s after the last ink (on page 1): checked, marked on page 1
        await h.pass(3_000)
        #expect(mark(h, "2x = 8", on: first) == .tick)
        #expect(h.loop.pages.action == nil, "nothing left to check")
    }

    @Test func nextGoesPastTheProblemsPages() async throws {
        let h = harness(checking: .whenDone)
        await h.start()
        let first = h.board.currentScreenID
        let nextProblem = problemPage(h, ["2x + 3 = 11"])
        await h.write("2x = 8", at: Vec2(200, 600))
        await h.pass(2_000)
        _ = await moreRoom(h)
        await h.write("x = 4", at: Vec2(300, 768))
        await h.pass(2_500)
        #expect(h.loop.pages.action == .next(last: false))
        // from page 1 too, once solved (on page 2)
        h.board.goToScreen(first)
        await h.pass(500)
        #expect(h.loop.pages.action == .next(last: false))
        h.loop.nextPage()
        await h.idle()
        #expect(h.board.currentScreenID == nextProblem, "past the problem's other page")
    }

    // MARK: - "I read" and its fixes, across the page break

    /// Page 1's last step misread (`746`): page 2's running total goes on from the misread and is ringed.
    /// Fixed on page 1, page 2 is judged again from the fixed reading — marked on page 2, from page 1.
    @Test func aReadingFixedOnPage1JudgesPage2Again() async throws {
        let h = harness(checking: .asIGo)
        await h.start()
        let first = h.board.currentScreenID
        problemPage(h, ["403 + 364 - 336"])
        await h.write("x = 4", at: Vec2(200, 600), reads: "400+364=746")
        await h.pass(3_000)
        #expect(mark(h, "400+364=746") == .ring)
        let second = await moreRoom(h)
        await h.write("x = 3", at: Vec2(200, 230), reads: "+3=767")
        await h.pass(4_000)
        #expect(mark(h, "+3=767") != .tick, "746 + 3 is not 767")
        // back to page 1: the kid fixes what the tutor read
        h.board.goToScreen(first)
        await h.pass(500)
        let misread = try #require(line(h, "400+364=746"))
        h.loop.useReading(misread.id, latex: "400+364=764")
        await h.pass(1_000)
        #expect(mark(h, "400+364=764") == .tick)
        #expect(mark(h, "+3=767", on: second) == .tick, "page 2 goes on from the fixed reading")
        #expect(h.board.currentScreenID == first)
    }

    // MARK: - the kid's own problem over two pages

    @Test func theKidsOwnProblemOverTwoPagesIsOneAttempt() async throws {
        let h = harness(checking: .asIGo)
        await h.start()
        let store = FakeLearningStore()
        h.loop.learning.connect(.init(store: store, userId: "u1", course: "algebra1", storage: LearningMemoryStorage()))
        h.board.setProblemPage(ProblemPage(origin: "student"), on: h.board.currentScreenID)
        await h.write("2x + 3 = 11", at: Vec2(88, 70))
        await h.write("2x = 8", at: Vec2(200, 600))
        await h.pass(3_000)
        #expect(mark(h, "2x = 8") == .tick)
        let second = await moreRoom(h)
        // the kid's own problem, again small, at the top: the tutor's copy, never read as work
        #expect(h.board.store.drawables(on: second).allSatisfy { $0.meta[MoreRoom.reminderMeta] != nil })
        #expect(!h.board.tutorStrokes.filter { $0.screen == second }.isEmpty)
        await h.write("x = 4", at: Vec2(200, 230))
        await h.pass(3_000)
        #expect(mark(h, "x = 4") == .tick)
        #expect(line(h, "x = 4")?.analysis?.solved == true)
        await h.loop.learning.settled()
        let all = h.loop.learning.attempts()
        #expect(all.count == 1, "\(all.map { "\($0.problemLatex) \($0.outcome) \($0.linesWritten)" })")
        let a = try #require(all.first)
        #expect(a.origin == .student && a.problemLatex == "2x + 3 = 11")
        #expect(a.linesWritten == 3 && a.outcome == .firstTry, "\(a)")
        // the kid's problem record holds its lines on both pages
        let own = try #require(h.board.problems.first { $0.origin == "student" })
        #expect(own.lines.count == 3 && h.board.problems.filter { $0.origin == "student" }.count == 1, "\(h.board.problems)")
    }

    // MARK: - More room

    @Test func moreRoomIsOfferedOnTheProblemsLastPageOnceItIsFull() async throws {
        let h = harness(checking: .whenDone)
        await h.start()
        let first = h.board.currentScreenID
        problemPage(h, ["2x + 3 = 11"])
        // the answer spot is no row of the work (an answer not yet right: still working)
        await h.write("x = 5", at: Vec2(300, 768))
        await h.pass(3_000)
        #expect(!h.loop.pages.moreRoom)
        await h.write("2x = 8", at: Vec2(200, 600), reads: "2x=6")
        await h.pass(1_000)
        #expect(h.loop.pages.moreRoom)
        let second = await moreRoom(h)
        // page 1 is no longer the problem's last: no More room there, and no answer spot
        h.board.goToScreen(first)
        await h.pass(500)
        #expect(!h.loop.pages.moreRoom)
        #expect(!h.loop.inAnswerSpot(BrainRect(x: 300, y: 768, w: 120, h: 40)))
        h.board.goToScreen(second)
        await h.pass(500)
        #expect(h.loop.inAnswerSpot(BrainRect(x: 300, y: 768, w: 120, h: 40)))
        // a plain page: none
        let plain = ScreenRecord(order: h.board.store.screenOrder(after: second))
        h.board.store.put(.screen(plain), origin: .kid)
        h.board.goToScreen(plain.id)
        await h.write("2x = 8", at: Vec2(200, 600))
        await h.pass(2_000)
        #expect(!h.loop.pages.moreRoom)
    }

    /// A second problem started on a continued page is still offered a page of its own — a new
    /// problem, after the problem's pages, no page of it.
    @Test func newPageForThisOneStillWorksAndIsNoMoreRoom() async throws {
        let h = harness(checking: .whenDone)
        await h.start()
        let first = h.board.currentScreenID
        let nextProblem = problemPage(h, ["2x + 3 = 11"])
        await h.write("2x = 8", at: Vec2(200, 600))
        await h.pass(2_000)
        let second = await moreRoom(h)
        await h.write("x = 4", at: Vec2(200, 230))
        await h.write("5x + 2 = 17", at: Vec2(200, 400), reads: "5y + 2 = 17")
        h.loop.checkPage()
        await h.pass(3_000)
        let offer = try #require(h.loop.pages.offer)
        #expect(offer.id == line(h, "5y + 2 = 17")?.id)
        h.loop.takeNewPage()
        await h.idle()
        let own = h.board.currentScreenID
        #expect(h.board.store.screenIDs == [first, second, own, nextProblem], "after the problem's pages")
        let page = try #require(h.board.store[own]?.screen?.problemPage)
        #expect(page.origin == "student" && page.continues == nil)
        #expect(h.board.store.problemGroup(of: own) == nil)
        #expect(h.board.store.problemGroup(of: second)?.pages == [first, second])
    }
}
