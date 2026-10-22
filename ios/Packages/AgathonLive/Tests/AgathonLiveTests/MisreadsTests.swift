import AgathonBoard
import AgathonBrain
import Foundation
import Testing
@testable import AgathonLive

/// The look at a read on the iPad before a ring (`LiveLoop.lookAgainLocally`): a variant of the
/// step's read is taken only when the ink supports it AND the step then follows. Re-drawn ink only
/// (the real-ink bench's corpus never enters the repo).
@MainActor
@Suite(.serialized)
struct MisreadsTests {
    /// The line above reads `-3x + 5 = -10`; the kid writes the step `3x = 15`'s ink, read as
    /// `3 x=-15` — the step's leading minus dropped — with or without a minus stroke before it.
    func step(withMinus: Bool) async -> Harness {
        let h = Harness(mode: .feedback)
        await h.start()
        await h.write("3x - 5 = 10", at: Vec2(200, 120), reads: "-3 x+5=-10")
        await h.pass(700)
        var ink = KidHands.strokes("3x = 15", at: Vec2(200, 220))
        if withMinus {
            let top = ink.flatMap { $0 }.map(\.y).min() ?? 220
            let bottom = ink.flatMap { $0 }.map(\.y).max() ?? 260
            let left = ink.flatMap { $0 }.map(\.x).min() ?? 200
            let y = (top + bottom) / 2
            ink.insert([Vec2(left - 34, y), Vec2(left - 24, y + 0.5), Vec2(left - 12, y)], at: 0)
        }
        let ids = h.board.kidWrites(ink)
        await h.register(ids, reads: "3 x=-15")
        await h.pass(700)
        await h.pass(4_500)
        return h
    }

    @Test func aMinusTheReadDroppedIsTakenBackWhenTheInkHasIt() async throws {
        let h = await step(withMinus: true)
        #expect(h.board.mark(on: "-3 x=-15") == .tick, "\(h.board.lineRecords.map(\.latex))")
        #expect(h.board.mark(on: "3 x=-15") == nil)
    }

    @Test func aStepThatForgotItsMinusIsStillRinged() async throws {
        let h = await step(withMinus: false)
        #expect(h.board.mark(on: "3 x=-15") == .ring, "\(h.board.lineRecords.map(\.latex))")
    }
}
