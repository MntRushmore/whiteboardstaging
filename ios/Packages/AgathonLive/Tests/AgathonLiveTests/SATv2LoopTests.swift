import AgathonBoard
import AgathonBrain
import AgathonKit
import Foundation
import Testing
@testable import AgathonLive

/// SAT v2 on the loop (docs/SAT-V2.md): Graph it and "Graph an equation" onto the question's own
/// plane, ink on the figure never read as a line, the tutor's maths written with help off (the
/// ladder's bank steps), one step through the live Help me, and `sat_figure_marks` on the bodies.
@MainActor
@Suite(.serialized)
struct SATv2LoopTests {
    /// A plane like the fixture's plotted line: x −2…5, y −2…6, its grid at (972, 120) 534 × 388.
    let plane = QuestionPlot(grid: BrainRect(x: 972, y: 120, w: 534, h: 388), xMin: -2, xMax: 5, yMin: -2, yMax: 6)

    @Test func aPlanesPageAndGraphPoints() {
        let p = plane.page(0, 0)
        #expect(abs(p.x - (972 + 2.0 / 7 * 534)) < 1e-9)
        #expect(abs(p.y - (120 + 388 - 2.0 / 8 * 388)) < 1e-9)
        // y = 2x + 1 runs off the top at x = 2.5: one piece, inside the grid (a hair of slack)
        let lines = plane.polylines("2*x+1")
        #expect(lines.count == 1)
        #expect(lines[0].allSatisfy { $0.x >= 972 - 0.01 && $0.x <= 1506.01 && $0.y >= 120 - 9 && $0.y <= 508 + 9 })
        // 1/x breaks at 0
        #expect(plane.polylines("1/x").count == 2)
        #expect(plane.polylines("not maths(").isEmpty)
    }

    @Test func graphItDrawsOntoTheQuestionsPlane() async throws {
        let h = Harness()
        h.loop.questionPlot = { [plane] _ in plane }
        await h.start()
        await h.write("2x = 8", at: Vec2(200, 300), reads: "y = 2x + 1")
        await h.pass(700)
        let offer = try #require(h.loop.graphOffers.first)
        h.loop.graphIt(offer.id)
        await h.pass(50)
        // no graph object: tutor ink on the plane, in its coordinates
        #expect(!h.board.store.records.values.contains { if case .graph = $0 { return true } else { return false } })
        let ink = h.board.tutorStrokes(withMeta: "graphFor", "y = 2x + 1")
        #expect(!ink.isEmpty)
        #expect(ink.allSatisfy { $0.meta["figure"]?.stringValue == "plot" && $0.color == .tutor })
        // it passes through (0, 1) of the plane
        let p01 = plane.page(0, 1)
        let points = ink.flatMap { s in s.points.map { s.pagePoint($0) } }
        #expect(points.contains { abs($0.x - p01.x) < 3 && abs($0.y - p01.y) < 3 })
        // asked once
        h.loop.graphIt(offer.id)
        await h.pass(50)
        #expect(h.board.tutorStrokes(withMeta: "graphFor", "y = 2x + 1").count == ink.count)
    }

    @Test func aTypedEquationGoesOntoThePlaneWithHelpOff() async throws {
        let h = Harness()
        h.loop.questionPlot = { [plane] _ in plane }
        await h.start()
        h.loop.settings.enabled = false
        #expect(await h.loop.graphTyped("y = -2x + 4") == .graphed)
        let ink = h.board.tutorStrokes(withMeta: "graphFor")
        #expect(!ink.isEmpty && ink.allSatisfy { $0.meta["source"]?.stringValue == "typed" })
        #expect(h.services.recognizeRequests.isEmpty && h.services.checkRequests.isEmpty, "no call made")
        // a page with no plane: as before, a graph object
        h.loop.questionPlot = { _ in nil }
        #expect(await h.loop.graphTyped("y = x") == .graphed)
        #expect(h.board.store.records.values.contains { if case .graph = $0 { return true } else { return false } })
    }

