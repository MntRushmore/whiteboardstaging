import Foundation
import Testing
@testable import AgathonSATCore

/// A measure with no fonts: every character half its size wide, a line 1.4 sizes tall, words wrapped
/// at the width (maths counted by its plain characters). Deterministic on any machine.
struct FakeMeasure: SATTextMeasuring {
    func measure(_ source: String, size: Double, weight: SATTextWeight, maxWidth: Double) -> SATSize {
        // each block a paragraph of its own; maths by its characters as written out ("2x + y = 4")
        func flat(_ nodes: [SATInline]) -> String {
            nodes.map { n -> String in
                switch n {
                case .text(let t): t
                case .bold(let c): flat(c)
                case .math(let m): SATMathWords.plain(m)
                }
            }.joined()
        }
        let plain = SATRichText.parse(source).map { b -> String in
            switch b {
            case .paragraph(let n): flat(n)
            case .math(let m): SATMathWords.plain(m)
            case .bullets(let items): items.map(flat).joined(separator: "\n")
            }
        }.joined(separator: "\n")
        let charW = size * (weight == .semibold ? 0.55 : 0.5)
        let lineH = size * 1.4
        var lines = 0
        var widest = 0.0
        for paragraph in plain.components(separatedBy: "\n") {
            var cur = 0.0
            lines += 1
            for word in paragraph.split(separator: " ") {
                let w = Double(word.count) * charW
                let add = cur == 0 ? w : cur + charW + w
                if add > maxWidth && cur > 0 {
                    widest = max(widest, cur)
                    lines += 1
                    cur = w
                } else {
                    cur = add
                }
            }
            widest = max(widest, cur)
        }
        return SATSize(min(widest, maxWidth), Double(lines) * lineH)
    }
}

/// The printed page's layout (docs/SAT-V2.md, "The question is the page"): its numbers pinned, so a
/// change to them is a decision, not an accident.
struct PageLayoutTests {
    let m = FakeMeasure()
    let s = SATPageStyle.standard

