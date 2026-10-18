import AgathonBoard
import AgathonBrain
import AgathonKit
import Foundation
import Testing
@testable import AgathonLive

/// The loop on a test board with the kid's ink from the handwriting scoreboard, a clock moved by
/// hand and a scripted API: timing, reading, marks, caching, cancellation.
///
/// The quiet gate itself, with reading early off (`ReadEarlyTests` has the gate's early way out).
@MainActor
@Suite(.serialized)
struct LoopTimingTests {
    @Test func theQuietGateWaits600msAfterPenUp() async throws {
        let h = Harness(readsEarly: false)
        await h.start()
        await h.write("2x + 3 = 11", at: Vec2(200, 150))
        await h.pass(500)
        #expect(h.services.recognizeRequests.isEmpty, "nothing is read before the gate runs out")
        await h.pass(100)
        #expect(h.services.recognizeRequests.count == 1)
        #expect(h.loop.lines.values.first?.latex == "2x + 3 = 11")
    }

    @Test func moreInkRestartsTheGate() async throws {
        let h = Harness(readsEarly: false)
        await h.start()
        let ink = KidHands.strokes("2x + 3 = 11", at: Vec2(200, 150))
        h.board.kidWrites(Array(ink.prefix(4)))
        await h.pass(400)
        h.board.kidWrites(Array(ink.dropFirst(4)))
        await h.pass(400)
        #expect(h.services.recognizeRequests.isEmpty, "the second half of the line restarted the gate")
        await h.pass(200)
        #expect(h.services.recognizeRequests.count == 1, "one read for the whole line")
    }

    @Test func nothingIsReadWhileThePenIsDown() async throws {
        let h = Harness(readsEarly: false)
        await h.start()
        await h.write("2x = 8", at: Vec2(200, 150))
        h.board.onPen?(true)
        await h.pass(1_000)
        #expect(h.services.recognizeRequests.isEmpty)
        h.board.onPen?(false)
        await h.pass(200)
        #expect(h.services.recognizeRequests.count == 1)
    }

    @Test func aRewriteWaits450ms() async throws {
        let h = Harness(readsEarly: false)
        await h.start()
        let ids = await h.write("x = 5", at: Vec2(200, 150))
        await h.pass(700)
        #expect(h.services.recognizeRequests.count == 1)
        // the kid rubs the line out and writes x = 4 in its place
        h.board.erase(ids)
        await h.write("x = 4", at: Vec2(200, 150))
        await h.pass(449)
        #expect(h.services.recognizeRequests.count == 1)
        await h.pass(10)
        #expect(h.services.recognizeRequests.count == 2)
    }
}

@MainActor
@Suite(.serialized)
struct LoopMarksTests {
    /// 2x + 3 = 11 / 2x = 8 / x = 5: the first line is the problem, the second is ticked, the slip ringed.
    func slip(_ h: Harness) async {
        await h.write("2x + 3 = 11", at: Vec2(200, 120))
        await h.pass(700)
        await h.write("2x = 8", at: Vec2(200, 220))
        await h.pass(700)
        await h.write("x = 5", at: Vec2(200, 320))
        await h.pass(700)
    }

    @Test func feedbackTicksTheRightStepAndRingsTheSlip() async throws {
        let h = Harness(mode: .feedback)
        await h.start()
        await slip(h)
        #expect(h.board.mark(on: "2x + 3 = 11") == nil)
        #expect(h.board.mark(on: "2x = 8") == .tick)
        #expect(h.board.mark(on: "x = 5") == .ring)
        let lines = h.board.lineRecords
        #expect(lines.count == 3)
        #expect(lines.first { $0.latex == "x = 5" }?.verdict == .warn)
        #expect(lines.first { $0.latex == "2x = 8" }?.verdict == .ok)
        // one problem: the column, its first line its statement
        let problem = try #require(h.board.problems.first)
        #expect(problem.lines.count == 3 && problem.latex == "2x + 3 = 11" && problem.origin == "student")
        #expect(lines.allSatisfy { $0.problem == problem.id })
        // Feedback writes no step, even once the kid stops
        await h.pass(3_000)
        #expect(h.board.tutorStrokes(withMeta: "suggestFor").isEmpty)
        // the tutor's marks are its own: the kid's Undo takes back the kid's last stroke, not a mark
        let before = h.board.marks.count
        h.board.store.undo()
        #expect(h.board.marks.count == before)
    }

    @Test func aFixUnderTheSlipIsTicked() async throws {
        let h = Harness(mode: .feedback)
        await h.start()
        await slip(h)
        await h.write("x = 4", at: Vec2(200, 420))
        await h.pass(700)
        #expect(h.board.mark(on: "x = 4") == .tick, "x = 4 follows from 2x = 8, not from the ringed x = 5")
        #expect(h.loop.lines.values.first { $0.latex == "x = 4" }?.analysis?.solved == true)
    }

    @Test func offMarksNothing() async throws {
        let h = Harness(mode: .off)
        await h.start()
        await slip(h)
        #expect(h.board.marks.isEmpty)
        #expect(h.services.recognizeRequests.count == 3, "Off still reads (the readback)")
    }

