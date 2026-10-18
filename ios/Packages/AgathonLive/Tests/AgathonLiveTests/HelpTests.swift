import AgathonBoard
import AgathonBrain
import AgathonKit
import Foundation
import Testing
@testable import AgathonLive

/// Help me, Solve it, Auto, hints, Now you try.
@MainActor
@Suite(.serialized)
struct HelpTests {
    func slip(_ h: Harness) async {
        await h.write("2x + 3 = 11", at: Vec2(200, 120))
        await h.write("2x = 8", at: Vec2(200, 220))
        await h.write("x = 5", at: Vec2(200, 320))
        await h.pass(700)
    }

    func annotation(_ json: String) throws -> Annotation {
        try JSONDecoder().decode(Annotation.self, from: Data(json.utf8))
    }

    @Test func hintModeHelpMeOpensAHintCardWithTheModelsWords() async throws {
        let h = Harness(mode: .feedback)
        await h.start()
        await slip(h)
        let lineId = try #require(h.loop.lines.values.first { $0.latex == "x = 5" }?.id)
        h.services.checkEvents = [[
            .meta(requestId: "r1", model: "m"),
            .annotation(try annotation(#"{"lineId":"\#(lineId)","verdict":"warn","kind":"arithmetic","message":"Look again at how you divided 8 by 2.","question":"What is 8 divided by 2?","confidence":0.9}"#)),
            .done(count: 1, ms: 300),
        ]]
        h.loop.helpMe()
        await h.pass(100)
        let req = try #require(h.services.checkRequests.first)
        #expect(req.focusLineId == lineId && req.userAsked && req.mode == "feedback")
        #expect(req.lines.map(\.latex) == ["2x + 3 = 11", "2x = 8", "x = 5"])
        let card = try #require(h.loop.hints.first)
        #expect(card.lineId == lineId)
        #expect(card.message == "Look again at how you divided 8 by 2.")
        #expect(card.title == "Hint")
        // More help: the right next step, by hand, beside the line; the card closes
        h.loop.moreHelp(card)
        await h.pass(100)
        #expect(h.loop.hints.isEmpty)
        #expect(h.board.tutorStrokes(withMeta: "suggestFor", "x = 5").first?.meta["handLine"]?.stringValue == "x = 4")
        #expect(h.services.solveRequests.isEmpty, "the engine knew the step: no model")
    }

    @Test func aCheckThatSaysNothingStillGivesTheKidAHint() async throws {
        let h = Harness(mode: .feedback)
        await h.start()
        await slip(h)
        h.services.checkEvents = [[.meta(requestId: "r", model: "m"), .done(count: 0, ms: 10)]]
        h.loop.helpMe()
        await h.pass(100)
        #expect(h.loop.hints.first?.message.isEmpty == false, "the engine's own words when the model has none")
    }

    @Test func nextStepModeHelpMeWritesTheNextStep() async throws {
        let h = Harness(mode: .suggest)
        await h.start()
        await h.write("2x + 3 = 11", at: Vec2(200, 120))
        await h.pass(700)
        h.loop.helpMe()
        await h.pass(100)
        let block = h.board.tutorStrokes.filter { $0.meta["handLine"] != nil && $0.meta["mark"] == nil }
        #expect(block.first?.meta["handLine"]?.stringValue == "2x = 8", "one step, from the engine")
        #expect(Set(block.compactMap { $0.meta["handLine"]?.stringValue }).count == 1)
        #expect(h.services.solveRequests.isEmpty)
    }

    @Test func solveItWritesTheWholeSolutionByHandUnderTheWork() async throws {
        let h = Harness(mode: .answer)
        await h.start()
        await h.write("2x + 3 = 11", at: Vec2(200, 120))
        await h.pass(700)
        h.loop.solveIt()
        await h.pass(100)
        let solution = h.board.tutorStrokes(withMeta: "solvedLatex", "2x + 3 = 11")
        #expect(Set(solution.compactMap { $0.meta["handLine"]?.stringValue }) == ["2x = 8", "x = 4"])
        let work = try #require(h.loop.lines.values.first)
        #expect(solution.allSatisfy { StrokeBounds.of($0).y > work.bounds.maxY }, "under the work")
        #expect(h.services.solveRequests.isEmpty)
        #expect(h.loop.metrics.solveFirstStep.count == 1)
        // asked again: nothing new is written
        let count = h.board.tutorStrokes.count
        h.loop.solveIt()
        await h.pass(100)
        #expect(h.board.tutorStrokes.count == count)
    }

    @Test func solveModeAnswersTheKidsEqualsSignOnceTheyStop() async throws {
        let h = Harness(mode: .answer)
        await h.start()
        await h.write("36 + 2 =", at: Vec2(200, 120))
        await h.pass(700)
        #expect(h.board.tutorStrokes(withMeta: "answerFor").isEmpty, "an answer waits for the kid to stop")
        await h.pass(2_500)
        let answer = h.board.tutorStrokes(withMeta: "answerFor", "36 + 2 =")
        #expect(!answer.isEmpty)
        #expect(answer.first?.meta["answerLatex"]?.stringValue == "38")
        let line = try #require(h.loop.lines.values.first)
        #expect(answer.allSatisfy { StrokeBounds.of($0).x > line.bounds.maxX }, "after the kid's =, on their line")
    }

    @Test func feedbackNeverFinishesTheKidsLine() async throws {
        let h = Harness(mode: .feedback)
        await h.start()
        await h.write("36 + 2 =", at: Vec2(200, 120))
        await h.pass(4_000)
        #expect(h.board.tutorStrokes(withMeta: "answerFor").isEmpty)
    }

    @Test func autoInSolveFinishesTheProblemAtThePause() async throws {
        let h = Harness(mode: .answer)
        await h.start()
        await h.write("5x + 2 = 17", at: Vec2(200, 120))
        await h.pass(700)
        #expect(h.board.tutorStrokes(withMeta: "solvedLatex").isEmpty)
        await h.pass(2_500)
        #expect(!h.board.tutorStrokes(withMeta: "solvedLatex", "5x + 2 = 17").isEmpty)
    }

    @Test func theModelsStepsAreCheckedThenWrittenAsOneBlock() async throws {
        let h = Harness(mode: .answer, auto: false)
        await h.start()
        // the engine cannot solve this one (the fake reader reads the ink as an ODE)
        await h.write("x = 3", at: Vec2(200, 120), reads: "y'' + y = 0")
        await h.pass(700)
        func step(_ i: Int, _ latex: String, final: Bool = false) throws -> LiveEvent {
            .step(try JSONDecoder().decode(SolveStep.self, from: Data(#"{"index":\#(i),"latex":"\#(latex)","explanation":"","final":\#(final)}"#.utf8)))
        }
        h.services.solveEvents = [[
            .meta(requestId: "s1", model: "m"),
            try step(1, "r^{2} + 1 = 0"),
            try step(2, "The roots are imaginary"),
            try step(3, "\\\\boxed{y = A \\\\cos x + B \\\\sin x}", final: true),
            .done(count: 3, ms: 900),
        ]]
        h.loop.solveIt()
        await h.pass(100)
        #expect(h.services.solveRequests.count == 1)
        let written = Set(h.board.tutorStrokes(withMeta: "solvedLatex").compactMap { $0.meta["handLine"]?.stringValue })
        #expect(written.contains("r^{2} + 1 = 0"))
        #expect(written.contains("y = A \\cos x + B \\sin x"), "boxed unwrapped")
        #expect(!written.contains("The roots are imaginary"), "words never reach the board")
    }

    @Test func nowYouTryIsOfferedAfterTheTutorSolvesAndWritesAProblemTheKidsWorkIsCheckedAgainst() async throws {
        let h = Harness(mode: .answer, auto: false)
        await h.start()
        await h.write("5x + 2 = 17", at: Vec2(200, 120))
        await h.pass(700)
        h.loop.solveIt()
        await h.pass(200)
        let offer = try #require(h.loop.offer)
        #expect(offer.parent == ["5x + 2 = 17"])
        #expect(offer.problem.count == 1 && offer.problem[0] != "5x + 2 = 17")
        h.loop.takeOffer()
        await h.pass(100)
        let problem = try #require(h.board.problems.first { $0.origin == "nowYouTry" })
        #expect(problem.latex == offer.problem.joined(separator: "\n"))
        #expect(!h.board.tutorStrokes(withMeta: "lineId", "problem:\(problem.id.key)").isEmpty, "written in the tutor's hand")
    }

    @Test func cheersFollowTicksAndBigOnesFollowASolvedProblem() async throws {
        let h = Harness(mode: .feedback)
        await h.start()
        await h.write("3x - 5 = 10", at: Vec2(200, 120))
        await h.write("3x = 15", at: Vec2(200, 220))
        await h.write("x = 5", at: Vec2(200, 320))
        await h.pass(700)
        await h.pass(800)
        #expect(h.loop.cheers.contains { $0.tone == .win })
        #expect(h.loop.cheers.contains { $0.tone == .solved && $0.big })
        #expect(h.loop.bigBurst == 1)
    }
}