    private func q(_ id: String) throws -> SATQuestion { try #require(SATFixtures.question(id)) }

    @Test func aShortQuestionWithNoFigureKeepsTheBoardsScreen() throws {
        let l = SATPageLayout.make(try q("algebra-linear-one-var-9001"), measure: m)
        #expect(l.pageHeight == 900)
        #expect(l.figurePlace == .none)
        #expect(l.stem == SATRect(88, 60, 1424, 42))
        #expect(l.workTop == 134)
        // short choices: all four in a row at the bottom
        #expect(l.arrangement == .row)
        #expect(l.cards.map(\.key) == ["A", "B", "C", "D"])
        #expect(l.cards[0].frame == SATRect(88, 772, 342.5, 92))
        #expect(l.cards[3].frame.maxX == 1512)
        #expect(l.answers.maxY == 900 - s.bottom)
        #expect(l.workBottom == 744)
        #expect(l.workHeight >= s.workMin)
    }

    @Test func aPlotSitsBesideTheStemAndMapsItsGrid() throws {
        let l = SATPageLayout.make(try q("algebra-linear-two-var-9004"), measure: m)
        #expect(l.figurePlace == .beside)
        #expect(l.figure == SATRect(952, 60, 560, 468))
        // square units: the grid is 482 across for 7 units, 8 units up would be 551: kept to 400
        #expect(l.plotGrid == SATRect(996, 86, 482, 400))
        #expect(l.stem.w == 1424 - 560 - s.figureGap)
        #expect(l.stem.maxX <= l.figure!.x - s.figureGap + 0.01)
        #expect(l.workTop == 560)
        // the work area keeps its minimum: the page grows
        #expect(l.pageHeight == 1056)
        #expect(l.workHeight >= s.workMin)
        #expect(l.cards.allSatisfy { $0.frame.y >= l.workBottom + s.answerGap - 0.01 })
    }

    @Test func aTableAndAShapeAreSizedToTheirContent() throws {
        let table = SATPageLayout.make(try q("algebra-linear-functions-9002"), measure: m)
        #expect(table.figurePlace == .beside)
        #expect(table.figure == SATRect(1272, 60, 240, 236))
        let shape = SATPageLayout.make(try q("geometry_trig-right-triangles-trig-9005"), measure: m)
        #expect(shape.figurePlace == .beside)
        // the triangle's own aspect (8 wide, 6 tall) within the figure's limits, its note under it
        #expect(shape.figureArt == SATRect(992, 60, 520, 380))
        #expect(shape.note != nil)
        #expect(shape.figure!.maxY == shape.note!.maxY)
        #expect(shape.plotGrid == nil)
    }

    @Test func aStemTooWideToShareGoesAboveItsFigure() throws {
        var style = SATPageStyle.standard
        style.minStemBeside = 1000
        let l = SATPageLayout.make(try q("algebra-linear-two-var-9004"), measure: m, style: style)
        #expect(l.figurePlace == .below)
        #expect(l.stem.w == 1424)
        #expect(l.figure!.y == l.stem.maxY + style.stemFigureGap)
        #expect(l.figure!.x == style.left)
    }

    @Test func longChoicesGoTwoByTwoThenOneUnderAnother() throws {
        var question = try q("algebra-linear-one-var-9001")
        question.choices = (question.choices ?? []).map { SATChoice(key: $0.key, text: "The value of x is " + $0.text + " because it is so") }
        let grid = SATPageLayout.make(question, measure: m)
        #expect(grid.arrangement == .grid)
        #expect(grid.cards[0].frame.y == grid.cards[1].frame.y)
        #expect(grid.cards[2].frame.y > grid.cards[0].frame.y)
        question.choices = (question.choices ?? []).map { SATChoice(key: $0.key, text: String(repeating: "a long sentence that goes on ", count: 5)) }
        let column = SATPageLayout.make(question, measure: m)
        #expect(column.arrangement == .column)
        #expect(Set(column.cards.map(\.frame.x)) == [88])
        #expect(column.pageHeight > 900)
        #expect(column.workHeight >= s.workMin - 0.01)
    }

    @Test func aGridInHasItsBoxAtTheBottom() throws {
        let l = SATPageLayout.make(try q("psda-ratios-rates-9006"), measure: m)
        #expect(l.cards.isEmpty)
        #expect(l.gridIn == SATRect(88, 760, 560, 104))
        #expect(l.pageHeight == 900)
    }

    @Test func aCardsEliminatorIsItsRightEnd() throws {
        let l = SATPageLayout.make(try q("algebra-linear-one-var-9001"), measure: m)
        let b = l.cards[1]
        #expect(l.card(at: b.frame.midX - 40, b.frame.midY)! == ("B", false))
        #expect(l.card(at: b.frame.maxX - 10, b.frame.midY)! == ("B", true))
        #expect(l.card(at: 10, 10) == nil)
    }

    @Test func everyFixtureLaysOutWithItsWorkArea() throws {
        for question in SATFixtures.questions {
            let l = SATPageLayout.make(question, measure: m)
            #expect(l.workHeight >= s.workMin - 0.01, "\(question.id)")
            #expect(l.questionBottom < l.workTop, "\(question.id)")
            #expect(l.answers.maxY <= l.pageHeight - s.bottom + 0.01, "\(question.id)")
            if let f = l.figure { #expect(f.maxX <= s.right + 0.01 && f.x >= s.left - 0.01, "\(question.id)") }
            // the same question, the same page
            #expect(SATPageLayout.make(question, measure: m) == l)
        }
    }
}

/// Writing on the figure: page ↔ graph, and what a stroke is in the graph's terms.
struct FigureMarksTests {
    let map = SATPlotMap(grid: SATRect(1000, 100, 480, 400), x: .init(min: -2, max: 6, step: 1), y: .init(min: -2, max: 8, step: 1))

    @Test func pageAndGraphRoundTrip() {
        let p = map.page(2, 0)
        #expect(p.x == 1240)
        #expect(p.y == 420)
        let g = map.graph(1240, 420)
        #expect(abs(g.x - 2) < 1e-9 && abs(g.y) < 1e-9)
        #expect(map.covers(1240, 420))
        #expect(!map.covers(200, 420))
    }

    private func circle(at gx: Double, _ gy: Double, r: Double = 20) -> [(x: Double, y: Double)] {
        let c = map.page(gx, gy)
        return (0...24).map { i in
            let t = Double(i) / 24 * 2 * .pi
            return (c.x + r * cos(t), c.y + r * sin(t))
        }
    }

    @Test func aLoopIsACircleRoundItsCentre() {
        #expect(SATFigureMarks.classify(circle(at: 2, 0), on: map) == .circled(x: 2, y: 0))
        #expect(SATFigureMarks.classify(circle(at: 2, 0), on: map)?.words == "circled near (2, 0)")
    }

    @Test func aStraightStrokeIsALineThroughItsEnds() {
        let a = map.page(2, 0), b = map.page(0, 4)
        let pts = (0...10).map { i -> (x: Double, y: Double) in
            let t = Double(i) / 10
            return (a.x + (b.x - a.x) * t + (i == 5 ? 3 : 0), a.y + (b.y - a.y) * t)
        }
        #expect(SATFigureMarks.classify(pts, on: map) == .line(x0: 0, y0: 4, x1: 2, y1: 0))
        #expect(SATFigureMarks.classify(pts, on: map)?.words == "a line through about (0, 4) and (2, 0)")
    }

    @Test func aDotAndACurve() {
        let c = map.page(1.4, 3.1)
        #expect(SATFigureMarks.classify([(c.x, c.y), (c.x + 4, c.y + 3)], on: map) == .dot(x: 1.5, y: 3))
        let a = map.page(0, 0)
        let curve = (0...20).map { i -> (x: Double, y: Double) in (a.x + Double(i) * 10, a.y - 0.4 * Double(i * i)) }
        guard case .sketch? = SATFigureMarks.classify(curve, on: map) else {
            Issue.record("a bend is a curve")
            return
        }
    }

    @Test func theSummaryForTheTutor() {
        let line = [map.page(0, 4), map.page(1, 2), map.page(2, 0)].map { (x: $0.x, y: $0.y) }
        let words = SATFigureMarks.summary([circle(at: 2, 0), line], on: map)
        #expect(words == "On the question's graph the student drew: circled near (2, 0); a line through about (0, 4) and (2, 0).")
        #expect(SATFigureMarks.summary([], on: map) == nil)
    }

    @Test func theFixturePlotsMap() throws {
        let q = try #require(SATFixtures.question("algebra-linear-two-var-9004"))
        guard case .plot(let plot)? = q.figure else { return }
        let l = SATPageLayout.make(q, measure: FakeMeasure())
        let m = try #require(SATPlotMap(layout: l, plot: plot))
        // the labelled point (2, 0) sits on the x axis, inside the grid
        let p = m.page(2, 0)
        #expect(l.plotGrid!.contains(p.x, p.y))
        #expect(abs(p.y - (l.plotGrid!.maxY - 2.0 / 8 * l.plotGrid!.h)) < 1e-9)
    }
}

/// Help me's ladder, and its fallback when the live tutor can't write the step.
struct HintLadderTests {
    @Test func theRungsClimbOneATap() {
        var l = SATHintLadder()
        #expect(l.next(hasNudge: true) == .nudge)
        l.reach(.nudge)
        #expect(l.next(hasNudge: true) == .step)
        l.reach(.step)
        #expect(l.next(hasNudge: true) == .walkthrough)
        l.reach(.nudge)
        #expect(l.reached == .step, "never down")
        // no nudge in the bank: the first tap is the step
        #expect(SATHintLadder().next(hasNudge: false) == .step)
    }

    @Test func theBanksNextStepFollowsTheLastMatchingLine() throws {
        let steps = try #require(SATFixtures.question("algebra-linear-one-var-9001")).solution.steps
        // nothing read (capped, offline): the first step
        #expect(SATHintLadder.nextBankStep(steps, studentLines: [], written: []) == 0)
        // the student wrote the first step's right side: the second
        #expect(SATHintLadder.nextBankStep(steps, studentLines: ["4x-5=2x+9"], written: []) == 1)
        // and the second, spaced their way: the third
        #expect(SATHintLadder.nextBankStep(steps, studentLines: ["4x - 5 = 2x + 9", "2x = 14"], written: []) == 2)
        // a step the tutor already wrote is not written twice
        #expect(SATHintLadder.nextBankStep(steps, studentLines: [], written: [0]) == 1)
        // everything done: nothing left
        #expect(SATHintLadder.nextBankStep(steps, studentLines: ["x=7"], written: []) == nil)
    }

    @Test func theWalkthroughGoesStepByStep() {
        var l = SATHintLadder()
        #expect(l.nextWalkStep(count: 3) == 0)
        l.walked = 2
        #expect(l.nextWalkStep(count: 3) == 2)
        l.walked = 3
        #expect(l.nextWalkStep(count: 3) == nil)
    }
}
