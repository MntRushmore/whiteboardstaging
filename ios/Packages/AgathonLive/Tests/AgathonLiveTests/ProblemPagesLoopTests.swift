import AgathonBoard
import AgathonBrain
import AgathonKit
import Foundation
import Testing
@testable import AgathonLive

/// Problem pages in the loop (docs/PROBLEM-PAGES.md), on the test clock with the real brain: check
/// when done (held lines, each trigger, unfinished lines never judged, one hint), the judging rules
/// (a true step is never ringed, one answer of several is no slip), one page one problem (the page's
/// problem heads every column; a second problem is offered its own page, moved as one undo step),
/// "I read" and its fixes, Next.
@MainActor
@Suite(.serialized)
struct ProblemPagesLoopTests {
    /// A problem page of a set with the tutor's problem written at its top (Ask's chat-problem strokes,
    /// as `ProblemPageWriter` writes them), on the current screen.
    @discardableResult
    func problemPage(_ h: Harness, _ problem: [String], index: Int = 1, count: Int = 3, set: String = "daily:test") -> [RecordID] {
        let screen = h.board.currentScreenID
        h.board.setProblemPage(ProblemPage(setId: set, index: index, count: count, origin: "practice"), on: screen)
        let meta: Meta = ["chatProblem": .object(["n": 1, "lines": .array(problem.map { .string($0) }),
                                                  "cell": .object(["x": 40, "y": 40, "w": 1520, "h": 840])]),
                          "lineId": "chat", "live": true, "source": "ai"]
        var ids: [RecordID] = []
        for k in 0..<3 {
            let s = StrokeRecord(screen: screen, order: h.board.store.nextOrder(on: screen), author: .tutor, color: .tutor, width: 4,
                                 pressure: .real, x: 88, y: 64 + Double(k) * 20,
                                 points: [InkPoint(x: 0, y: 0), InkPoint(x: 160, y: 6), InkPoint(x: 320, y: 0)], meta: meta)
            h.board.store.put(.stroke(s), origin: .tutor)
            ids.append(s.id)
        }
        h.loop.problemsChanged()
        return ids
    }

    /// A harness with problem pages' second part on (check when done, "I read", the page's rules).
    func harness(mode: LiveMode = .feedback, auto: Bool = true, checking: CheckTiming = .whenDone) -> Harness {
        let h = Harness(mode: mode, auto: auto, checking: checking)
        h.loop.pages.extras = true
        h.loop.settings.showReadings = true
        return h
    }

    /// The tutor's mark on this page's line that reads `latex`.
    func markHere(_ h: Harness, _ latex: String) -> AgathonBoard.MarkKind? {
        guard let l = h.board.lineRecords.first(where: { $0.latex == latex && $0.screen == h.board.currentScreenID }) else { return nil }
        return h.board.marks.first { $0.target == l.id }?.kind
    }

    func line(_ h: Harness, _ latex: String) -> LiveLine? {
        h.loop.lines.values.first { $0.latex == latex }
    }

    // MARK: - check when done

    /// A line's cheer goes where its "I read" chip goes when a big hand's line reaches the margin lane:
    /// the chip steps aside while the cheer is on show, and comes back after.
    @Test func aLinesChipStepsAsideWhileItsCheerShows() async throws {
        let h = harness(checking: .whenDone)
        await h.start()
        problemPage(h, ["2x + 3 = 11"])
        await h.write("2x = 8", at: Vec2(200, 280))
        await h.pass(2_000)
        let right = try #require(line(h, "2x = 8"))
        #expect(h.loop.pages.readings.contains { $0.id == right.id })
        h.loop.checkPage()
        await h.pass(1_000)
        #expect(h.loop.cheers.contains { $0.lineId == right.id }, "a tick cheers")
        #expect(!h.loop.pages.readings.contains { $0.id == right.id }, "no chip under the cheer")
        await h.pass(2_500)
        #expect(h.loop.cheers.isEmpty)
        #expect(h.loop.pages.readings.contains { $0.id == right.id }, "the chip is back")
    }


