import AgathonBoard
import AgathonBrain
import AgathonKit
import Foundation
import Testing
@testable import AgathonLive

/// "The tutor writes it out" on the board (docs/TUTOR-WRITES.md): what each ask writes, where it goes,
/// and what is held back. The kid's ink is synthetic (the fixtures' hands, and `StudentHand`'s).
@MainActor
@Suite(.serialized)
struct TutorWritesLoopTests {
    /// Any line in a synthetic student hand (`StudentHand`), its top-left at `at`, read as written.
    @discardableResult
    func writeAny(_ h: Harness, _ latex: String, at: Vec2, reads: String? = nil, hand: TrainingHand = .clean) async throws -> [RecordID] {
        try await TestBrain.shared.load()
        let ink = try #require(try await StudentHand.ink(latex, hand: hand, brain: TestBrain.shared), "the hand can't write \(latex)")
        let ids = h.board.kidWrites(ink.map { s in s.map { Vec2(at.x + $0.x, at.y + $0.y) } })
        await h.register(ids, reads: reads ?? latex)
        return ids
    }

    /// A stacked sum with nothing under its rule yet: the rows in the student hand, then the rule drawn
    /// under them (the hand draws a rule only between rows), read as one block.
    @discardableResult
    func writeStack(_ h: Harness, _ rows: [String], at: Vec2) async throws -> [RecordID] {
        try await TestBrain.shared.load()
        let latex = "\\begin{array}{r} \(rows.joined(separator: " \\\\ ")) \\end{array}"
        let ink = try #require(try await StudentHand.ink(latex, hand: .clean, brain: TestBrain.shared), "the hand can't write \(latex)")
        let placed = ink.map { s in s.map { Vec2(at.x + $0.x, at.y + $0.y) } }
        let pts = placed.flatMap { $0 }
        let x0 = (pts.map(\.x).min() ?? 0) - 14, x1 = (pts.map(\.x).max() ?? 0) + 10, y = (pts.map(\.y).max() ?? 0) + 12
        let rule = stride(from: x0, through: x1, by: 4).map { Vec2($0, y + ($0 - x0) * 0.01) }
        let ids = h.board.kidWrites(placed + [rule])
        await h.register(ids, reads: "\\begin{array}{r} \(rows.joined(separator: " \\\\ ")) \\\\ \\hline \\end{array}")
        return ids
    }

    /// The kid has confirmed every line as read (the step choice tested on its own; the guard's own
    /// tests below go through the readback).
    func trustAll(_ h: Harness) {
        for st in h.loop.lines.values where !st.latex.isEmpty { h.loop.pages.confirmed[st.id] = st.latex }
    }

    /// The tutor's steps on the page: their LaTeX, top to bottom.
    func steps(_ h: Harness) -> [String] {
        var byId: [String: (latex: String, y: Double)] = [:]
        for s in h.board.tutorStrokes {
            guard let id = s.meta["tutorStepId"]?.stringValue, let latex = s.meta["tutorStep"]?.stringValue else { continue }
            let y = StrokeBounds.of(s).y
            byId[id] = (latex, min(y, byId[id]?.y ?? y))
        }
        return byId.values.sorted { $0.y < $1.y }.map(\.latex)
    }

    func strokes(_ h: Harness, step latex: String) -> [StrokeRecord] {
        h.board.tutorStrokes.filter { $0.meta["tutorStep"]?.stringValue == latex }
    }

    func box(_ strokes: [StrokeRecord]) -> BrainRect? {
        BrainRect.around(strokes.map { StrokeBounds.of($0) })
    }

    // MARK: - equations

