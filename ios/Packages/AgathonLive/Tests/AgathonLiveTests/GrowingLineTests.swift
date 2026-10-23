import AgathonBoard
import AgathonBrain
import Foundation
import Testing
@testable import AgathonLive

/// Check as I go, on a line the kid is still writing (the real-ink bench: `x = 1` ringed before its
/// 2). A ring or a "?" waits until the line looks finished (`PageTiming.doubtHoldMs`); a tick on a
/// half line comes off at its next stroke. `LiveLoop+Chain.swift` (`stillGrowing`),
/// `LiveLoop+Ink.swift` (`unringGrowingLine`).
@MainActor
@Suite(.serialized)
struct GrowingLineTests {
    /// The kid writes `more` just past the end of the line read `before`; the whole line reads `after`.
    func extend(_ h: Harness, _ first: [RecordID], before: String, with more: String, after: String) async -> [RecordID] {
        let box = h.loop.lines.values.first { $0.latex == before }!.bounds
        let tail = await h.write(more, at: Vec2(box.x + box.w + 8, box.y), reads: more)
        await h.register(first + tail, reads: after)
        return tail
    }

    @Test func aShortPauseMidLineShowsNoRing() async throws {
        let h = Harness(mode: .feedback)
        await h.start()
        await h.write("2x = 24", at: Vec2(200, 120))
        await h.pass(1_500)
        // `x = 1` of `x = 12`: read during the kid's pause, wrong as it stands
        let first = await h.write("x = 1", at: Vec2(200, 220))
        await h.pass(1_500)
        #expect(h.board.mark(on: "x = 1") == nil, "no ring on a line still being written")
        _ = await extend(h, first, before: "x = 1", with: "2", after: "x = 12")
        await h.pass(1_500)
        #expect(h.board.mark(on: "x = 12") == .tick)
    }

    @Test func aTickOnAHalfLineComesOffAtItsNextStrokeAndTheRingWaits() async throws {
        let h = Harness(mode: .feedback)
        await h.start()
        await h.write("2x = 2", at: Vec2(200, 120))
        await h.pass(1_500)
        // the answer is 1: `x = 1` is ticked...
        let first = await h.write("x = 1", at: Vec2(200, 220))
        await h.pass(1_500)
        #expect(h.board.mark(on: "x = 1") == .tick)
        // ...and then it was the start of `x = 12`: the tick goes at the stroke, before any read
        _ = await extend(h, first, before: "x = 1", with: "2", after: "x = 12")
        await h.idle()
        #expect(h.board.mark(on: "x = 1") == nil, "the tick comes off at the new stroke")
        // read as `x = 12`, wrong: no ring while it might still be growing
        await h.pass(1_500)
        #expect(h.board.mark(on: "x = 12") == nil, "the ring waits for the line to look finished")
        await h.pass(PageTiming.doubtHoldMs)
        #expect(h.board.mark(on: "x = 12") == .ring)
    }

    @Test func aRingComesOnceTheLineLooksFinished() async throws {
        let h = Harness(mode: .feedback)
        await h.start()
        await h.write("2x = 2", at: Vec2(200, 120))
        await h.pass(1_500)
        await h.write("x = 3", at: Vec2(200, 220))
        await h.pass(800)
        #expect(h.loop.stillGrowing(h.loop.lines.values.first { $0.latex == "x = 3" }!) != nil)
        await h.pass(PageTiming.doubtHoldMs)
        #expect(h.loop.stillGrowing(h.loop.lines.values.first { $0.latex == "x = 3" }!) == nil)
        #expect(h.board.mark(on: "x = 3") == .ring)
    }
}