    @Test func heldLinesWriteNoMarksAndTellTheRecordNothingUntilCheck() async throws {
        let h = harness(checking: .whenDone)
        await h.start()
        problemPage(h, ["2x + 3 = 11"])
        await h.write("2x = 8", at: Vec2(200, 280))
        await h.write("x = 5", at: Vec2(200, 360))
        await h.pass(4_000)
        #expect(h.board.marks.isEmpty, "quiet while they work: \(h.board.marks.map(\.kind))")
        let right = try #require(line(h, "2x = 8"))
        let slip = try #require(line(h, "x = 5"))
        #expect(h.loop.learn.sent[right.id] == nil && h.loop.learn.sent[slip.id] == nil, "the record hears a line when it is checked")
        #expect(h.loop.pages.action == .check)
        #expect(h.loop.hints.isEmpty)
        // the readings show, quietly
        #expect(Set(h.loop.pages.readings.map(\.latex)) == ["2x = 8", "x = 5"])
        h.loop.checkPage()
        await h.pass(500)
        #expect(h.board.mark(on: "2x = 8") == .tick)
        #expect(h.board.mark(on: "x = 5") == .ring)
        #expect(h.loop.learn.sent[right.id] != nil && h.loop.learn.sent[slip.id] != nil)
        // one hint: the first slip's
        #expect(h.loop.hints.count == 1 && h.loop.hints.first?.lineId == slip.id)
        #expect(h.loop.pages.action == nil, "nothing left to check")
        // checked lines carry their reading on their records
        let rec = try #require(h.board.lineRecords.first { $0.latex == "2x = 8" })
        #expect(rec.meta[PageMeta.checked]?.stringValue == "2x = 8")
    }

    @Test func theLongPauseChecksWithAutoOnAndNotOff() async throws {
        let h = harness(checking: .whenDone)
        await h.start()
        problemPage(h, ["2x + 3 = 11"])
        await h.write("x = 5", at: Vec2(200, 280))
        await h.pass(8_000)
        #expect(h.board.marks.isEmpty, "8 s: still working")
        await h.pass(2_000)
        #expect(h.board.mark(on: "x = 5") == .ring, "a long pause (9 s from the last stroke) checks")

        let off = harness(auto: false, checking: .whenDone)
        await off.start()
        problemPage(off, ["2x + 3 = 11"])
        await off.write("x = 5", at: Vec2(200, 280))
        await off.pass(15_000)
        #expect(off.board.marks.isEmpty, "Auto off: no pause check (it waits for Check, as for Help me)")
        off.loop.checkPage()
        await off.pass(500)
        #expect(off.board.mark(on: "x = 5") == .ring, "the check is the kid's ask: marked with Auto off too")
    }

    @Test func theAnswerSpotChecksAfterItsQuiet() async throws {
        let h = harness(checking: .whenDone)
        await h.start()
        problemPage(h, ["2x + 3 = 11"])
        await h.write("2x = 8", at: Vec2(200, 280))
        // the answer, in the answer spot (88…960 × 744…860)
        await h.write("x = 4", at: Vec2(300, 768))
        await h.pass(1_000)
        let answer = try #require(line(h, "x = 4"))
        #expect(h.loop.inAnswerSpot(answer.bounds), "\(answer.bounds)")
        #expect(h.board.marks.isEmpty, "the answer spot waits a moment (a 12 is not judged at its 1)")
        await h.pass(800)
        #expect(h.board.mark(on: "2x = 8") == .tick && h.board.mark(on: "x = 4") == .tick)
        #expect(h.loop.pages.solved)
        #expect(h.loop.pages.action == .next(last: false), "solved, in a set: Next")
        // the answer's "I read" stays clear of the action corner (Next sits there)
        let chip = try #require(h.loop.pages.readings.first { $0.id == answer.id })
        #expect(chip.at.x < ProblemPageLayout.actions.x, "\(chip.at)")
    }