    @Test func inkOnTheFigureIsNeverReadAsALine() async throws {
        let h = Harness()
        await h.start()
        // a circle round (2, 0) on the plane, tagged as the canvas tags it
        let c = plane.page(2, 0)
        let loop = (0...20).map { i -> Vec2 in
            let t = Double(i) / 20 * 2 * .pi
            return Vec2(c.x + 18 * cos(t), c.y + 18 * sin(t))
        }
        let s = StrokeRecord(screen: h.board.currentScreenID, order: h.board.store.nextOrder(on: h.board.currentScreenID), author: .kid,
                             color: .black, width: 2.9, pressure: .simulated, x: loop[0].x, y: loop[0].y,
                             points: loop.map { InkPoint(x: $0.x - loop[0].x, y: $0.y - loop[0].y) }, meta: ["figure": "plot"])
        h.board.store.put(.stroke(s), origin: .kid)
        await h.pass(900)
        #expect(h.services.recognizeRequests.isEmpty, "the figure's ink is not a line to read")
        #expect(h.loop.lines.isEmpty)
        // a line of work beside it is read as ever
        await h.write("2x = 8", at: Vec2(200, 300))
        await h.pass(900)
        #expect(h.services.recognizeRequests.count == 1)
    }

    @Test func theTutorsMathIsWrittenWithHelpOff() async throws {
        let h = Harness()
        await h.start()
        h.loop.settings.enabled = false
        let box = try #require(await h.loop.writeTutorMath(["m = \\frac{0 - 4}{2 - 0}"], at: Vec2(140, 400), lineHeight: 44, seedKey: "q:step0",
                                                           meta: ["satStep": 0]))
        #expect(abs(box.x - 140) < 0.01 && abs(box.y - 400) < 0.01)
        h.board.finishWrites()
        await h.pass(50)
        let ink = h.board.tutorStrokes(withMeta: "source", "sat")
        #expect(!ink.isEmpty)
        #expect(ink.allSatisfy { $0.meta["satStep"]?.numberValue == 0 })
        #expect(h.services.recognizeRequests.isEmpty && h.services.solveRequests.isEmpty)
    }

    @Test func oneStepGoesThroughTheLiveHelpMe() async throws {
        let h = Harness(mode: .feedback)
        await h.start()
        // nothing read: the app writes the bank's step instead
        #expect(!h.loop.helpOneStep())
        await h.write("2x = 8", at: Vec2(200, 300))
        await h.pass(900)
        #expect(h.loop.readLines.map(\.latex) == ["2x = 8"])
        #expect(h.loop.helpOneStep())
        #expect(h.loop.settings.mode == .suggest)
        await h.pass(900)
        h.board.finishWrites()
        // the engine's next step, written by the tutor under the work
        #expect(!h.board.tutorStrokes.isEmpty || !h.board.writes.isEmpty)
        // help off (capped): no live step
        h.loop.settings.enabled = false
        #expect(!h.loop.helpOneStep())
    }

    @Test func theFigureMarksRideOnEveryBody() throws {
        let tag = LiveRequestTag(satQuestionId: "algebra-linear-two-var-0102")
        #expect(tag.fields == ["sat_question_id": "algebra-linear-two-var-0102"])
        tag.satFigureMarks = "On the question's graph the student drew: circled near (0, 19)."
        #expect(tag.fields["sat_figure_marks"] == "On the question's graph the student drew: circled near (0, 19).")
        tag.satFigureMarks = String(repeating: "x", count: 400)
        #expect(tag.fields["sat_figure_marks"]?.count == 300)
        tag.satFigureMarks = ""
        #expect(tag.fields["sat_figure_marks"] == nil)
        // never on an ordinary board's bodies
        tag.satFigureMarks = "circled"
        tag.satQuestionId = nil
        #expect(tag.fields.isEmpty)
    }
}
