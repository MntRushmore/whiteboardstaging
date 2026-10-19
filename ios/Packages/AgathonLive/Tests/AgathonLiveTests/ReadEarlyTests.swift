import AgathonBoard
import AgathonBrain
import AgathonKit
import Foundation
import Testing
@testable import AgathonLive

/// Reading early (LiveLoop+ReadEarly): a finished-looking line is read before its quiet gate runs
/// out, the gate reuses that read, new ink in the line stops it, and nothing is read twice.
@MainActor
@Suite(.serialized)
struct ReadEarlyTests {
    @Test func aFinishedLineIsReadAndTickedBeforeTheGate() async throws {
        let h = Harness()
        await h.start()
        await h.write("2x + 3 = 11", at: Vec2(200, 120))
        await h.pass(700)
        #expect(h.services.recognizeRequests.count == 1)
        await h.write("2x = 8", at: Vec2(200, 220))
        await h.pass(449)
        #expect(h.services.recognizeRequests.count == 1, "nothing yet: the kid may still be writing")
        await h.pass(2)
        #expect(h.services.recognizeRequests.count == 2, "read 450 ms after the pen lifted (the wait before the kid's rhythm is known), not 600")
        #expect(h.board.mark(on: "2x = 8") == .tick, "and ticked as soon as the read is in")
        #expect((h.loop.metrics.penUpToMark.last ?? 0) < 500)
        await h.pass(700)
        #expect(h.services.recognizeRequests.count == 2, "the gate takes the early read: nothing is read twice")
        #expect(h.loop.metrics.readsEarly == 2 && h.loop.metrics.readsEarlyUsed == 2 && h.loop.metrics.earlyFlushes == 2)
    }

    @Test func aLineWithNoRelationWaitsForTheGate() async throws {
        let h = Harness()
        await h.start()
        let ink = KidHands.strokes("2x + 3 = 11", at: Vec2(200, 150))
        // `2x + 3`: no `=` yet, so no telling whether it is finished
        let ids = h.board.kidWrites(Array(ink.prefix(6)))
        await h.register(ids, reads: "2x + 3")
        await h.pass(500)
        #expect(h.services.recognizeRequests.isEmpty)
        await h.pass(100)
        #expect(h.services.recognizeRequests.count == 1, "the gate, as before")
        #expect(h.loop.metrics.readsEarly == 0)
    }

    @Test func aLineThatEndsWithItsEqualsIsReadEarlyOnlyWhenAnAnswerIsWanted() async throws {
        let quiet = Harness(mode: .feedback)
        await quiet.start()
        await quiet.write("36 + 2 =", at: Vec2(200, 150))
        await quiet.pass(500)
        #expect(quiet.services.recognizeRequests.isEmpty, "Hint mode never answers it: no hurry")

        let solve = Harness(mode: .answer)
        await solve.start()
        await solve.write("36 + 2 =", at: Vec2(200, 150))
        await solve.pass(460)
        #expect(solve.services.recognizeRequests.count == 1, "Solve answers it: read at once")
    }

    @Test func newInkInTheLineStopsTheEarlyReadAndTheLineIsReadWhole() async throws {
        let h = Harness()
        await h.start()
        h.services.holdReadsNow()
        h.idleTimeout = .milliseconds(100)
        let ink = KidHands.strokes("2x + 3 = 11", at: Vec2(200, 150))
        // `2x + 3 = 1`: it looks finished, so it is read early…
        let first = h.board.kidWrites(Array(ink.prefix(9)))
        await h.register(first, reads: "2x + 3 = 1")
        await h.pass(460)
        #expect(h.services.recognizeRequests.count == 1)
        // …but the kid writes the second 1
        let last = h.board.kidWrites(Array(ink.suffix(1)))
        await h.register(first + last, reads: "2x + 3 = 11")
        await h.pass(10)
        #expect(h.loop.metrics.readsEarlyCancelled == 1, "the read of `2x + 3 = 1` is stopped")
        h.idleTimeout = .seconds(20)
        h.services.releaseReads()
        await h.pass(700)
        #expect(h.loop.lines.values.first?.latex == "2x + 3 = 11", "only the whole line is used")
        #expect(h.services.recognizeRequests.count == 2)
        #expect(h.board.lineRecords.allSatisfy { $0.latex != "2x + 3 = 1" })
    }

