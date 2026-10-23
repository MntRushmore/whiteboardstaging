#if os(iOS)
import SwiftUI
import Testing
@testable import AgathonSAT

/// The screens' words and geometry (docs/SAT-MODE.md): the cap line by tier, the figures' fit.
@MainActor
struct SATViewTests {
    @Test func theCapLineSaysTheServersCapAndTheTiersWay() {
        // the owner (2026-10-22): no account 5 ("make a free account for 20"), a free account 20 ("Unlimited")
        #expect(SATCopy.capped(cap: 5, hasAccount: false) == "Free tutor used up for today: 5 of 5. Make a free account for 20 a day.")
        #expect(SATCopy.capped(cap: 20, hasAccount: true) == "Free tutor used up for today: 20 of 20. Unlimited lifts it.")
        #expect(SATCopy.cappedAction(hasAccount: false) == "Make a free account")
        #expect(SATCopy.tutorReady(left: 3, cap: 20).contains("3 of 20"))
        #expect(!SATCopy.capped(cap: 20, hasAccount: true).contains("!"))
    }

    @Test func aShapeFitsItsBoxWithYUp() throws {
        let shape = SATShape(items: [.polygon(points: [SATPoint(0, 0), SATPoint(8, 0), SATPoint(0, 6)], dashed: false)])
        let m = try #require(SATShapeView(shape: shape).map(CGSize(width: 460, height: 380)))
        let a = m.p(SATPoint(0, 0)), b = m.p(SATPoint(8, 0)), c = m.p(SATPoint(0, 6))
        #expect(a.y > c.y, "y is up")
        #expect(b.x > a.x)
        for p in [a, b, c] { #expect(p.x >= SATShapeView.margin - 0.5 && p.x <= 460 - SATShapeView.margin + 0.5) }
        // square units: 8 across and 6 up keep their ratio
        #expect(abs((b.x - a.x) / (a.y - c.y) - 8.0 / 6.0) < 0.01)
    }

    @Test func aPlotMapsItsWindow() {
        let plot = SATPlot(x: .init(min: -2, max: 5, step: 1), y: .init(min: -2, max: 6, step: 1), items: [])
        let f = SATPlotView.Frame(rect: CGRect(x: 40, y: 20, width: 350, height: 400), plot: plot)
        #expect(f.p(-2, -2) == CGPoint(x: 40, y: 420))
        #expect(f.p(5, 6) == CGPoint(x: 390, y: 20))
        #expect(f.axisX == 0 && f.axisY == 0)
        #expect(satTick(-3) == "−3" && satTick(2.5) == "2.5")
    }

    /// A point's label never lands on a tick number, an axis or the line: the next free spot round the
    /// point is taken (the label-vs-tick rule, docs/sat2/DESIGN-NOTES.md "Point labels avoid the line").
    @Test func aPointLabelTakesTheFirstFreeSpot() {
        let printer = SATFigurePrinter(style: .standard, text: SATPrintText())
        let c = CGPoint(x: 500, y: 500)
        let spots = SATFigurePrinter.spots(round: c, first: 0)
        #expect(spots.count == 8)
        #expect(spots[0].anchor == CGPoint(x: 1, y: 1), "above left first")
        // a tick number sits where above-left would be: the label goes above right
        var avoid = [CGRect(x: 380, y: 440, width: 110, height: 50)]
        let items = printer.placed("(0, −2)", size: 18, weight: .semibold, spots: spots, avoid: &avoid, line: [], within: CGRect(x: 0, y: 0, width: 1000, height: 1000))
        #expect(!items.isEmpty)
        #expect(avoid.count == 2)
        #expect(avoid[1].minX >= c.x, "it moved to the right of the point")
        #expect(!avoid[1].intersects(avoid[0]))
        // the line through above right too: below right
        var avoid2 = [CGRect(x: 380, y: 440, width: 110, height: 50)]
        let line = (0...40).map { CGPoint(x: 500 + Double($0) * 3, y: 500 - Double($0) * 1.2) }
        _ = printer.placed("(0, −2)", size: 18, weight: .semibold, spots: spots, avoid: &avoid2, line: line, within: CGRect(x: 0, y: 0, width: 1000, height: 1000))
        #expect(avoid2[1].minY >= c.y, "below the point")
        #expect(!line.contains { avoid2[1].contains($0) })
    }
}
#endif
