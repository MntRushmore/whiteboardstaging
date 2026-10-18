import AgathonBoard
import AgathonBrain
import AgathonKit
import Foundation
import Testing
@testable import AgathonLive

/// Calculator's Math Notes, kid-safe: "Graph it" beside a function line, and the grown-ups' "Show
/// the answer when I write =".
@MainActor
@Suite(.serialized)
struct MathNotesTests {
    // MARK: Graph it

    @Test func aFunctionLineIsOfferedItsGraphAndATapPutsItBesideTheLine() async throws {
        let h = Harness()
        await h.start()
        // the fixture has no `y = …` ink: any line, read as one
        let ids = await h.write("2x = 8", at: Vec2(200, 150), reads: "y = 2x + 1")
        await h.pass(700)
        let offer = try #require(h.loop.graphOffers.first, "Graph it, beside the line")
        #expect(offer.latex == "y = 2x + 1")
        #expect(h.board.store.records.values.allSatisfy { if case .graph = $0 { return false } else { return true } }, "nothing graphed unasked")

        h.loop.graphIt(offer.id)
        await h.pass(50)
        #expect(h.loop.graphOffers.isEmpty)
        let graph = try #require(h.board.store.records.values.compactMap { r -> GraphRecord? in if case .graph(let g) = r { return g } else { return nil } }.first)
        #expect(graph.author == .tutor && graph.meta["graphFor"]?.stringValue == "y = 2x + 1")
        #expect(graph.functions.first.map { MathExpr.compile($0.expr)?(2) } == 5, "it plots 2x + 1: \(graph.functions)")
        // on the screen, clear of the kid's ink
        let screen = h.board.screenRect
        let box = BrainRect(x: graph.x, y: graph.y, w: graph.w, h: graph.h)
        #expect(box.x >= screen.x && box.maxX <= screen.maxX && box.y >= screen.y && box.maxY <= screen.maxY)
        let ink = BrainRect.around(ids.compactMap { h.board.store.stroke($0) }.map(StrokeBounds.of))!
        #expect(!box.intersects(ink))
        // asked once: no second chip, no second graph
        await h.pass(700)
        #expect(h.loop.graphOffers.isEmpty)
        h.loop.graphIt(offer.id)
        await h.pass(50)
        #expect(h.board.store.records.values.filter { if case .graph = $0 { return true } else { return false } }.count == 1)
    }

    @Test func theChipGoesAfterAWhileAndIsNotOfferedForEquations() async throws {
        let h = Harness()
        await h.start()
        await h.write("2x = 8", at: Vec2(200, 150), reads: "y = x + 5")
        await h.write("x = 4", at: Vec2(200, 300))
        await h.pass(700)
        #expect(h.loop.graphOffers.map(\.latex) == ["y = x + 5"], "an equation is no function")
        await h.pass(LiveTiming.graphOfferMs)
        #expect(h.loop.graphOffers.isEmpty)
    }

    @Test func aGraphGoesWhenItsLineIsRewritten() async throws {
        let h = Harness()
        await h.start()
        let ids = await h.write("2x = 8", at: Vec2(200, 150), reads: "y = 2x + 1")
        await h.pass(700)
        h.loop.graphIt(try #require(h.loop.graphOffers.first).id)
        await h.pass(50)
        #expect(h.board.store.records.values.contains { if case .graph = $0 { return true } else { return false } })
        // the kid rubs the line out: its graph goes with it
        h.board.erase(ids)
        await h.pass(700)
        #expect(!h.board.store.records.values.contains { if case .graph = $0 { return true } else { return false } })
    }

    @Test func offHasNoChip() async throws {
        let h = Harness(mode: .off)
        await h.start()
        await h.write("2x = 8", at: Vec2(200, 150), reads: "y = 2x + 1")
        await h.pass(700)
        #expect(h.loop.graphOffers.isEmpty)
    }

    // MARK: Show the answer when I write =

    @Test func theGrownUpsAnswerAfterEqualsComesAtOnceInAnyMode() async throws {
        let h = Harness(mode: .feedback)
        h.loop.settings.answerOnEquals = true
        await h.start()
        await h.write("36 + 2 =", at: Vec2(200, 120))
        await h.pass(500)
        let answer = h.board.tutorStrokes(withMeta: "answerFor", "36 + 2 =")
        #expect(!answer.isEmpty, "no waiting for the kid to stop (read early, before the gate)")
        #expect(answer.first?.meta["answerLatex"]?.stringValue == "38")
        #expect((h.loop.metrics.penUpToMark.isEmpty), "an answer, not a mark")
        #expect(h.services.recognizeRequests.count == 1)
    }

    @Test func offByDefaultTheTutorNeverHandsOutTheAnswer() async throws {
        #expect(LiveSettings.default.answerOnEquals == false)
        let h = Harness(mode: .suggest)
        await h.start()
        await h.write("36 + 2 =", at: Vec2(200, 120))
        await h.pass(4_000)
        #expect(h.board.tutorStrokes(withMeta: "answerFor").isEmpty)
    }

    @Test func autoOffStillAnswersWhenTheGrownUpsAskedForIt() async throws {
        let h = Harness(mode: .feedback, auto: false)
        h.loop.settings.answerOnEquals = true
        await h.start()
        await h.write("36 + 2 =", at: Vec2(200, 120))
        await h.pass(700)
        #expect(!h.board.tutorStrokes(withMeta: "answerFor", "36 + 2 =").isEmpty)
    }

    @Test func settingsSavedBeforeTheNewSwitchStillLoad() throws {
        let old = #"{"enabled":true,"mode":"answer","auto":false,"handwriting":false,"celebrations":true}"#
        let s = try JSONDecoder().decode(LiveSettings.self, from: Data(old.utf8))
        #expect(s.mode == .answer && !s.auto && !s.handwriting && s.celebrations && !s.answerOnEquals)
        var on = s
        on.answerOnEquals = true
        let back = try JSONDecoder().decode(LiveSettings.self, from: JSONEncoder().encode(on))
        #expect(back == on)
    }

    @Test func thePolicyAnswersAfterEqualsOnlyWhenAsked() async throws {
        // with the switch on, the loop has the engine work it out as in Solve
        let a = try await TestBrain.shared.analyzeLine("36 + 2 =", context: AnalyzeContext(mode: .answer))
        #expect(a.resultLatex == "38")
        func input(_ mode: LiveMode, settled: Bool, on: Bool) -> LivePolicy.Input {
            LivePolicy.Input(mode: mode, analysis: a, confidence: 0.98, settled: settled, auto: true, userAsked: false, latex: "36 + 2 =", answerOnEquals: on)
        }
        for mode in [LiveMode.off, .feedback, .suggest, .answer] {
            #expect(LivePolicy.decide(input(mode, settled: false, on: true)).showResult, "\(mode): at once with the switch on")
            #expect(LivePolicy.decide(input(mode, settled: true, on: false)).showResult == (mode == .answer), "\(mode): only Solve, without it")
        }
    }
}