    @Test func aReadThatLandsAfterTheAnswerSpotsCheckIsCheckedByThePause() async throws {
        let h = harness(checking: .whenDone)
        await h.start()
        problemPage(h, ["2x + 3 = 11"])
        // a slow network: the reads have not landed when the answer spot's check runs
        h.services.holdReadsNow()
        h.idleTimeout = .milliseconds(100)
        await h.write("2x = 8", at: Vec2(200, 280))
        await h.write("x = 4", at: Vec2(300, 768))
        await h.pass(1_600)
        // the check waits for the reads, then goes without them (the lines are still being read)
        await h.pass(PageTiming.readWaitMs)
        #expect(h.board.marks.isEmpty)
        h.idleTimeout = .seconds(20)
        h.services.releaseReads()
        await h.pass(200)
        #expect(line(h, "x = 4") != nil, "read")
        // the long pause after the last ink (9 s) checks what the answer spot's check could not
        await h.pass(1_000)
        #expect(h.board.mark(on: "2x = 8") == .tick && h.board.mark(on: "x = 4") == .tick, "\(h.board.marks.map(\.kind))")
        #expect(h.loop.pages.action == .next(last: false))
    }

    @Test func anUnfinishedLineIsNeverJudged() async throws {
        let h = harness(checking: .whenDone)
        await h.start()
        problemPage(h, ["2x + 3 = 11"])
        await h.write("2x = 8", at: Vec2(200, 280), reads: "2x =")
        await h.write("x = 5", at: Vec2(200, 360), reads: "x = 5")
        await h.pass(1_000)
        h.loop.checkPage()
        await h.pass(500)
        #expect(h.board.mark(on: "2x =") == nil, "`2x =` has no other side yet")
        #expect(h.board.mark(on: "x = 5") == .ring)
        #expect(h.loop.isHeld(try #require(line(h, "2x ="))))
        // the pause never judges the line the pen is on: a stroke in it a moment ago
        let p = harness(checking: .whenDone)
        await p.start()
        problemPage(p, ["2x + 3 = 11"])
        let ids = await p.write("x = 5", at: Vec2(200, 360))
        await p.pass(1_000)
        let st = try #require(line(p, "x = 5"))
        p.loop.pages.strokeAt[ids[0].rawValue] = p.scheduler.now
        p.loop.check(.pause)
        await p.pass(100)
        #expect(p.board.marks.isEmpty && p.loop.isHeld(st))
    }

    @Test func helpMeChecksItsColumnFirst() async throws {
        let h = harness(checking: .whenDone)
        await h.start()
        problemPage(h, ["2x + 3 = 11"])
        await h.write("x = 5", at: Vec2(200, 280))
        await h.pass(1_000)
        #expect(h.board.marks.isEmpty)
        h.loop.helpMe()
        await h.pass(500)
        #expect(h.board.mark(on: "x = 5") == .ring)
        #expect(!h.loop.hints.isEmpty)
    }

    @Test func checkedLinesSurviveAReopenAndNewInkHoldsALineAgain() async throws {
        let h = harness(checking: .whenDone)
        await h.start()
        problemPage(h, ["2x + 3 = 11"])
        await h.write("2x = 8", at: Vec2(200, 280))
        await h.pass(1_000)
        h.loop.checkPage()
        await h.pass(500)
        #expect(h.board.mark(on: "2x = 8") == .tick)
        let reads = h.services.recognizeRequests.count
        // the board opened again: its checked line keeps its tick, nothing is read again
        h.board.store.load(h.board.store.document)
        await h.pass(1_000)
        #expect(h.board.mark(on: "2x = 8") == .tick)
        #expect(h.services.recognizeRequests.count == reads)
        #expect(h.loop.pages.action == nil)
    }