    @Test func helpMeWritesOneCheckedStepUnderTheWorkThenHoldsTheAnswerBack() async throws {
        let h = Harness(mode: .suggest)
        await h.start()
        await h.write("2x + 3 = 11", at: Vec2(200, 120))
        await h.pass(700)
        trustAll(h)
        h.loop.helpMe()
        await h.pass(100)
        #expect(steps(h) == ["2x = 8"], "one step, the engine's")
        let line = try #require(h.loop.lines.values.first)
        let step = try #require(box(strokes(h, step: "2x = 8")))
        #expect(step.y > line.bounds.maxY, "under the work")
        #expect(abs(step.x - line.bounds.x) < line.bounds.w, "in the work's column")
        #expect(h.board.tutorStrokes.allSatisfy { $0.color == .tutor }, "the tutor's cobalt")
        // its `=` under the kid's `=`
        let kidEq = try #require(h.loop.equalsX(of: line))
        let stepEq = try #require(strokes(h, step: "2x = 8").first?.meta["tutorEquals"]?.numberValue)
        #expect(abs(kidEq - stepEq) < 12, "the step's = (\(stepEq)) under the kid's (\(kidEq))")
        // the why on the tutor's card, and Next step on it
        let card = try #require(h.loop.hints.first)
        #expect(card.message == "Subtract 3 from both sides.")
        #expect(card.action == .next)
        #expect(h.services.solveRequests.isEmpty, "the engine's step: no model")
        // the next ask: the last step is the answer, held back (Hint/Next step don't hand out answers)
        h.loop.moreHelp(card)
        await h.pass(100)
        #expect(steps(h) == ["2x = 8"], "x = 4 is not written")
        let last = try #require(h.loop.hints.first)
        #expect(last.title == "One step left")
        #expect(last.message == "One step left: divide both sides by 2. You can do this one.")
        #expect(last.action == .none, "no Show the answer: the grown-ups have not allowed answers")
    }

    @Test func theAnswerOnlyOnAFurtherAskWhenTheGrownUpsAllowIt() async throws {
        let h = Harness(mode: .suggest)
        h.loop.settings.answerOnEquals = true
        await h.start()
        await h.write("2x + 3 = 11", at: Vec2(200, 120))
        await h.write("2x = 8", at: Vec2(200, 220))
        await h.pass(700)
        trustAll(h)
        h.loop.helpMe()
        await h.pass(100)
        #expect(steps(h).isEmpty, "the first ask on the last step only says what to do")
        let card = try #require(h.loop.hints.first)
        #expect(card.action == .answer)
        h.loop.moreHelp(card)
        await h.pass(100)
        #expect(steps(h) == ["x = 4"])
        #expect(h.loop.hints.first?.title == "The answer")
    }

