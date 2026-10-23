#if os(iOS)
import AgathonDesign
import SwiftUI
import UIKit

/// A coordinate plane (`plot`): grid lines at each tick, the axes through 0 (else at the edge), tick
/// numbers, the axis names, and the items: functions sampled finely and clipped to the window,
/// segments, points (filled, or open), bars. A bar chart labels its bars under the axis instead of
/// numbering x.
struct SATPlotView: View {
    let plot: SATPlot

    @Environment(\.dynamicTypeSize) private var typeSize

    /// The plane keeps its units square when it can, within these heights.
    static let minHeight: CGFloat = 200
    static let maxHeight: CGFloat = 340

    var body: some View {
        GeometryReader { geo in
            Canvas { ctx, size in draw(&ctx, size) }
                .frame(width: geo.size.width, height: geo.size.height)
        }
        .frame(height: height)
        .frame(maxWidth: 560)
        .accessibilityElement()
        .accessibilityLabel(spoken)
    }

    private var height: CGFloat {
        let xr = plot.x.max - plot.x.min, yr = plot.y.max - plot.y.min
        guard xr > 0, yr > 0 else { return 260 }
        // a 480-wide plane with square units, kept to a sensible height
        let h = (480 - 2 * Self.pad.side) * CGFloat(yr / xr) + Self.pad.top + Self.pad.bottom
        return min(Self.maxHeight, max(Self.minHeight, plot.isBarChart ? 260 : h))
    }

    static let pad = (side: CGFloat(40), top: CGFloat(18), bottom: CGFloat(44))
    static let font: CGFloat = 13

    /// The plane's rect and the map from units to points.
    struct Frame {
        let rect: CGRect
        let plot: SATPlot

        func p(_ x: Double, _ y: Double) -> CGPoint {
            let fx = (x - plot.x.min) / (plot.x.max - plot.x.min)
            let fy = (y - plot.y.min) / (plot.y.max - plot.y.min)
            return CGPoint(x: rect.minX + CGFloat(fx) * rect.width, y: rect.maxY - CGFloat(fy) * rect.height)
        }

        var axisY: Double { (plot.y.min...plot.y.max).contains(0) ? 0 : plot.y.min }
        var axisX: Double { (plot.x.min...plot.x.max).contains(0) ? 0 : plot.x.min }
    }

