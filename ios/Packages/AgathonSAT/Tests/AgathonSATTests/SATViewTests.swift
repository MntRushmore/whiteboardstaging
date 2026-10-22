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
}
#endif