    @Test func suggestWritesTheRightStepBesideTheRingOnceTheKidStops() async throws {
        let h = Harness(mode: .suggest)
        await h.start()
        await slip(h)
        #expect(h.board.mark(on: "x = 5") == .ring)
        #expect(h.board.tutorStrokes(withMeta: "suggestFor").isEmpty, "an answer waits for the kid to stop")
        await h.pass(2_500)
        let step = h.board.tutorStrokes(withMeta: "suggestFor", "x = 5")
        #expect(!step.isEmpty)
        #expect(step.first?.meta["handLine"]?.stringValue == "x = 4")
        // beside the ring, right of the line
        let ring = try #require(h.loop.lines.values.first { $0.latex == "x = 5" })
        let stepX = step.map { StrokeBounds.of($0).x }.min() ?? 0
        #expect(stepX > LiveMarks.ringRect(ring.bounds).maxX)
    }

    @Test func autoOffMarksNothingUntilAsked() async throws {
        let h = Harness(mode: .feedback, auto: false)
        await h.start()
        await slip(h)
        #expect(h.board.marks.isEmpty)
        h.services.checkEvents = [[]]
        h.loop.helpMe()
        await h.pass(100)
        #expect(h.board.mark(on: "x = 5") == .ring, "asking marks the problem")
        #expect(h.board.mark(on: "2x = 8") == .tick)
    }

    @Test func movedInkIsNotReadAgainAndItsMarkFollows() async throws {
        let h = Harness(mode: .feedback)
        await h.start()
        await slip(h)
        let reads = h.services.recognizeRequests.count
        // the kid drags x = 5 down by 60
        let ids = h.written["x = 5"] ?? []
        h.board.store.transact(.kid) { tx in
            for id in ids { tx.updateStroke(id) { $0.y += 60 } }
        }
        await h.pass(700)
        #expect(h.services.recognizeRequests.count == reads, "a pure move is never read again")
        let ring = try #require(h.board.marks.first { $0.kind == .ring })
        let ringBox = BrainRect.around(ring.strokes.compactMap { h.board.store.stroke($0) }.map(StrokeBounds.of))
        let line = try #require(h.loop.lines.values.first { $0.latex == "x = 5" })
        #expect(ringBox.map { $0.y < line.bounds.y && $0.maxY > line.bounds.maxY } == true, "the ring is round the line where it is now")
    }
}

@MainActor
@Suite(.serialized)
struct LoopCacheAndCancelTests {
    @Test func theSameInkIsReadOnce() async throws {
        let h = Harness()
        await h.start()
        let ids = await h.write("2x = 8", at: Vec2(200, 150))
        await h.pass(700)
        #expect(h.services.recognizeRequests.count == 1)
        // rubbed out, then written again exactly so (new strokes, the same ink)
        h.board.erase(ids)
        await h.pass(700)
        #expect(h.loop.lines.isEmpty)
        h.board.kidWrites(KidHands.strokes("2x = 8", at: Vec2(200, 150)))
        await h.pass(700)
        #expect(h.services.recognizeRequests.count == 1, "the payload's hash is in the cache")
        #expect(h.loop.metrics.cacheHits >= 1)
        #expect(h.loop.lines.values.first?.latex == "2x = 8")
    }

    @Test func aReadOvertakenByNewInkIsDropped() async throws {
        let h = Harness()
        await h.start()
        h.services.holdReadsNow()
        h.idleTimeout = .milliseconds(100)
        let ids = await h.write("x = 5", at: Vec2(200, 150))
        await h.pass(700)
        #expect(h.services.recognizeRequests.count == 1)
        // the kid rubs the line out while it is being read
        h.board.erase(ids)
        await h.pass(700)
        h.idleTimeout = .seconds(20)
        h.services.releaseReads()
        await h.pass(100)
        #expect(h.loop.lines.isEmpty)
        #expect(h.board.lineRecords.isEmpty, "nothing is written for ink that is gone")
        #expect(h.board.marks.isEmpty)
    }

    @Test func newInkOnTheLineCancelsItsCheck() async throws {
        let h = Harness(mode: .feedback)
        await h.start()
        await h.write("2x + 3 = 11", at: Vec2(200, 120))
        await h.write("2x = 8", at: Vec2(200, 220))
        await h.write("x = 5", at: Vec2(200, 320))
        await h.pass(700)
        h.services.holdChecks = true
        h.idleTimeout = .milliseconds(150)
        h.loop.helpMe()
        await h.pass(50)
        #expect(h.services.checkRequests.count == 1)
        // the kid writes on: the line is read again, the check about the old read is stopped
        let fix = KidHands.strokes("x = 4", at: Vec2(200, 320))
        h.board.erase(h.written["x = 5"] ?? [])
        let ids = h.board.kidWrites(fix)
        await h.register(ids, reads: "x = 4")
        await h.pass(700)
        h.idleTimeout = .seconds(20)
        await h.idle()
        #expect(h.services.cancelledChecks == 1)
        #expect(h.board.mark(on: "x = 4") == .tick)
    }

    @Test func theTutorPutsItsPenDownWhenTheKidWrites() async throws {
        let h = Harness(mode: .answer)
        await h.start()
        await h.write("2x + 3 = 11", at: Vec2(200, 120))
        await h.pass(700)
        h.board.holdWrites = true
        h.loop.solveIt()
        await h.pass(50)
        let pen = try #require(h.board.pens.last)
        #expect(pen.isWriting)
        // the kid writes while the solution is being written: what was begun is finished, the rest dropped
        await h.write("x = 4", at: Vec2(900, 600))
        await h.pass(10)
        #expect(!pen.isWriting)
        #expect(pen.written.count == 1, "one line finished whole, the rest not written")
    }
}