    private func draw(_ ctx: inout GraphicsContext, _ size: CGSize) {
        let rect = CGRect(x: Self.pad.side, y: Self.pad.top, width: max(10, size.width - 2 * Self.pad.side),
                          height: max(10, size.height - Self.pad.top - Self.pad.bottom))
        let f = Frame(rect: rect, plot: plot)
        let ink = DS.Color.ink, quiet = DS.Color.inkSecondary
        let gridColor = DS.Color.line

        // the grid
        if plot.grid {
            var grid = Path()
            for t in plot.x.ticks where !plot.isBarChart {
                grid.move(to: f.p(t, plot.y.min))
                grid.addLine(to: f.p(t, plot.y.max))
            }
            for t in plot.y.ticks {
                grid.move(to: f.p(plot.x.min, t))
                grid.addLine(to: f.p(plot.x.max, t))
            }
            ctx.stroke(grid, with: .color(gridColor), lineWidth: 1)
        }

        // the axes
        var axes = Path()
        axes.move(to: f.p(plot.x.min, f.axisY))
        axes.addLine(to: f.p(plot.x.max, f.axisY))
        axes.move(to: f.p(f.axisX, plot.y.min))
        axes.addLine(to: f.p(f.axisX, plot.y.max))
        ctx.stroke(axes, with: .color(ink), style: StrokeStyle(lineWidth: 1.6, lineCap: .round))

        // tick numbers: every tick, or every other one when they would crowd
        let labelFont = Font.custom(DSFonts.uiPostScriptName(weight: 400), fixedSize: Self.font)
        func every(_ ticks: [Double], span: CGFloat) -> Int { ticks.count > 1 && span / CGFloat(ticks.count - 1) < 26 ? 2 : 1 }
        if !plot.isBarChart {
            let xs = plot.x.ticks
            let kx = every(xs, span: rect.width)
            for (i, t) in xs.enumerated() where i % kx == 0 && !(t == f.axisX && f.axisX == 0 && f.axisY == 0) {
                let at = f.p(t, f.axisY)
                ctx.draw(Text(satTick(t)).font(labelFont).foregroundColor(quiet), at: CGPoint(x: at.x, y: at.y + 5), anchor: .top)
            }
        }
        let ys = plot.y.ticks
        let ky = every(ys, span: rect.height)
        for (i, t) in ys.enumerated() where i % ky == 0 && !(t == f.axisY && f.axisX == 0 && f.axisY == 0 && !plot.isBarChart) {
            let at = f.p(f.axisX, t)
            ctx.draw(Text(satTick(t)).font(labelFont).foregroundColor(quiet), at: CGPoint(x: at.x - 6, y: at.y), anchor: .trailing)
        }
        // the origin once, tucked into its corner
        if f.axisX == 0 && f.axisY == 0 && !plot.isBarChart {
            let o = f.p(0, 0)
            ctx.draw(Text("0").font(labelFont).foregroundColor(quiet), at: CGPoint(x: o.x - 5, y: o.y + 4), anchor: .topTrailing)
        }

        // axis names: x at the right end under the axis, y at the top beside it
        let nameFont = Font.custom(DSFonts.uiPostScriptName(weight: 600), fixedSize: Self.font + 1)
        if let name = plot.x.label, !name.isEmpty {
            if plot.isBarChart {
                ctx.draw(Text(name).font(nameFont).foregroundColor(ink), at: CGPoint(x: rect.midX, y: rect.maxY + 26), anchor: .top)
            } else {
                let end = f.p(plot.x.max, f.axisY)
                drawName(name, at: CGPoint(x: end.x + 8, y: end.y), anchor: .leading, in: &ctx)
            }
        }
        if let name = plot.y.label, !name.isEmpty {
            let end = f.p(f.axisX, plot.y.max)
            drawName(name, at: CGPoint(x: end.x + 6, y: end.y - 2), anchor: .bottomLeading, in: &ctx)
        }

        // the items, clipped to the plane
        var inner = ctx
        inner.clip(to: Path(rect.insetBy(dx: -1, dy: -1)))
        for item in plot.items { drawItem(item, f, &inner, &ctx) }
    }

    private func drawName(_ name: String, at p: CGPoint, anchor: UnitPoint, in ctx: inout GraphicsContext) {
        let label = SATFigureLabel.resolve(name.contains("$") ? name : (name.count == 1 ? "$\(name)$" : name), size: Self.font + 2,
                                           color: DS.Color.ink, in: ctx)
        label.draw(&ctx, p, anchor)
    }