    @Test func theGateWaitsForTheEarlyReadInsteadOfAskingAgain() async throws {
        let h = Harness()
        await h.start()
        h.services.holdReadsNow()
        h.idleTimeout = .milliseconds(100)
        await h.write("x = 5", at: Vec2(200, 150))
        await h.pass(460)
        #expect(h.services.recognizeRequests.count == 1, "read early, the reply slow")
        await h.pass(400)
        #expect(h.services.recognizeRequests.count == 1, "the gate ran out and waits for the same read")
        h.idleTimeout = .seconds(20)
        h.services.releaseReads()
        await h.pass(100)
        #expect(h.loop.lines.values.first?.latex == "x = 5")
        #expect(h.services.recognizeRequests.count == 1)
        #expect(h.loop.metrics.readsEarlyUsed == 1)
    }

    @Test func aFailedEarlyReadIsTheReadNotAskedAgain() async throws {
        let h = Harness()
        await h.start()
        // the recognizer cannot make sense of this ink
        let ink = KidHands.strokes("x = 5", at: Vec2(200, 150))
        h.board.kidWrites(ink)
        await h.pass(1_000)
        #expect(h.services.recognizeRequests.count == 1, "read once, early; the gate takes its answer")
        #expect(h.loop.lines.values.first?.latex == "")
    }

    @Test func theKidWritingElsewhereKeepsTheEarlyReadForTheGate() async throws {
        let h = Harness()
        await h.start()
        h.services.holdReadsNow()
        h.idleTimeout = .milliseconds(100)
        await h.write("2x = 8", at: Vec2(200, 150))
        await h.pass(460)
        #expect(h.services.recognizeRequests.count == 1)
        // the kid starts the next line before the read is back
        await h.write("x = 4", at: Vec2(200, 300))
        await h.pass(10)
        #expect(h.loop.metrics.readsEarlyCancelled == 0, "that ink is not in the line read")
        h.idleTimeout = .seconds(20)
        h.services.releaseReads()
        await h.pass(1_000)
        let reads = h.services.recognizeRequests.count
        #expect(reads == 2, "one read per line: \(reads)")
        #expect(h.loop.lines.values.map(\.latex).sorted() == ["2x = 8", "x = 4"])
    }

    @Test func thePencilHoveringAwayReadsTheLineAtOnce() async throws {
        let h = Harness()
        await h.start()
        let ink = KidHands.strokes("2x + 3 = 11", at: Vec2(200, 150))
        // `2x + 3` has no `=`: a pause alone would wait for the gate
        let ids = h.board.kidWrites(Array(ink.prefix(6)))
        await h.register(ids, reads: "2x + 3")
        await h.pass(60)
        // hovering over the line (the next glyph's place) is not leaving it
        h.board.onHover?(AgathonBrain.Point(x: 300, y: 165))
        await h.pass(10)
        #expect(h.services.recognizeRequests.isEmpty)
        // down to the next line: left
        h.board.onHover?(AgathonBrain.Point(x: 210, y: 320))
        await h.pass(10)
        #expect(h.services.recognizeRequests.count == 1, "read as the pen leaves the line")
        await h.pass(700)
        #expect(h.services.recognizeRequests.count == 1)
    }

    @Test func noEarlyReadsWhenSwitchedOffOrOffline() async throws {
        let off = Harness()
        off.loop.readsEarly = false
        await off.start()
        await off.write("2x = 8", at: Vec2(200, 150))
        await off.pass(500)
        #expect(off.services.recognizeRequests.isEmpty)

        let offline = Harness()
        await offline.start()
        offline.connectivity.isOnline = false
        await offline.write("2x = 8", at: Vec2(200, 150))
        await offline.pass(500)
        #expect(offline.services.recognizeRequests.isEmpty)
        #expect(offline.loop.metrics.readsEarly == 0)
    }

    @Test func aLongQuietWarmsTheRoadAtThePenDown() async throws {
        let h = Harness()
        await h.start()
        h.board.onPen?(true)
        h.board.onPen?(false)
        #expect(h.loop.metrics.calls["warm"] == 1, "the first pen-down after a quiet minute")
        h.board.onPen?(true)
        h.board.onPen?(false)
        #expect(h.loop.metrics.calls["warm"] == 1, "not again while the road is warm")
        await h.pass(61_000)
        h.board.onPen?(true)
        #expect(h.loop.metrics.calls["warm"] == 2)
    }
}

/// The pieces reading early is decided with: the kid's rhythm, a line's shape.
struct ReadEarlyLogicTests {
    func boxes(_ latex: String, hand: String = "clean") -> [BrainRect] {
        KidHands.strokes(latex, hand: hand, at: Vec2(100, 100)).map { pts in
            let xs = pts.map(\.x), ys = pts.map(\.y)
            return BrainRect(x: xs.min()!, y: ys.min()!, w: xs.max()! - xs.min()!, h: ys.max()! - ys.min()!)
        }
    }

