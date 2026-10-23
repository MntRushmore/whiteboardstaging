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

/// The printed page's layout (docs/SAT-V2.md; the design notes' rules): its numbers pinned, so a
/// change to them is a decision, not an accident.
struct PageLayoutTests {
    let m = FakeMeasure()
    let s = SATPageStyle.standard

    private func q(_ id: String) throws -> SATQuestion { try #require(SATFixtures.question(id)) }

    @Test func aShortQuestionFillsTheWindow() throws {
        let l = SATPageLayout.make(try q("algebra-linear-one-var-9001"), measure: m)
        // landscape: 1366 × 1024 pt is 1600 × 1199 u, a dock lane of 129 u
        #expect(SATViewport.landscape == SATViewport(height: 1199, dockLane: 129))
        #expect(l.pageHeight == 1199)
        #expect(l.number == SATRect(72, 106, 44, 44))
        #expect(l.figurePlace == .none)
        #expect(l.stem == SATRect(140, 104, 1388, 35))
        // the number hangs lower than a one-line stem: the work starts under it
        #expect(l.workTop == 198)
        #expect(l.arrangement == .row)
        #expect(l.cards.map(\.key) == ["A", "B", "C", "D"])
        #expect(l.cards[0].frame == SATRect(72, 958, 346, 112))
        #expect(l.cards[3].frame.maxX == 1528)
        #expect(l.rowTop + l.rowHeight + 129 == l.pageHeight)
        #expect(l.workBottom == 926)
        #expect(l.keepOut == [SATRect(64, 80, 1488, 94)])
    }

    @Test func aPlotSitsBesideTheStemInItsBox() throws {
        let l = SATPageLayout.make(try q("algebra-linear-two-var-9004"), measure: m)
        #expect(l.figurePlace == .beside)
        #expect(l.stem.w == 680)
        #expect(l.figure == SATRect(880, 108, 640, 470))
        #expect(l.plotGrid == SATRect(972, 120, 534, 388))
        // the L: under the stem 48 on, under the figure 24 on
        #expect(l.workTop == 222)
        #expect(l.workTopFigureSide == 602)
        #expect(l.pageHeight == 1199)
        #expect(l.keepOut[1] == SATRect(856, 84, 744, 522), "the figure's keep-out runs to the page's edge")
    }

    @Test func aTableAndAShapeAtTheirNaturalSize() throws {
        let table = SATPageLayout.make(try q("algebra-linear-functions-9002"), measure: m)
        #expect(table.figurePlace == .beside)
        #expect(table.figure == SATRect(880, 108, 176, 218))
        // a fraction among the choices: the taller row (it shows in display style)
        #expect(table.rowHeight == 132)
        let shape = SATPageLayout.make(try q("geometry_trig-right-triangles-trig-9005"), measure: m)
        #expect(shape.figurePlace == .beside)
        #expect(shape.figureArt == SATRect(880, 108, 578, 449))
        #expect(shape.note != nil)
        #expect(shape.figure!.maxY == shape.note!.maxY)
        #expect(shape.plotGrid == nil)
    }

    @Test func aLongStemTakesTheWidthAndItsFigureGoesUnder() throws {
        var question = try q("algebra-linear-two-var-9004")
        question.stem = String(repeating: "The line shown passes through the two labeled points in the plane. ", count: 9)
        let l = SATPageLayout.make(question, measure: m)
        #expect(l.figurePlace == .below)
        #expect(l.stem.w == 1388)
        #expect(l.figure!.y == l.stem.maxY + s.figureBelowGap)
        #expect(l.figure!.x == 140)
        // the page grows: a band of 200 under the whole question
        #expect(l.pageHeight > 1199)
        #expect(l.workBottom - l.questionBottom >= s.workMinBand + s.aboveRow - 0.01)
    }

    @Test func longChoicesGoTwoByTwoThenOneUnderAnother() throws {
        var question = try q("algebra-linear-one-var-9001")
        question.choices = (question.choices ?? []).map { SATChoice(key: $0.key, text: "The value is " + $0.text + " so") }
        let grid = SATPageLayout.make(question, measure: m)
        #expect(grid.arrangement == .grid)
        #expect(grid.cards[0].frame.w == 716)
        #expect(grid.cards[0].frame.y == grid.cards[1].frame.y)
        #expect(grid.cards[2].frame.y == grid.cards[0].frame.maxY + 24)
        question.choices = (question.choices ?? []).map { SATChoice(key: $0.key, text: String(repeating: "a long sentence that goes on ", count: 5)) }
        let column = SATPageLayout.make(question, measure: m)
        #expect(column.arrangement == .column)
        #expect(Set(column.cards.map(\.frame.x)) == [72])
        #expect(column.workHeight >= s.workMinUnderStem - 0.01)
    }

    @Test func aGridInHasItsFieldAndKeypadInTheRow() throws {
        let l = SATPageLayout.make(try q("psda-ratios-rates-9006"), measure: m)
        #expect(l.cards.isEmpty)
        #expect(l.rowHeight == 132)
        #expect(l.gridIn == SATRect(72, 962, 400, 84))
        #expect(l.keys.count == 14)
        // 7 × 2 keys of 96 × 60, right-aligned at 1528
        #expect(l.keys[0].frame == SATRect(796, 938, 96, 60))
        #expect(l.keys[13].frame.maxX == 1528)
        #expect(l.keys[13].key == .delete)
        #expect(l.key(at: 800, 940) == .digit(1))
        #expect(l.gridInRules!.x == 496)
        #expect(l.gridInRules!.maxX < l.keys[0].frame.x)
    }

    @Test func uprightTheSamePageIsTaller() throws {
        let question = try q("algebra-linear-two-var-9004")
        let wide = SATPageLayout.make(question, measure: m)
        let tall = SATPageLayout.make(question, measure: m, viewport: .portrait)
        #expect(SATViewport.portrait == SATViewport(height: 2134, dockLane: 172))
        // the question block never moves; the page's height and the answer row do
        #expect(tall.stem == wide.stem && tall.figure == wide.figure)
        #expect(tall.pageHeight == 2134)
        #expect(tall.rowTop == 2134 - 172 - 112)
    }

    @Test func inkLowOnThePageGrowsItRatherThanMoveTheRowOntoIt() throws {
        let question = try q("algebra-linear-one-var-9001")
        let l = SATPageLayout.make(question, measure: m, lowestInk: 1100)
        #expect(l.rowTop >= 1100 + s.aboveRow)
        #expect(l.pageHeight == 1100 + 32 + 112 + 129)
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
            for vp in [SATViewport.landscape, .portrait] {
                let l = SATPageLayout.make(question, measure: m, viewport: vp)
                #expect(l.workHeight >= s.workMinUnderStem - 0.01, "\(question.id)")
                #expect(l.workBottom - l.questionBottom >= s.workMinBand + s.aboveRow - 0.01, "\(question.id)")
                #expect(l.stem.maxY < l.workTop && l.questionBottom < l.workTopFigureSide, "\(question.id)")
                if let f = l.figure { #expect(f.maxX <= s.pageWidth && f.x >= s.left, "\(question.id)") }
                #expect(SATPageLayout.make(question, measure: m, viewport: vp) == l)
            }
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