    @Test func aSecondAskGoesOnFromTheTutorsOwnStep() async throws {
        let h = Harness(mode: .suggest)
        await h.start()
        try await writeAny(h, "3(x - 2) = 12", at: Vec2(200, 120))
        await h.pass(700)
        trustAll(h)
        h.loop.helpMe()
        await h.pass(100)
        #expect(steps(h) == ["3x - 6 = 12"])
        #expect(h.loop.hints.first?.message == "Multiply out the brackets.")
        h.loop.moreHelp(try #require(h.loop.hints.first))
        await h.pass(100)
        #expect(steps(h) == ["3x - 6 = 12", "3x = 18"], "the step after the tutor's own")
        #expect(h.loop.hints.first?.message == "Add 6 to both sides.")
        let first = try #require(box(strokes(h, step: "3x - 6 = 12")))
        let second = try #require(box(strokes(h, step: "3x = 18")))
        #expect(second.y > first.maxY, "one under the other")
    }

    @Test func showMeOnAHintCardWritesTheStep() async throws {
        let h = Harness(mode: .feedback)
        await h.start()
        await h.write("5x + 2 = 17", at: Vec2(200, 120))
        await h.pass(700)
        trustAll(h)
        h.loop.helpMe()
        await h.pass(100)
        let hint = try #require(h.loop.hints.first)
        #expect(hint.action == .more, "a hint first, with Show me")
        #expect(steps(h).isEmpty)
        h.loop.moreHelp(hint)
        await h.pass(100)
        #expect(steps(h) == ["5x = 15"])
    }

    @Test func aSlipGetsTheRightStepBesideItsRing() async throws {
        let h = Harness(mode: .suggest)
        await h.start()
        await h.write("2x + 3 = 11", at: Vec2(200, 120))
        try await writeAny(h, "2x = 9", at: Vec2(200, 230))
        await h.pass(3_500)
        trustAll(h)
        #expect(h.board.mark(on: "2x = 9") == .ring)
        let wrong = try #require(h.loop.lines.values.first { $0.latex == "2x = 9" })
        h.loop.escalate(wrong.id)
        await h.pass(100)
        let fix = strokes(h, step: "2x = 8")
        #expect(!fix.isEmpty, "the right step: \(steps(h))")
        #expect(fix.first?.meta["suggestFor"]?.stringValue == "2x = 9")
        #expect((box(fix)?.x ?? 0) > wrong.bounds.maxX, "beside the ring")
        // one right step beside the ring, never two (Next step's own correction and Help me's step)
        #expect(steps(h) == ["2x = 8"], "one step: \(steps(h))")
        let besideRing = h.board.tutorStrokes.filter { $0.meta["suggestFor"]?.stringValue == "2x = 9" }
        #expect(besideRing.allSatisfy { $0.meta["tutorStepId"] != nil }, "no second, untagged copy of the step")
    }

    /// The simulator QA (2026-11-03): on Next step, the ring's own correction was written beside it, then
    /// Help me wrote the same step again beside that ("2x = 9 ◯ 2x = 8 2x = 8"). The correction already
    /// there is the step: Help me says why on its card and writes nothing more, and the next ask goes
    /// on from it.
    @Test func helpMeAfterTheRingsOwnCorrectionWritesNoSecondCopy() async throws {
        let h = Harness(mode: .suggest)
        await h.start()
        await h.write("2x + 3 = 11", at: Vec2(200, 120))
        try await writeAny(h, "2x = 9", at: Vec2(200, 230))
        await h.pass(3_500)
        trustAll(h)
        let wrong = try #require(h.loop.lines.values.first { $0.latex == "2x = 9" })
        #expect(h.board.mark(on: "2x = 9") == .ring)
        // Next step's correction beside the ring (as when the ring lands with the kid stopped)
        #expect(h.loop.suggestNextStep(wrong.id, now: true))
        await h.pass(100)
        #expect(h.loop.hasSuggestion(wrong), "the ring's correction is written")
        let before = h.board.tutorStrokes.count
        h.loop.escalate(wrong.id)
        await h.pass(100)
        #expect(h.board.tutorStrokes.count == before, "nothing written a second time: \(steps(h))")
        #expect(steps(h) == ["2x = 8"])
        // the next ask goes on from the correction: the answer is all that is left (held back)
        h.loop.helpMe()
        await h.pass(100)
        #expect(h.board.tutorStrokes.count == before, "x = 4 is not written")
        #expect(h.loop.hints.first?.title == "One step left", "card: \(h.loop.hints.first.map { "\($0.title): \($0.message)" } ?? "-")")
    }

    @Test func nothingWrittenIsEverAStepTheEngineCannotCheck() async throws {
        let h = Harness(mode: .suggest)
        await h.start()
        await h.write("2x + 3 = 11", at: Vec2(200, 120))
        await h.pass(700)
        let line = try #require(h.loop.lines.values.first)
        // the model proposes a wrong step, then a right one: only the right one is written
        h.services.solveEvents = [[
            .step(try JSONDecoder().decode(SolveStep.self, from: Data(#"{"index":0,"latex":"2x = 14","explanation":"add 3","final":false}"#.utf8))),
            .step(try JSONDecoder().decode(SolveStep.self, from: Data(#"{"index":1,"latex":"2x = 8","explanation":"subtract 3","final":false}"#.utf8))),
        ]]
        let wrote = await h.loop.modelStep(entries: [.init(latex: line.latex, rect: line.bounds, line: line)], problem: [], head: nil, target: line,
                                           anchorId: line.id, from: 0, answer: false, askedAt: 0, gen: h.loop.generation)
        await h.pass(100)
        #expect(wrote)
        #expect(steps(h) == ["2x = 8"])
        // a model with only wrong steps: nothing is written, and the kid hears the tutor won't guess
        let h2 = Harness(mode: .suggest)
        await h2.start()
        await h2.write("2x + 3 = 11", at: Vec2(200, 120))
        await h2.pass(700)
        let l2 = try #require(h2.loop.lines.values.first)
        h2.services.solveEvents = [[.step(try JSONDecoder().decode(SolveStep.self, from: Data(#"{"index":0,"latex":"x = 7","explanation":"","final":true}"#.utf8)))]]
        let wrote2 = await h2.loop.modelStep(entries: [.init(latex: l2.latex, rect: l2.bounds, line: l2)], problem: [], head: nil, target: l2,
                                             anchorId: l2.id, from: 0, answer: false, askedAt: 0, gen: h2.loop.generation)
        #expect(!wrote2)
        #expect(steps(h2).isEmpty)
    }

    // MARK: - fractions

    @Test func aFractionSumGoesOnAfterTheKidsEquals() async throws {
        let h = Harness(mode: .suggest)
        await h.start()
        try await writeAny(h, "\\frac{1}{2} + \\frac{1}{3} =", at: Vec2(200, 120))
        await h.pass(700)
        trustAll(h)
        h.loop.helpMe()
        await h.pass(100)
        let line = try #require(h.loop.lines.values.first)
        let step = strokes(h, step: "\\frac{3}{6} + \\frac{2}{6}")
        #expect(!step.isEmpty, "\(steps(h))")
        #expect(step.first?.meta["tutorInline"]?.stringValue == line.id, "on the kid's line, after their =")
        #expect((box(step)?.x ?? 0) > line.bounds.maxX)
        #expect(h.loop.hints.first?.message == "Make the denominators the same: 6.")
        // the next ask: the sum is the answer, held back
        h.loop.moreHelp(try #require(h.loop.hints.first))
        await h.pass(100)
        #expect(h.loop.hints.first?.title == "One step left")
    }

    // MARK: - problem pages

    @Test func onAProblemWithNothingWrittenYetTheFirstStepGoesUnderIt() async throws {
        let h = Harness(mode: .suggest)
        await h.start()
        ChatProblemTests().tutorProblem(h, box: Box(x: 200, y: 100, w: 320, h: 60),
                                        meta: ChatProblemTests.chatMeta(["4x - 9 = 3"], cell: Box(x: 180, y: 80, w: 700, h: 600)))
        h.loop.problemsChanged()
        h.loop.showNextStep()
        await h.pass(100)
        #expect(steps(h) == ["4x = 12"])
        #expect((box(strokes(h, step: "4x = 12"))?.y ?? 0) > 160, "under the problem")
    }

    // MARK: - column arithmetic

    @Test func aStackedSumGetsItsNextColumnAndCarryInItsColumns() async throws {
        let h = Harness(mode: .suggest)
        await h.start()
        let ids = try await writeStack(h, ["286", "+680"], at: Vec2(300, 120))
        await h.pass(700)
        trustAll(h)
        let line = try #require(h.loop.lines.values.first)
        #expect(h.loop.stackLike(line), "read as a stacked sum: \(line.latex)")
        h.loop.helpMe()
        await h.pass(200)
        let ones = h.board.tutorStrokes(withMeta: "stackPart", "a0")
        #expect(!ones.isEmpty, "the ones digit: \(h.loop.hints.first?.message ?? "-")")
        #expect(ones.first?.meta["tutorStep"]?.stringValue == "6")
        #expect(h.loop.hints.first?.message == "Ones: 6 + 0 = 6.")
        // in the ones column: under the kid's last digit of 286
        let kid = ids.compactMap { h.board.store.stroke($0) }.map { StrokeBounds.of($0) }
        let right = kid.map(\.maxX).max() ?? 0
        let digit = try #require(box(ones))
        #expect(abs(digit.maxX - right) < 30, "lined up on the right (\(digit.maxX) vs \(right))")
        h.loop.moreHelp(try #require(h.loop.hints.first))
        await h.pass(800)
        #expect(!h.board.tutorStrokes(withMeta: "stackPart", "a1").isEmpty)
        let carry = try #require(box(h.board.tutorStrokes(withMeta: "stackPart", "c2")))
        #expect(carry.maxY < (kid.map(\.y).min() ?? 0) + 4, "the carry over the top row")
        #expect(h.loop.hints.first?.message == "Tens: 8 + 8 = 16. Write 6 and carry the 1.")
        // the last column: held back
        h.loop.moreHelp(try #require(h.loop.hints.first))
        await h.pass(200)
        #expect(h.board.tutorStrokes(withMeta: "stackPart", "a2").isEmpty)
        #expect(h.loop.hints.first?.title == "One step left")
    }

    @Test func longMultiplicationARowAtATime() async throws {
        let h = Harness(mode: .suggest)
        await h.start()
        try await writeStack(h, ["46", "\\times 23"], at: Vec2(300, 120))
        await h.pass(700)
        trustAll(h)
        h.loop.helpMe()
        await h.pass(1_000)
        #expect(!h.board.tutorStrokes(withMeta: "stackPart", "r0").isEmpty, "the first row: \(h.loop.hints.first?.message ?? "-")")
        #expect(h.loop.hints.first?.message == "Ones row: 46 × 3 = 138.")
        h.loop.moreHelp(try #require(h.loop.hints.first))
        await h.pass(1_000)
        #expect(!h.board.tutorStrokes(withMeta: "stackPart", "r1").isEmpty)
        #expect(h.loop.hints.first?.message == "Tens row: 46 × 20 = 920. The 0 holds the ones place.")
    }

    // MARK: - the offer

    @Test func aLongStallOnlyOffersTheStep() async throws {
        let h = Harness(mode: .suggest)
        await h.start()
        await h.write("2x + 3 = 11", at: Vec2(200, 120))
        await h.pass(LiveTiming.stuckMs + 3_000)
        let card = try #require(h.loop.hints.first, "the offer")
        #expect(card.action == .offer)
        #expect(steps(h).isEmpty, "nothing written uninvited")
        h.loop.moreHelp(card)
        await h.pass(100)
        // the kid's own problem read back first, then the step
        h.loop.moreHelp(try #require(h.loop.hints.first { $0.action == .readback }))
        await h.pass(100)
        #expect(steps(h) == ["2x = 8"])
    }

    // MARK: - the messy-handwriting guard

    @Test func aKidsOwnProblemIsReadBackOnceBeforeTheTutorWritesFromIt() async throws {
        let h = Harness(mode: .suggest)
        await h.start()
        await h.write("2x + 3 = 11", at: Vec2(200, 120))
        await h.pass(700)
        h.loop.helpMe()
        await h.pass(100)
        let card = try #require(h.loop.hints.first)
        #expect(card.action == .readback && card.title == "I read" && card.message == "I read: 2x + 3 = 11")
        #expect(steps(h).isEmpty, "nothing written before the read is confirmed")
        h.loop.moreHelp(card)
        await h.pass(100)
        #expect(steps(h) == ["2x = 8"], "Yes: the step, from the confirmed line")
        // confirmed once: the next ask needs no readback
        h.loop.moreHelp(try #require(h.loop.hints.first))
        await h.pass(100)
        #expect(h.loop.hints.first?.title == "One step left")
    }

    @Test func aMisreadProblemIsNeverWorkedFixItAndTheStepIsForTheRealOne() async throws {
        let h = Harness(mode: .suggest)
        await h.start()
        // she wrote 2x + 3 = 11; it was read, with no doubt, as 2x + 3 = 17
        await h.write("2x + 3 = 11", at: Vec2(200, 120), reads: "2x + 3 = 17")
        await h.pass(700)
        h.loop.helpMe()
        await h.pass(100)
        let card = try #require(h.loop.hints.first)
        #expect(card.message == "I read: 2x + 3 = 17")
        #expect(steps(h).isEmpty, "never 2x = 14")
        // Fix it: "Fix what I read" opens; she types what she wrote; the step is for that
        h.loop.cardFirstButton(card)
        #expect(h.loop.pages.fixing?.id == card.lineId)
        h.loop.useReading(card.lineId, latex: "2x + 3 = 11")
        await h.pass(200)
        #expect(steps(h) == ["2x = 8"])
    }

    @Test func onTheTutorsProblemALineThatDisagreesIsReadBackNotCorrected() async throws {
        let h = Harness(mode: .suggest)
        await h.start()
        ChatProblemTests().tutorProblem(h, box: Box(x: 200, y: 100, w: 320, h: 60),
                                        meta: ChatProblemTests.chatMeta(["2x + 3 = 11"], cell: Box(x: 180, y: 80, w: 700, h: 600)))
        h.loop.problemsChanged()
        // she wrote 2x = 8; it was read as 2x = 6
        await h.write("2x = 8", at: Vec2(200, 220), reads: "2x = 6")
        await h.pass(3_500)
        let line = try #require(h.loop.lines.values.first { $0.latex == "2x = 6" })
        // (Next step's own correction beside the ring, unasked, may be there already: the guard is Help me's)
        let before = steps(h)
        h.loop.showNextStep(lineId: line.id)
        await h.pass(100)
        #expect(h.loop.hints.first?.action == .readback)
        #expect(h.loop.hints.first?.message == "I read: 2x = 6")
        #expect(steps(h) == before, "Help me writes no correction beside a line that may be misread")
        // she says it IS 2x = 6: a slip, and the right step goes beside it
        h.loop.moreHelp(try #require(h.loop.hints.first))
        await h.pass(100)
        #expect(steps(h) == ["2x = 8"])
        // a line that agrees with the problem needs no readback at all
        let h2 = Harness(mode: .suggest)
        await h2.start()
        ChatProblemTests().tutorProblem(h2, box: Box(x: 200, y: 100, w: 320, h: 60),
                                        meta: ChatProblemTests.chatMeta(["2x + 3 = 11"], cell: Box(x: 180, y: 80, w: 700, h: 600)))
        h2.loop.problemsChanged()
        await h2.write("2x = 8", at: Vec2(200, 220))
        await h2.pass(3_500)
        h2.loop.settings.answerOnEquals = true
        h2.loop.showNextStep(answer: true)
        await h2.pass(100)
        #expect(steps(h2) == ["x = 4"])
    }

    @Test func aDoubtfulReadOrADisagreeingSecondOpinionIsReadBackFirst() async throws {
        for (confidence, second) in [(0.85, nil), (0.995, ("2x = 9", false))] as [(Double, (String, Bool)?)] {
            let h = Harness(mode: .suggest)
            await h.start()
            ChatProblemTests().tutorProblem(h, box: Box(x: 200, y: 100, w: 320, h: 60),
                                            meta: ChatProblemTests.chatMeta(["2x + 3 = 11"], cell: Box(x: 180, y: 80, w: 700, h: 600)))
            h.loop.problemsChanged()
            await h.write("2x = 8", at: Vec2(200, 220), confidence: confidence, second: second.map { (latex: $0.0, agree: $0.1) })
            await h.pass(3_500)
            let line = try #require(h.loop.lines.values.first { $0.latex == "2x = 8" })
            h.loop.showNextStep(lineId: line.id)
            await h.pass(100)
            #expect(h.loop.hints.first?.action == .readback, "confidence \(confidence), second \(String(describing: second))")
            #expect(steps(h).isEmpty)
        }
    }

    @Test func aStackedSumIsHeldToTheProblemAndToItsInk() async throws {
        // the tutor's problem is 286 + 680; the rows were read 286 + 600
        let h = Harness(mode: .suggest)
        await h.start()
        ChatProblemTests().tutorProblem(h, box: Box(x: 300, y: 40, w: 200, h: 40),
                                        meta: ChatProblemTests.chatMeta(["286 + 680"], cell: Box(x: 180, y: 20, w: 700, h: 600)))
        h.loop.problemsChanged()
        let ids = try await writeStack(h, ["286", "+680"], at: Vec2(300, 120))
        await h.register(ids, reads: "\\begin{array}{r} 286 \\\\ +600 \\\\ \\hline \\end{array}")
        await h.pass(700)
        h.loop.helpMe()
        await h.pass(300)
        #expect(h.loop.hints.first?.action == .readback, "\(h.loop.hints.first?.message ?? "-")")
        #expect(h.loop.hints.first?.message == "I read: 286 − 600" || h.loop.hints.first?.message == "I read: 286 + 600")
        #expect(h.board.tutorStrokes(withMeta: "stackPart").isEmpty)
        // a carry merged into the top row (read 1286 over three digits of ink): words only
        let h2 = Harness(mode: .suggest)
        await h2.start()
        let ids2 = try await writeStack(h2, ["286", "+680"], at: Vec2(300, 120))
        await h2.register(ids2, reads: "\\begin{array}{r} 1286 \\\\ +680 \\\\ \\hline \\end{array}")
        await h2.pass(700)
        trustAll(h2)
        h2.loop.helpMe()
        await h2.pass(300)
        #expect(h2.board.tutorStrokes(withMeta: "stackPart").isEmpty, "no digits")
        #expect(h2.loop.hints.first?.title == "Let's look together")
    }
}
