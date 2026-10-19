import Foundation
import Testing
@testable import AgathonBoard

struct HandPaceTests {
    @Test func densifyKeepsPointsWithinTwoUnits() {
        let s = [FreehandInput(Vec2(0, 0), 0.3), FreehandInput(Vec2(100, 0), 0.5), FreehandInput(Vec2(100, 37), 0.4)]
        let d = HandPace.densify(s)
        for (a, b) in zip(d, d.dropFirst()) { #expect(a.p.dist(b.p) <= 2.0001) }
        #expect(d.first!.p == s.first!.p && d.last!.p == s.last!.p)
        // a very long stroke is resampled more coarsely, never cut short (the web's ring fix)
        let long = HandPace.densify([FreehandInput(Vec2(0, 0), 0.5), FreehandInput(Vec2(3000, 0), 0.5)])
        #expect(long.count <= HandPace.maxPointsPerStroke)
        #expect(long.last!.p == Vec2(3000, 0))
    }

    @Test func timingMatchesTheWeb() {
        // mathLayout.ts: clamp(60 + length / 0.45, 60, 900)
        let line45 = [FreehandInput(Vec2(0, 0), 0.5), FreehandInput(Vec2(45, 0), 0.5)]
        #expect(abs(HandPace.strokeDurationMs(line45) - 160) < 1e-9)
        #expect(HandPace.strokeDurationMs([FreehandInput(Vec2(0, 0), 0.5)]) == 60)
        #expect(HandPace.strokeDurationMs([FreehandInput(Vec2(0, 0), 0.5), FreehandInput(Vec2(2000, 0), 0.5)]) == 900)
        // handwriting.ts paceFor
        #expect(HandPace.paceFor(3000) == 1)
        #expect(abs(HandPace.paceFor(10_000) - 10_000.0 / 6000) < 1e-9)
        #expect(HandPace.paceFor(100_000) == 5)
    }

    @Test func planLaysLinesOnTheClock() {
        let a = TutorLine(strokes: [TutorStroke([(0, 0), (45, 0)]), TutorStroke([(0, 10), (45, 10)])], latex: "a")
        let b = TutorLine(strokes: [TutorStroke([(0, 50), (45, 50)])], latex: "b")
        let plan = HandPace.plan([a, b])
        #expect(plan.lines.count == 2)
        #expect(plan.lines[0].durationMs == 160 + 40 + 160)
        #expect(plan.lines[1].startMs == 360 + 450)
        #expect(plan.totalMs == 360 + 450 + 160)
        #expect(plan.pace == 1)
        // the reveal: nothing, then the first stroke growing, then both
        #expect(HandPace.revealCounts(plan.lines[0], localMs: 0) == [0, 0])
        let half = HandPace.revealCounts(plan.lines[0], localMs: 80)
        #expect(half[0] > 2 && half[0] < plan.lines[0].strokes[0].points.count && half[1] == 0)
        let all = HandPace.revealCounts(plan.lines[0], localMs: 10_000)
        #expect(all == plan.lines[0].strokes.map(\.points.count))
    }

    @Test func tutorStrokeRecordsCarryTheirTiming() {
        let line = TutorLine(strokes: [TutorStroke([(100, 100), (145, 100)])], latex: "x = 4")
        let plan = HandPace.plan([line])
        let r = HandPace.strokeRecord(plan, line: 0, stroke: 0, screen: "screen:a", order: "a1", blockStart: 1000, block: "hb_1", meta: ["live": true])
        #expect(r.author == .tutor && r.color == .tutor)
        #expect(r.x == 100 && r.y == 100)
        #expect(r.start == 1000)
        #expect(abs(Double(r.points.last!.t) - 160) < 0.01)
        #expect(r.meta["handLine"] == "x = 4" && r.meta["handBlock"] == "hb_1" && r.meta["live"] == true)
        #expect(r.width == 3)
    }

    @Test @MainActor func tutorWritingIsSavedButNotUndoable() {
        let store = storeWithScreen()
        store.put(.stroke(line("stroke:kid", 0, 100, y: 10, order: "a1")), origin: .kid)
        let plan = HandPace.plan([TutorLine(strokes: TutorMarks.strokes(.tick, line: Box(x: 0, y: 0, w: 100, h: 20), seed: 1))])
        store.transact(.tutor) { tx in
            tx.put(.stroke(HandPace.strokeRecord(plan, line: 0, stroke: 0, screen: "screen:a", order: store.nextOrder(on: "screen:a"),
                                                 blockStart: 0, block: "hb", meta: [:])))
        }
        #expect(store.strokeCount == 2)
        #expect(store.peekDirty().changed.count == 2)
        store.undo()
        #expect(store.strokeCount == 1)
        #expect(store.stroke("stroke:kid") == nil)
        #expect(!store.canUndo)
    }
}

struct TutorMarksTests {
    // values from the web's own markStrokes (src/lib/live/marks.ts) for line {100, 200, 300, 60}, seed 12345
    let lineBox = Box(x: 100, y: 200, w: 300, h: 60)

    @Test func tickMatchesTheWeb() {
        let s = TutorMarks.strokes(.tick, line: lineBox, seed: 12345)
        #expect(s.count == 1 && s[0].points.count == 6)
        #expect(s[0].points[0].p.dist(Vec2(418.47972826776095, 232.00675226449965)) < 1e-9)
        #expect(s[0].points[5].p.dist(Vec2(457.55993487350645, 208.44584418600425)) < 1e-9)
        #expect(abs(s[0].points[5].pressure - 0.5995407957751765) < 1e-12)
    }

    @Test func ringMatchesTheWeb() {
        let s = TutorMarks.strokes(.ring, line: lineBox, seed: 12345)
        #expect(s.count == 1 && s[0].points.count == 49)
        #expect(s[0].points[0].p.dist(Vec2(39.124048502885636, 212.22676913015414)) < 1e-9)
        #expect(s[0].points[48].p.dist(Vec2(74.7805627004354, 197.65066618124047)) < 1e-9)
    }

    @Test func questionMatchesTheWeb() {
        let s = TutorMarks.strokes(.question, line: lineBox, seed: 12345)
        #expect(s.map(\.points.count) == [16, 2])
        #expect(s[0].points[0].p.dist(Vec2(418.9759987670374, 223.6845074435366)) < 1e-9)
        #expect(s[1].points[1].p.dist(Vec2(430.5695547702257, 250.7423977028113)) < 1e-9)
    }
}
