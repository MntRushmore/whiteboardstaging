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

    @Test func aStackedSumsRowsAreReadAsNumbersWithTheirOperator() {
        #expect(LiveLoop.stackRowLatex("13") == "13")
        #expect(LiveLoop.stackRowLatex("+ 4") == "+4")
        #expect(LiveLoop.stackRowLatex("\\times 243") == "\\times 243")
        #expect(LiveLoop.stackRowLatex("x 4") == "\\times 4")
        #expect(LiveLoop.stackRowLatex("\\frac{1}{2}") == nil)
        #expect(LiveLoop.stackRowLatex("4 x") == nil)
        #expect(LiveLoop.isColumnRead("\\begin{array}{r} 13 \\\\ +4 \\\\ \\hline 17 \\end{array}"))
        #expect(!LiveLoop.isColumnRead("\\frac{13}{+4}"))
    }

    @Test func rowsReadFromAStackAreTheProblemsNumbersOrTheyMayNotRing() {
        // the operator she left out is the problem's; a carry written into the row is left out
        #expect(LiveLoop.alignedToProblem(["18", "7"], problem: ["18 \\times 7"]) == ["18", "\\times 7"])
        #expect(LiveLoop.alignedToProblem(["627", "\\times 9"], problem: ["27 \\times 9"]) == ["27", "\\times 9"])
        #expect(LiveLoop.alignedToProblem(["128", "+47"], problem: ["128 + 47"]) == ["128", "+47"])
        // a row that is not the problem's number (a misread `9` as `4`): no alignment, so no ring
        #expect(LiveLoop.alignedToProblem(["627", "4"], problem: ["27 \\times 9"]) == nil)
        #expect(LiveLoop.alignedToProblem(["18", "7"], problem: []) == nil)
    }

    @Test func aStepThatForgotItsMinusIsStillRinged() async throws {
        let h = await step(withMinus: false)
        #expect(h.board.mark(on: "3 x=-15") == .ring, "\(h.board.lineRecords.map(\.latex))")
    }
}