    @Test func switchingToWhenDoneKeepsWhatIsMarked() async throws {
        let h = harness(checking: .asIGo)
        await h.start()
        problemPage(h, ["2x + 3 = 11"])
        await h.write("2x = 8", at: Vec2(200, 280))
        await h.pass(3_500)
        #expect(h.board.mark(on: "2x = 8") == .tick, "as they go")
        h.loop.settings.checking = .whenDone
        await h.pass(500)
        #expect(h.board.mark(on: "2x = 8") == .tick, "the switch takes nothing off the page")
    }

    // MARK: - the judging rules

    @Test func aTrueIntermediateStepIsNeverRinged() async throws {
        for checking in [CheckTiming.asIGo, .whenDone] {
            let h = harness(checking: checking)
            await h.start()
            problemPage(h, ["4x - 5 = 7"])
            await h.write("2x = 8", at: Vec2(200, 280), reads: "4x = 7 + 5")
            await h.write("x = 5", at: Vec2(200, 360), reads: "3 \\times 4 = 12")
            await h.write("x = 4", at: Vec2(200, 440), reads: "2(x + 1) = 2x + 2")
            await h.write("3x = 15", at: Vec2(200, 520), reads: "4x - 5 + 5 = 7 + 5")
            await h.pass(3_500)
            if checking == .whenDone { h.loop.checkPage(); await h.pass(500) }
            #expect(h.board.mark(on: "4x = 7 + 5") == .tick, "\(checking): an equivalent step is right")
            #expect(h.board.mark(on: "4x - 5 + 5 = 7 + 5") == .tick, "\(checking)")
            #expect(h.board.mark(on: "3 \\times 4 = 12") != .ring, "\(checking): a true side fact is never ringed")
            #expect(h.board.mark(on: "2(x + 1) = 2x + 2") != .ring, "\(checking): an identity is never ringed")
        }
    }

    /// The owner's iPad (2026-10-19): on `403 + 364 − 336` the kid wrote `400+364=764`, then `+3=767` —
    /// an operation line going on from the line above — and the tutor circled it. The rule is the
    /// integration's (`ContinuationLine`, judged in `analyze`); this checks it holds on a problem page.
    @Test func anOperationLineContinuesTheLineAbove() async throws {
        for checking in [CheckTiming.asIGo, .whenDone] {
            let h = harness(checking: checking)
            await h.start()
            problemPage(h, ["403 + 364 - 336"])
            await h.write("2x = 8", at: Vec2(200, 280), reads: "400+364=764")
            await h.write("x = 5", at: Vec2(200, 360), reads: "+3=767")
            await h.write("x = 4", at: Vec2(200, 440), reads: "-336=431")
            await h.pass(3_500)
            if checking == .whenDone { h.loop.checkPage(); await h.pass(500) }
            #expect(h.board.mark(on: "+3=767") == .tick, "\(checking): 764 + 3 = 767 is a right step")
            #expect(h.board.mark(on: "-336=431") == .tick, "\(checking)")
            #expect(h.loop.lines.values.first { $0.latex == "-336=431" }?.analysis?.solved == true, "\(checking): the running total is the answer")
            #expect(!h.board.marks.contains { $0.kind == .ring }, "\(checking): never a ring on a true step")
        }
    }

    @Test func oneAnswerOfSeveralIsNoSlip() async throws {
        let h = harness(checking: .whenDone)
        await h.start()
        problemPage(h, ["x^{2} - 5x + 6 = 0"])
        await h.write("x = 3", at: Vec2(200, 280), reads: "x = 2")
        await h.pass(1_000)
        h.loop.checkPage()
        await h.pass(500)
        #expect(h.board.mark(on: "x = 2") == .tick, "a root is a right step")
        let st = try #require(line(h, "x = 2"))
        #expect(st.analysis?.solved != true && h.loop.pages.partial.contains(st.id))
        #expect(h.loop.note == LiveCopy.Pages.oneAnswer)
        #expect(h.loop.pages.action != .next(last: false), "not solved: no Next")
    }