    private func drawItem(_ item: SATPlot.Item, _ f: Frame, _ inner: inout GraphicsContext, _ outer: inout GraphicsContext) {
        let ink = DS.Color.ink
        let dash: [CGFloat] = [7, 6]
        switch item {
        case .function(let expr, let label, let dashed, let domain):
            guard let fx = SATExpression(expr) else { return }
            let lo = max(plot.x.min, domain?.first ?? plot.x.min), hi = min(plot.x.max, domain?.last ?? plot.x.max)
            guard hi > lo else { return }
            var path = Path()
            var pen = false
            let n = 480
            let yPad = (plot.y.max - plot.y.min) * 2
            var lastIn: CGPoint?
            for i in 0...n {
                let x = lo + (hi - lo) * Double(i) / Double(n)
                let y = fx(x)
                guard y.isFinite, y > plot.y.min - yPad, y < plot.y.max + yPad else {
                    pen = false
                    continue
                }
                let p = f.p(x, y)
                if pen { path.addLine(to: p) } else { path.move(to: p) }
                pen = true
                if (plot.y.min...plot.y.max).contains(y) { lastIn = p }
            }
            inner.stroke(path, with: .color(ink), style: StrokeStyle(lineWidth: 2.6, lineCap: .round, lineJoin: .round, dash: dashed ? dash : []))
            if let label, !label.isEmpty, let at = lastIn {
                SATFigureLabel.resolve(label, size: Self.font + 1, color: ink, in: outer).draw(&outer, CGPoint(x: at.x - 6, y: at.y - 6), .bottomTrailing)
            }
        case .segment(let a, let b, let label, let dashed):
            var path = Path()
            path.move(to: f.p(a.x, a.y))
            path.addLine(to: f.p(b.x, b.y))
            inner.stroke(path, with: .color(ink), style: StrokeStyle(lineWidth: 2.6, lineCap: .round, dash: dashed ? dash : []))
            if let label, !label.isEmpty {
                let m = f.p((a.x + b.x) / 2, (a.y + b.y) / 2)
                SATFigureLabel.resolve(label, size: Self.font + 1, color: ink, in: outer).draw(&outer, CGPoint(x: m.x + 6, y: m.y - 6), .bottomLeading)
            }
        case .point(let at, let label, let open):
            let c = f.p(at.x, at.y)
            let dot = Path(ellipseIn: CGRect(x: c.x - 5, y: c.y - 5, width: 10, height: 10))
            if open {
                outer.fill(dot, with: .color(DS.Color.surface))
                outer.stroke(dot, with: .color(ink), lineWidth: 2)
            } else {
                outer.fill(dot, with: .color(ink))
            }
            if let label, !label.isEmpty {
                // above and to the right, unless that runs off the plane
                let right = c.x < f.rect.maxX - 70
                SATFigureLabel.resolve(label, size: Self.font + 1, color: ink, in: outer)
                    .draw(&outer, CGPoint(x: c.x + (right ? 9 : -9), y: c.y - 7), right ? .bottomLeading : .bottomTrailing)
            }
        case .bar(let x, let height, let label, let width):
            let w = width ?? min(0.6, plot.x.step * 0.6)
            let tl = f.p(x - w / 2, max(height, f.axisY)), br = f.p(x + w / 2, min(height, f.axisY))
            let bar = Path(CGRect(x: tl.x, y: tl.y, width: br.x - tl.x, height: br.y - tl.y))
            inner.fill(bar, with: .color(DS.Color.inkSecondary))
            if let label, !label.isEmpty {
                let at = f.p(x, f.axisY)
                outer.draw(Text(label).font(.custom(DSFonts.uiPostScriptName(weight: 500), fixedSize: Self.font)).foregroundColor(ink),
                           at: CGPoint(x: at.x, y: at.y + 5), anchor: .top)
            }
        case .unknown:
            break
        }
    }

    private var spoken: String {
        var parts = ["A graph in the x y plane, x from \(satTick(plot.x.min)) to \(satTick(plot.x.max)), y from \(satTick(plot.y.min)) to \(satTick(plot.y.max))."]
        for item in plot.items {
            switch item {
            case .function(let expr, _, _, _): parts.append("The graph of y = \(expr.replacingOccurrences(of: "**", with: "^")).")
            case .segment(let a, let b, _, _): parts.append("A segment from \(satTick(a.x)), \(satTick(a.y)) to \(satTick(b.x)), \(satTick(b.y)).")
            case .point(let at, let label, _): parts.append("A point at \(label.map(SATRichText.plain) ?? "\(satTick(at.x)), \(satTick(at.y))").")
            case .bar(_, let h, let label, _): parts.append("\(label ?? "A bar"): \(satTick(h)).")
            case .unknown: break
            }
        }
        return parts.joined(separator: " ")
    }
}
#endif
