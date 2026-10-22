import AgathonBoard
import AgathonBrain
import Foundation
import Testing
@testable import AgathonLive

/// The second look before a ring may take back a misread's ring, never a real slip's (a kid session,
/// 2026-10-22, s04: `180+24=214` read at 1.00 and ringed; re-read `180+34=214` — true — the ring came
/// off and the hint stayed). `LiveLoop+Chain.swift`.
@MainActor
@Suite(.serialized)
struct RingGuardTests {
    /// The s04 page: 34 × 6 printed by the tutor; the kid works it out in parts and slips adding them.
    func s04(_ h: Harness) async {
        try? await TestBrain.shared.load()
        _ = await HeadlessBench.page(["34 \\times 6"], on: h.board, loop: h.loop, brain: TestBrain.shared)
        await h.pass(300)
        await h.write("2x + 3 = 11", at: Vec2(200, 300), reads: "30 \\times 6 = 180", confidence: 1.0)
        await h.pass(700)
        await h.write("2x = 8", at: Vec2(200, 400), reads: "4 \\times 6 = 24", confidence: 1.0)
        await h.pass(700)
        await h.write("x = 5", at: Vec2(200, 500), reads: "180 + 24 = 214", confidence: 1.0)
        await h.pass(6_000)
        h.loop.checkPage()
        await h.pass(6_000)
    }

    @Test func aReReadNeverChangesANumberThePageKnows() async throws {
        let h = Harness(mode: .feedback)
        h.services.rereadReplies["180 + 24 = 214"] = RereadResponse(latex: "180 + 34 = 214", changed: true, model: "fake", ms: 1)
        await h.start()
        await s04(h)
        #expect(!h.services.rereadRequests.isEmpty, "the second look ran")
        #expect(h.board.mark(on: "180 + 24 = 214") == .ring, "the slip keeps its ring: 24 is the line above's number")
    }

    @Test func aStrayBesideTheWorkIsNeverRinged() async throws {
        // the real-ink bench: a circled digit scribbled beside the sum (13 × 4) was ringed
        let h = Harness(mode: .feedback)
        await h.start()
        try? await TestBrain.shared.load()
        _ = await HeadlessBench.page(["13 \\times 4"], on: h.board, loop: h.loop, brain: TestBrain.shared)
        await h.pass(300)
        await h.write("2x + 3 = 11", at: Vec2(160, 300), reads: "13 \\times 4 = 52", confidence: 1.0)
        await h.pass(700)
        await h.write("x = 5", at: Vec2(1300, 260), reads: "7", confidence: 1.0)
        await h.pass(6_000)
        h.loop.checkPage()
        await h.pass(6_000)
        #expect(h.board.mark(on: "7") != .ring, "a digit alone beside the work is a scribble")
        #expect(h.board.mark(on: "13 \\times 4 = 52") != .ring)
    }

    /// 8 × 7 printed; the kid's answer read 56 at low confidence; the second look reads `look`.
    func unsureAnswer(_ look: String) async -> Harness {
        let h = Harness(mode: .feedback)
        h.services.rereadReplies["56"] = RereadResponse(latex: look, changed: look != "56", model: "fake", ms: 1)
        await h.start()
        try? await TestBrain.shared.load()
        _ = await HeadlessBench.page(["8 \\times 7"], on: h.board, loop: h.loop, brain: TestBrain.shared)
        await h.pass(300)
        await h.write("x = 5", at: Vec2(160, 300), reads: "56", confidence: 0.4)
        await h.pass(6_000)
        h.loop.checkPage()
        await h.pass(6_000)
        return h
    }

    @Test func aRightAnswerReadUnsureIsTickedWhenASecondLookReadsTheSame() async throws {
        let h = await unsureAnswer("56")
        #expect(!h.services.rereadRequests.isEmpty, "one more look")
        #expect(h.board.mark(on: "56") == .tick)
    }

    @Test func aRightAnswerReadUnsureKeepsItsQuestionWhenTheSecondLookDisagrees() async throws {
        // her 58 misread as a right 56: never a tick
        let h = await unsureAnswer("58")
        #expect(h.board.mark(on: "56") != .tick)
        #expect(h.board.mark(on: "56") != .ring)
    }

    @Test func knownNumbersAreKept() {
        #expect(!LiveLoop.keepsKnownNumbers(mathpix: "180+24=214", reread: "180+34=214", known: ["180 + 24"]))
        #expect(LiveLoop.keepsKnownNumbers(mathpix: "180+24=214", reread: "180+24=204", known: ["180 + 24"]))
        // a number the page does not know may be read again (the misread the second look is for)
        #expect(LiveLoop.keepsKnownNumbers(mathpix: "x = 5", reread: "x = 4", known: ["2x = 8"]))
        #expect(LiveLoop.numbers(in: "\\frac{12}{5} + 0.75") == ["12", "5", "0.75"])
    }

    @Test func aRingTakenBackTakesItsHintWithIt() async throws {
        let h = Harness(mode: .feedback)
        await h.start()
        await h.write("2x + 3 = 11", at: Vec2(200, 120), reads: "2x + 3 = 11")
        await h.pass(700)
        await h.write("2x = 8", at: Vec2(200, 220), reads: "2x = 9")
        await h.pass(5_000)
        guard let st = h.loop.lines.values.first(where: { $0.latex == "2x = 9" }) else {
            Issue.record("the step was never read")
            return
        }
        h.loop.openHint(st, message: "Look at the 3.", question: nil, level: 1)
        h.loop.pendingSuggestions.insert(st.id)
        #expect(h.loop.hints.contains { $0.lineId == st.id })
        // the ring comes off (as a second look or a fix would take it)
        h.loop.syncMark(st, nil)
        #expect(!h.loop.hints.contains { $0.lineId == st.id }, "the hint card went with the ring")
        #expect(!h.loop.pendingSuggestions.contains(st.id), "the queued step went with it")
    }
}