    @Test func aBareNumberInTheAnswerSpotAnswersTheLetter() async throws {
        let h = harness(checking: .whenDone)
        await h.start()
        problemPage(h, ["4x - 5 = 7"])
        await h.write("x = 3", at: Vec2(300, 768), reads: "3")
        await h.pass(2_000)
        #expect(h.board.mark(on: "3") == .tick, "3 in the answer spot is x = 3")
        #expect(h.loop.pages.solved)
    }

    // MARK: - one page, one problem

    @Test func thePagesProblemHeadsEveryColumnOnIt() async throws {
        // the first part: the pages alone, as they ship
        let h = Harness()
        await h.start()
        problemPage(h, ["2x + 3 = 11"])
        await h.write("2x = 8", at: Vec2(200, 300))
        // side work far to the right, and far down: still this page's problem's
        await h.write("x = 4", at: Vec2(900, 300))
        await h.write("x = 5", at: Vec2(200, 640))
        await h.pass(3_500)
        #expect(h.board.mark(on: "2x = 8") == .tick)
        #expect(h.board.mark(on: "x = 4") == .tick, "a second column is judged against the page's problem")
        #expect(h.board.mark(on: "x = 5") == .ring, "work far below the problem is still its work")
    }

    @Test func aSecondProblemIsOfferedAPageAndMovesAsOneUndoStep() async throws {
        let h = harness(checking: .asIGo)
        await h.start()
        let first = h.board.currentScreenID
        problemPage(h, ["2x + 3 = 11"])
        await h.write("2x = 8", at: Vec2(200, 280))
        await h.write("x = 4", at: Vec2(200, 360))
        // after the solved problem, the kid's own next one
        let ink = await h.write("3x - 5 = 10", at: Vec2(200, 480))
        await h.write("3x = 15", at: Vec2(200, 560))
        await h.pass(4_000)
        #expect(h.board.mark(on: "x = 4") == .tick)
        #expect(h.board.mark(on: "3x - 5 = 10") == nil, "a new problem is never ringed")
        #expect(h.board.mark(on: "3x = 15") == .tick, "its steps are judged against it")
        let head = try #require(line(h, "3x - 5 = 10"))
        let offer = try #require(h.loop.pages.offer)
        #expect(offer.id == head.id && offer.lines.count == 2)
        let reads = h.services.recognizeRequests.count
        h.loop.takeNewPage()
        await h.pass(1_000)
        let ids = h.board.store.screenIDs
        #expect(ids.count == 2 && ids.first == first, "a new page right after this one")
        #expect(h.board.currentScreenID == ids[1])
        #expect(h.board.store.stroke(ink[0])?.screen == ids[1])
        #expect(h.board.store[ids[1]]?.screen?.problemPage?.origin == "student")
        #expect(h.services.recognizeRequests.count == reads, "moved ink is read from the cache")
        #expect(line(h, "3x - 5 = 10") != nil && line(h, "3x = 15") != nil, "its lines are this page's now")
        #expect(h.board.store.drawables(on: first).compactMap { $0.stroke }.filter { $0.author == .kid }.count
                == (h.written["2x = 8"]?.count ?? 0) + (h.written["x = 4"]?.count ?? 0))
        // one undo puts it all back
        h.board.store.undo()
        #expect(h.board.store.screenIDs == [first])
        #expect(h.board.store.stroke(ink[0])?.screen == first)
    }

    @Test func otherLettersStartAProblemOfTheirOwn() async throws {
        let h = harness(checking: .asIGo)
        await h.start()
        problemPage(h, ["2x + 3 = 11"])
        await h.write("2x = 8", at: Vec2(200, 280))
        await h.write("5x + 2 = 17", at: Vec2(200, 380), reads: "5y + 2 = 17")
        await h.pass(3_500)
        #expect(h.board.mark(on: "5y + 2 = 17") == nil)
        #expect(h.loop.pages.offer?.id == line(h, "5y + 2 = 17")?.id)
        // the board opened again before the kid answered: the offer is still there
        h.board.store.load(h.board.store.document)
        await h.pass(1_000)
        #expect(h.loop.pages.offer?.id == line(h, "5y + 2 = 17")?.id, "the offer comes back with the page")
        // "Keep it here": no offer again for it
        h.loop.keepHere()
        await h.pass(500)
        #expect(h.loop.pages.offer == nil)
        #expect(h.board.mark(on: "5y + 2 = 17") == nil, "kept, it heads its own work")
        // the board opened again: still kept, no offer
        h.board.store.load(h.board.store.document)
        await h.pass(1_000)
        #expect(line(h, "5y + 2 = 17") != nil)
        #expect(h.loop.pages.offer == nil, "Keep it here is remembered on the line's record")
    }

    // MARK: - I read

    @Test func aReadTheTutorDoubtsIsAskedAboutNotRinged() async throws {
        let h = harness(checking: .whenDone)
        await h.start()
        problemPage(h, ["2x + 3 = 11"])
        await h.write("x = 5", at: Vec2(200, 280), confidence: 0.95)
        await h.pass(1_000)
        let st = try #require(line(h, "x = 5"))
        #expect(h.loop.pages.readings.first { $0.id == st.id }?.state == .asking, "Mathpix under 0.99: Is this right?")
        h.loop.checkPage()
        await h.pass(500)
        #expect(h.board.mark(on: "x = 5") == nil, "a read in doubt is never ringed")
        #expect(h.loop.hints.first?.message == LiveCopy.Reading.didIReadThis)
        // "Yes, that's right": trusted, and judged
        h.loop.confirmReading(st.id)
        await h.pass(500)
        #expect(h.board.mark(on: "x = 5") == .ring)
        #expect(h.loop.pages.readings.first { $0.id == st.id }?.state == .fixed)
    }

    @Test func aLookAlikeOfThePagesLetterAsksAndAFixStands() async throws {
        let h = harness(checking: .whenDone)
        await h.start()
        problemPage(h, ["2x + 3 = 11"])
        await h.write("2x = 8", at: Vec2(200, 280), reads: "2 \\times = 8")
        await h.pass(1_000)
        let st = try #require(line(h, "2 \\times = 8"))
        #expect(h.loop.pages.readings.first { $0.id == st.id }?.state == .asking)
        // nothing was swapped
        #expect(st.latex == "2 \\times = 8")
        h.loop.openFix(st.id)
        await h.pass(200)
        #expect(h.loop.pages.fixing?.alternatives.first == "2x = 8", "\(String(describing: h.loop.pages.fixing))")
        h.loop.useReading(st.id, latex: "2x = 8")
        await h.pass(500)
        let fixed = try #require(h.loop.lines[st.id])
        #expect(fixed.latex == "2x = 8" && fixed.provider == .fixed)
        #expect(h.board.mark(on: "2x = 8") == .tick, "a fixed reading is checked again at once")
        // the same ink read again keeps the kid's reading
        h.loop.recognizeNow(st.id)
        await h.pass(1_000)
        #expect(h.loop.lines[st.id]?.latex == "2x = 8")
        // remembered on the line record
        let rec = try #require(h.board.lineRecords.first { $0.id == RecordID("line:\(st.id)") })
        #expect(rec.meta[PageMeta.fixed]?.stringValue == "2x = 8")
    }

    @Test func theSecondOpinionDisagreeingAsksAndOffersItsRead() async throws {
        let h = harness(checking: .whenDone)
        h.loop.pages.secondOpinion = true
        await h.start()
        problemPage(h, ["2x + 3 = 11"])
        // the kid wrote 2x = 8; the strokes read 2x = 6, sure of it; the crop's read says 2x = 8
        await h.write("2x = 8", at: Vec2(200, 280), reads: "2x = 6", second: ("2x = 8", false))
        await h.pass(1_000)
        #expect(h.services.recognizeRequests.last?.secondOpinion == true, "the board asked, with the line's crop")
        #expect(h.services.recognizeRequests.last?.crop != nil)
        let st = try #require(line(h, "2x = 6"))
        #expect(h.loop.pages.readings.first { $0.id == st.id }?.state == .asking, "the readers disagree: Is this right?")
        h.loop.checkPage()
        await h.pass(500)
        #expect(h.board.mark(on: "2x = 6") == nil, "a read the readers disagree on is never ringed")
        // never swapped: the kid picks the second read from Fix what I read
        #expect(h.loop.lines[st.id]?.latex == "2x = 6")
        h.loop.openFix(st.id)
        await h.pass(200)
        #expect(h.loop.pages.fixing?.alternatives.first == "2x = 8", "\(String(describing: h.loop.pages.fixing))")
        h.loop.useReading(st.id, latex: "2x = 8")
        await h.pass(500)
        #expect(h.board.mark(on: "2x = 8") == .tick)
    }

    @Test func readersThatAgreeAskNothing() async throws {
        let h = harness(checking: .whenDone)
        h.loop.pages.secondOpinion = true
        await h.start()
        problemPage(h, ["2x + 3 = 11"])
        await h.write("2x = 8", at: Vec2(200, 280), second: ("2 x=8", true))
        await h.pass(1_000)
        let st = try #require(line(h, "2x = 8"))
        #expect(h.loop.pages.readings.first { $0.id == st.id }?.state == .read)
    }

    @Test func readingsAreQuietAndOffWithTheSwitch() async throws {
        let h = harness(checking: .whenDone)
        await h.start()
        problemPage(h, ["2x + 3 = 11"])
        await h.write("2x = 8", at: Vec2(200, 280))
        await h.pass(1_000)
        let r = try #require(h.loop.pages.readings.first)
        #expect(r.state == .read && r.latex == "2x = 8")
        #expect(r.at.x >= ProblemPageLayout.laneX, "in the page's margin lane")
        h.loop.settings.showReadings = false
        await h.pass(100)
        #expect(h.loop.pages.readings.isEmpty)
    }

    // MARK: - Next

    /// The journey's pages 2 and 3: a misread fixed, a slip in the answer spot, then on the next page
    /// the same answer written in the same place (read from the cache): checked by the answer spot.
    @Test func theSameAnswerOnTheNextPageIsCheckedByTheAnswerSpot() async throws {
        let h = harness(checking: .whenDone)
        await h.start()
        let two = h.board.currentScreenID
        problemPage(h, ["3x - 5 = 10"], index: 2, count: 3)
        let three = try #require(h.board.insertScreen(after: two, meta: [:], go: false))
        await h.write("3x = 15", at: Vec2(200, 280), reads: "3 \\times = 15")
        await h.pass(1_000)
        await h.write("x = 3", at: Vec2(300, 768))
        await h.pass(2_500)
        #expect(h.board.mark(on: "x = 3") == .ring)
        let misread = try #require(line(h, "3 \\times = 15"))
        h.loop.openFix(misread.id)
        await h.pass(200)
        h.loop.useReading(misread.id, latex: "3x = 15")
        await h.pass(500)
        #expect(h.board.mark(on: "3x = 15") == .tick)
        // page 3, by the dock's arrow (page 2 is not solved)
        h.board.goToScreen(three)
        await h.pass(300)
        problemPage(h, ["5x + 2 = 17"], index: 3, count: 3)
        await h.pass(300)
        await h.write("5x = 15", at: Vec2(200, 280))
        await h.pass(1_000)
        let reads = h.services.recognizeRequests.count
        await h.write("x = 3", at: Vec2(300, 768))
        await h.pass(2_500)
        #expect(h.services.recognizeRequests.count == reads, "the same ink is read from the cache")
        #expect(markHere(h, "5x = 15") == .tick && markHere(h, "x = 3") == .tick,
                "\(h.loop.lines.values.map { "\($0.latex) held \(h.loop.isHeld($0))" }) \(h.board.marks.map(\.kind))")
        #expect(h.loop.pages.action == .next(last: true))
    }

    /// The journey's page 3 (a step, then the answer in the answer spot) under many timings, on the fake
    /// services: reads quick or slow (landing before, during or long after the answer spot's check),
    /// reading early on or off, the loop's async work cut short between clock steps (so a timer can
    /// fire while a read is being put on its line), and sometimes a touch left on the board once the
    /// line has gone to be read (a resting palm: the pen reads as down for good; before that, the loop
    /// reads nothing, as ever). The answer is always checked: by the answer spot, the long pause, or
    /// the safety net.
    @Test func theAnswerIsAlwaysCheckedWhateverTheTimings() async throws {
        var failures: [String] = []
        for seed in 1...30 {
            var rng = SplitMix(seed: UInt64(seed) &* 7_919)
            let h = harness(checking: .whenDone)
            h.loop.readsEarly = Bool.random(using: &rng)
            await h.start()
            problemPage(h, ["5x + 2 = 17"], index: 3, count: 3)
            await h.pass(300)
            h.idleTimeout = .milliseconds(Int.random(in: 2...40, using: &rng))
            await h.write("5x = 15", at: Vec2(200, 280))
            await h.pass(Double(Int.random(in: 100...3_000, using: &rng)))
            let slow = Bool.random(using: &rng)
            if slow { h.services.holdReadsNow() }
            await h.write("x = 3", at: Vec2(300, 768))
            if slow {
                await h.pass(Double(Int.random(in: 0...10_000, using: &rng)))
                h.services.releaseReads()
            }
            // (past the quiet gate: the loop never reads a line while the pen is down)
            await h.pass(Double(Int.random(in: 700...2_000, using: &rng)))
            // a touch left on the board from here on (sometimes)
            let palm = Int.random(in: 0..<3, using: &rng) == 0
            if palm {
                h.board.isPenDown = true
                h.board.onPen?(true)
            }
            h.idleTimeout = .seconds(20)
            await h.pass(14_000)
            let step = markHere(h, "5x = 15"), answer = markHere(h, "x = 3")
            if step != .tick || answer != .tick || h.loop.pages.action != .next(last: true) {
                failures.append("seed \(seed) (early \(h.loop.readsEarly), slow \(slow), palm \(palm)): 5x = 15 \(String(describing: step)), "
                                + "x = 3 \(String(describing: answer)), action \(String(describing: h.loop.pages.action)); \(h.loop.checkDiagnosis)")
            }
            h.board.isPenDown = false
        }
        #expect(failures.isEmpty, "\(failures.count) of 30:\n\(failures.joined(separator: "\n"))")
    }

    @Test func theSafetyNetChecksWorkHeldByATouchLeftOnTheBoard() async throws {
        let h = harness(checking: .whenDone)
        await h.start()
        problemPage(h, ["2x + 3 = 11"])
        await h.write("2x = 8", at: Vec2(200, 280))
        await h.pass(1_000)
        // a palm comes to rest on the board: the long pause waits for the pen, and waits
        h.board.isPenDown = true
        h.board.onPen?(true)
        await h.pass(10_000)
        #expect(h.board.marks.isEmpty, "the long pause waits while the pen is down")
        await h.pass(2_500)
        #expect(h.board.mark(on: "2x = 8") == .tick, "the safety net checked it")
        #expect(h.loop.pages.lastSafetyNet?.contains("2x = 8") == true, "and noted why it was held: \(h.loop.pages.lastSafetyNet ?? "nil")")
        h.board.isPenDown = false
    }

    @Test func nextGoesToTheNextPage() async throws {
        let h = Harness()
        await h.start()
        let first = h.board.currentScreenID
        problemPage(h, ["2x + 3 = 11"], index: 1, count: 2)
        let second = try #require(h.board.insertScreen(after: first, meta: [ProblemPage.metaKey: ProblemPage(setId: "daily:test", index: 2, count: 2).json], go: false))
        await h.write("x = 4", at: Vec2(200, 280))
        await h.pass(3_500)
        #expect(h.loop.pages.action == .next(last: false))
        h.loop.nextPage()
        await h.pass(500)
        #expect(h.board.currentScreenID == second)
        #expect(h.loop.pages.page?.index == 2)
    }
}