    @Test(arguments: ["clean", "slanted", "steep", "messy"])
    func theEqualsSignIsFoundInEveryHand(hand: String) {
        for latex in ["2x + 3 = 11", "3x - 5 = 10", "36 + 2 =", "x = 5", "\\frac{3}{4} + \\frac{1}{8} = \\frac{7}{8}"] {
            #expect(LineShape.equalsSign(boxes(latex, hand: hand)) != nil, "\(latex) (\(hand))")
        }
        // a minus and a plus are not an `=`
        #expect(LineShape.equalsSign(Array(boxes("3x - 5 = 10", hand: hand).prefix(6))) == nil, "3x - 5 (\(hand))")
        #expect(LineShape.equalsSign(Array(boxes("2x + 3 = 11", hand: hand).prefix(6))) == nil, "2x + 3 (\(hand))")
    }

    @Test(arguments: ["clean", "slanted", "steep", "messy"])
    func aLineLooksFinishedOnlyWithItsRightSideStarted(hand: String) {
        for latex in ["2x + 3 = 11", "2x = 8", "x = 5", "3x - 5 = 10", "5x = 15"] {
            let b = boxes(latex, hand: hand)
            #expect(LineShape.looksFinished(b, last: b.last!, answerAfterEquals: false), "\(latex) (\(hand))")
            // just after its `=`: the right side not started
            let eqEnd = b.indices.last { i in LineShape.equalsSign(Array(b.prefix(i + 1))) != nil && LineShape.equalsSign(Array(b.prefix(i))) == nil }!
            let upToEquals = Array(b.prefix(eqEnd + 1))
            #expect(!LineShape.looksFinished(upToEquals, last: upToEquals.last!, answerAfterEquals: false), "\(latex) up to = (\(hand))")
            #expect(LineShape.looksFinished(upToEquals, last: upToEquals.last!, answerAfterEquals: true), "\(latex) up to =, answer wanted (\(hand))")
        }
        // the + of `2x + 3`'s second stroke ends left of its first: mid-glyph, never finished
        let b = boxes("2x + 3 = 11", hand: hand)
        #expect(!LineShape.looksFinished(Array(b.prefix(5)), last: b[4], answerAfterEquals: true))
    }

    @Test func theDelayFollowsTheKidsOwnPauses() {
        var r = PenRhythm()
        #expect(r.delayMs == PenRhythm.defaultDelayMs, "the default until the kid's rhythm is known")
        var t = 0.0
        let line = BrainRect(x: 100, y: 100, w: 20, h: 30)
        r.stroke(line, at: t)
        // a quick writer: pauses of 100–190 ms inside the line
        for i in 0..<20 {
            t += 100 + Double(i % 10) * 10
            r.penDown(at: t)
            t += 150
            r.stroke(BrainRect(x: 100 + Double(i + 1) * 22, y: 100, w: 20, h: 30), at: t)
        }
        #expect(r.pauses.count == 20)
        #expect(r.delayMs == 220, "nine in ten pauses are 180 ms or less, plus the margin: \(r.delayMs)")
        // pauses at the gate's length or longer are not rhythm
        t += 900
        r.stroke(BrainRect(x: 600, y: 100, w: 20, h: 30), at: t)
        #expect(r.pauses.count == 20)
        // a slow writer's long pauses: no early read on a pause at all
        var slow = PenRhythm()
        slow.stroke(line, at: 0)
        for i in 0..<10 { slow.stroke(BrainRect(x: 100 + Double(i + 1) * 22, y: 100, w: 20, h: 30), at: Double(i + 1) * 580) }
        #expect(slow.delayMs == nil)
    }

    @Test func aStrokeJoinsItsLineAndThePenLeavesIt() {
        let line = BrainRect(x: 100, y: 100, w: 200, h: 30)
        #expect(PenRhythm.joins(BrainRect(x: 310, y: 105, w: 18, h: 26), line), "the next glyph")
        #expect(PenRhythm.joins(BrainRect(x: 150, y: 140, w: 40, h: 2), line), "a fraction bar under it")
        #expect(!PenRhythm.joins(BrainRect(x: 100, y: 200, w: 20, h: 30), line), "the next line")
        #expect(!PenRhythm.joins(BrainRect(x: 600, y: 100, w: 20, h: 30), line), "far along: another column")
        var r = PenRhythm()
        r.stroke(line, at: 0)
        #expect(!r.leftLine(AgathonBrain.Point(x: 320, y: 110)), "over the place for the next glyph")
        #expect(!r.leftLine(AgathonBrain.Point(x: 200, y: 90)), "just above the line")
        #expect(r.leftLine(AgathonBrain.Point(x: 110, y: 170)), "down to the next line")
        #expect(r.leftLine(AgathonBrain.Point(x: 60, y: 110)), "back before its start")
    }
}
