#if os(iOS)
import AgathonBoard
import CoreGraphics
import CoreText
import Foundation

/// A question's figure printed on its page (v1's Canvas renderers, SATPlotView / SATShapeView /
/// SATTableView, as page paths): a table, a coordinate plane, or a geometry figure. Ink lines, chalk
/// wells, labels in Lexend and maths in Latin Modern; never cobalt (the tutor's).
struct SATFigurePrinter {
    let style: SATPageStyle
    let text: SATPrintText

    static let tickSize = 20.0
    static let labelSize = 22.0
    static let line: CGFloat = 3.2
    static let axis: CGFloat = 2.4
    static let gridLine: CGFloat = 1.5
    static let dash: [CGFloat] = [10, 8]

    func items(_ figure: SATFigure, in rect: CGRect, plotGrid: CGRect?) -> [PagePrint.Item] {
        switch figure {
        case .table(let t): return table(t, in: rect)
        case .plot(let p): return plot(p, grid: plotGrid ?? rect)
        case .shape(let s): return shape(s, in: rect)
        }
    }

    // MARK: - a label: maths as maths, else words

    func label(_ source: String, size: Double, at p: CGPoint, anchor: CGPoint, color: CGColor = SATPrintStyle.ink) -> [PagePrint.Item] {
        let laid = text.lay(source, size: size, maxWidth: .infinity, color: color)
        let origin = CGPoint(x: p.x - anchor.x * laid.size.w, y: p.y - anchor.y * laid.size.h)
        return laid.items(at: origin)
    }

    // MARK: - table

    func table(_ t: SATTable, in rect: CGRect) -> [PagePrint.Item] {
        let S = SATPrintStyle.self
        let columns = max(t.headers.count, t.rows.map(\.count).max() ?? 0)
        guard columns > 0 else { return [] }
        let all = [t.headers] + t.rows
        // the rows' heights as the layout measured them
        let heights = all.enumerated().map { r, row -> Double in
            var h = style.tableMinRow
            for c in 0..<columns {
                let s = c < row.count ? row[c] : ""
                h = max(h, text.measure(s.isEmpty ? " " : s, size: style.tableSize, weight: r == 0 ? .semibold : .regular, maxWidth: .infinity).h + 2 * style.tableCellPadY)
            }
            return h
        }
        let colW = rect.width / CGFloat(columns)
        var items: [PagePrint.Item] = []
        let outline = CGPath(roundedRect: rect, cornerWidth: 18, cornerHeight: 18, transform: nil)
        items.append(.fill(outline, S.paper))
        // the header row in chalk, clipped to the rounded box
        items.append(.clip(rect, [.fill(CGPath(rect: CGRect(x: rect.minX, y: rect.minY, width: rect.width, height: heights[0]), transform: nil), S.well)]))
        var y = Double(rect.minY)
        let rules = CGMutablePath()
        for (r, row) in all.enumerated() {
            if r > 0 {
                rules.move(to: CGPoint(x: rect.minX, y: y))
                rules.addLine(to: CGPoint(x: rect.maxX, y: y))
            }
            for c in 0..<columns {
                let s = c < row.count ? row[c] : ""
                guard !s.isEmpty else { continue }
                let cell = CGRect(x: rect.minX + CGFloat(c) * colW, y: y, width: colW, height: heights[r])
                let laid = text.lay(SATPrintText.numeral(s), size: style.tableSize, weight: r == 0 ? .semibold : .regular, maxWidth: .infinity,
                                    color: S.ink)
                items += laid.items(at: CGPoint(x: cell.midX - laid.size.w / 2, y: cell.midY - laid.size.h / 2))
            }
            y += heights[r]
        }
        for c in 1..<columns {
            let x = rect.minX + CGFloat(c) * colW
            rules.move(to: CGPoint(x: x, y: rect.minY))
            rules.addLine(to: CGPoint(x: x, y: rect.maxY))
        }
        items.append(.stroke(rules, S.grid, width: 2, dash: []))
        items.append(.stroke(outline, S.grid, width: 2, dash: []))
        return items
    }

    // MARK: - plot

    func plot(_ plot: SATPlot, grid rect: CGRect) -> [PagePrint.Item] {
        let S = SATPrintStyle.self
        let map = SATPlotMap(grid: SATRect(rect.minX, rect.minY, rect.width, rect.height), x: plot.x, y: plot.y)
        func p(_ x: Double, _ y: Double) -> CGPoint {
            let v = map.page(x, y)
            return CGPoint(x: v.x, y: v.y)
        }
        let axisY = (plot.y.min...plot.y.max).contains(0) ? 0 : plot.y.min
        let axisX = (plot.x.min...plot.x.max).contains(0) ? 0 : plot.x.min
        var items: [PagePrint.Item] = []
        if plot.grid {
            let g = CGMutablePath()
            for t in plot.x.ticks where !plot.isBarChart {
                g.move(to: p(t, plot.y.min))
                g.addLine(to: p(t, plot.y.max))
            }
            for t in plot.y.ticks {
                g.move(to: p(plot.x.min, t))
                g.addLine(to: p(plot.x.max, t))
            }
            items.append(.stroke(g, S.grid, width: Self.gridLine, dash: []))
        }
        let axes = CGMutablePath()
        axes.move(to: p(plot.x.min, axisY))
        axes.addLine(to: p(plot.x.max, axisY))
        axes.move(to: p(axisX, plot.y.min))
        axes.addLine(to: p(axisX, plot.y.max))
        items.append(.stroke(axes, S.ink, width: Self.axis, dash: []))

        // tick numbers: every tick, or every other one when they would crowd
        func every(_ ticks: [Double], span: CGFloat) -> Int { ticks.count > 1 && span / CGFloat(ticks.count - 1) < 40 ? 2 : 1 }
        let origin = axisX == 0 && axisY == 0 && !plot.isBarChart
        if !plot.isBarChart {
            let xs = plot.x.ticks
            let kx = every(xs, span: rect.width)
            for (i, t) in xs.enumerated() where i % kx == 0 && !(t == 0 && origin) {
                let at = p(t, axisY)
                items += label(Self.tick(t), size: Self.tickSize, at: CGPoint(x: at.x, y: at.y + 6), anchor: CGPoint(x: 0.5, y: 0), color: S.inkSecondary)
            }
        }
        let ys = plot.y.ticks
        let ky = every(ys, span: rect.height)
        for (i, t) in ys.enumerated() where i % ky == 0 && !(t == 0 && origin) {
            let at = p(axisX, t)
            items += label(Self.tick(t), size: Self.tickSize, at: CGPoint(x: at.x - 8, y: at.y), anchor: CGPoint(x: 1, y: 0.5), color: S.inkSecondary)
        }
        if origin {
            let o = p(0, 0)
            items += label("0", size: Self.tickSize, at: CGPoint(x: o.x - 6, y: o.y + 5), anchor: CGPoint(x: 1, y: 0), color: S.inkSecondary)
        }
        // axis names: x at the right end beside the axis, y at the top beside it
        if let name = plot.x.label, !name.isEmpty {
            if plot.isBarChart {
                items += label(name, size: Self.labelSize, at: CGPoint(x: rect.midX, y: rect.maxY + 30), anchor: CGPoint(x: 0.5, y: 0))
            } else {
                let end = p(plot.x.max, axisY)
                items += label(Self.name(name), size: Self.labelSize, at: CGPoint(x: end.x + 10, y: end.y), anchor: CGPoint(x: 0, y: 0.5))
            }
        }
        if let name = plot.y.label, !name.isEmpty {
            let end = p(axisX, plot.y.max)
            items += label(Self.name(name), size: Self.labelSize, at: CGPoint(x: end.x + 8, y: end.y - 4), anchor: CGPoint(x: 0, y: 1))
        }
        // the items, the lines clipped to the plane
        var inside: [PagePrint.Item] = []
        var over: [PagePrint.Item] = []
        for item in plot.items {
            switch item {
            case .function(let expr, let lbl, let dashed, let domain):
                guard let fx = SATExpression(expr) else { continue }
                let lo = max(plot.x.min, domain?.first ?? plot.x.min), hi = min(plot.x.max, domain?.last ?? plot.x.max)
                guard hi > lo else { continue }
                let path = CGMutablePath()
                var pen = false
                let yPad = (plot.y.max - plot.y.min) * 2
                var lastIn: CGPoint?
                for i in 0...600 {
                    let x = lo + (hi - lo) * Double(i) / 600
                    let y = fx(x)
                    guard y.isFinite, y > plot.y.min - yPad, y < plot.y.max + yPad else {
                        pen = false
                        continue
                    }
                    let q = p(x, y)
                    if pen { path.addLine(to: q) } else { path.move(to: q) }
                    pen = true
                    if (plot.y.min...plot.y.max).contains(y) { lastIn = q }
                }
                inside.append(.stroke(path, S.ink, width: Self.line, dash: dashed ? Self.dash : []))
                if let lbl, !lbl.isEmpty, let at = lastIn {
                    over += label(lbl, size: Self.labelSize, at: CGPoint(x: at.x - 8, y: at.y - 8), anchor: CGPoint(x: 1, y: 1))
                }
            case .segment(let a, let b, let lbl, let dashed):
                let path = CGMutablePath()
                path.move(to: p(a.x, a.y))
                path.addLine(to: p(b.x, b.y))
                inside.append(.stroke(path, S.ink, width: Self.line, dash: dashed ? Self.dash : []))
                if let lbl, !lbl.isEmpty {
                    let m = p((a.x + b.x) / 2, (a.y + b.y) / 2)
                    over += label(lbl, size: Self.labelSize, at: CGPoint(x: m.x + 8, y: m.y - 8), anchor: CGPoint(x: 0, y: 1))
                }
            case .point(let at, let lbl, let open):
                let c = p(at.x, at.y)
                let dot = CGPath(ellipseIn: CGRect(x: c.x - 7, y: c.y - 7, width: 14, height: 14), transform: nil)
                if open {
                    over.append(.fill(dot, S.paper))
                    over.append(.stroke(dot, S.ink, width: 2.6, dash: []))
                } else {
                    over.append(.fill(dot, S.ink))
                }
                if let lbl, !lbl.isEmpty {
                    let right = c.x < rect.maxX - 100
                    over += label(lbl, size: Self.labelSize, at: CGPoint(x: c.x + (right ? 12 : -12), y: c.y - 8),
                                  anchor: CGPoint(x: right ? 0 : 1, y: 1))
                }
            case .bar(let x, let height, let lbl, let width):
                let w = width ?? min(0.6, plot.x.step * 0.6)
                let tl = p(x - w / 2, max(height, axisY)), br = p(x + w / 2, min(height, axisY))
                inside.append(.fill(CGPath(rect: CGRect(x: tl.x, y: tl.y, width: br.x - tl.x, height: br.y - tl.y), transform: nil), S.bar))
                if let lbl, !lbl.isEmpty {
                    let at = p(x, axisY)
                    over += label(lbl, size: Self.tickSize, at: CGPoint(x: at.x, y: at.y + 6), anchor: CGPoint(x: 0.5, y: 0))
                }
            case .unknown:
                continue
            }
        }
        items.append(.clip(rect.insetBy(dx: -1, dy: -1), inside))
        return items + over
    }

    /// A one-letter axis name is a variable: italic maths.
    static func name(_ s: String) -> String { s.contains("$") ? s : (s.count == 1 ? "$\(s)$" : s) }

    /// A tick value as the test writes it: whole numbers plainly, others to 2 places, a real minus.
    static func tick(_ v: Double) -> String {
        let r = (v * 100).rounded() / 100
        let s = r == r.rounded() ? String(Int(r)) : String(format: "%g", r)
        return s.replacingOccurrences(of: "-", with: "−")
    }

    // MARK: - shape

    func shape(_ shape: SATShape, in rect: CGRect) -> [PagePrint.Item] {
        let S = SATPrintStyle.self
        guard let b = shape.bounds else { return [] }
        let m = 40.0
        let w = max(b.maxX - b.minX, 1e-6), h = max(b.maxY - b.minY, 1e-6)
        let scale = min((Double(rect.width) - 2 * m) / w, (Double(rect.height) - 2 * m) / h)
        let ox = Double(rect.minX) + (Double(rect.width) - w * scale) / 2 - b.minX * scale
        let oy = Double(rect.minY) + (Double(rect.height) + h * scale) / 2 + b.minY * scale
        func p(_ q: SATPoint) -> CGPoint { CGPoint(x: ox + q.x * scale, y: oy - q.y * scale) }
        var items: [PagePrint.Item] = []
        for item in shape.items {
            switch item {
            case .polygon(let points, let d):
                guard let first = points.first else { continue }
                let path = CGMutablePath()
                path.move(to: p(first))
                for q in points.dropFirst() { path.addLine(to: p(q)) }
                path.closeSubpath()
                items.append(.stroke(path, S.ink, width: Self.line, dash: d ? Self.dash : []))
            case .circle(let c, let r, let d):
                let center = p(c), radius = CGFloat(r * scale)
                items.append(.stroke(CGPath(ellipseIn: CGRect(x: center.x - radius, y: center.y - radius, width: 2 * radius, height: 2 * radius), transform: nil),
                                     S.ink, width: Self.line, dash: d ? Self.dash : []))
            case .segment(let a, let bb, let d):
                let path = CGMutablePath()
                path.move(to: p(a))
                path.addLine(to: p(bb))
                items.append(.stroke(path, S.ink, width: d ? 2.6 : Self.line, dash: d ? Self.dash : []))
            case .point(let at, let lbl):
                let c = p(at)
                items.append(.fill(CGPath(ellipseIn: CGRect(x: c.x - 6, y: c.y - 6, width: 12, height: 12), transform: nil), S.ink))
                if let lbl, !lbl.isEmpty { items += label(lbl, size: Self.labelSize, at: CGPoint(x: c.x + 10, y: c.y - 6), anchor: CGPoint(x: 0, y: 1)) }
            case .label(let at, let t):
                items += label(t, size: Self.labelSize, at: p(at), anchor: CGPoint(x: 0.5, y: 0.5))
            case .rightAngle(let at, let dirs):
                guard dirs.count == 2 else { continue }
                let s: CGFloat = 20
                func unit(_ d: SATPoint) -> CGVector {
                    let l = max(1e-9, (d.x * d.x + d.y * d.y).squareRoot())
                    return CGVector(dx: CGFloat(d.x / l), dy: -CGFloat(d.y / l))
                }
                let c = p(at), u = unit(dirs[0]), v = unit(dirs[1])
                let path = CGMutablePath()
                path.move(to: CGPoint(x: c.x + u.dx * s, y: c.y + u.dy * s))
                path.addLine(to: CGPoint(x: c.x + (u.dx + v.dx) * s, y: c.y + (u.dy + v.dy) * s))
                path.addLine(to: CGPoint(x: c.x + v.dx * s, y: c.y + v.dy * s))
                items.append(.stroke(path, S.ink, width: 2.2, dash: []))
            case .arcAngle(let at, let from, let to, let lbl):
                let c = p(at)
                var sweep = (to - from).truncatingRemainder(dividingBy: 360)
                if sweep < 0 { sweep += 360 }
                let r: CGFloat = 36
                let path = CGMutablePath()
                // y is down on the page: counter-clockwise in the figure is clockwise here
                path.addArc(center: c, radius: r, startAngle: CGFloat(-from * .pi / 180), endAngle: CGFloat(-(from + sweep) * .pi / 180), clockwise: true)
                items.append(.stroke(path, S.ink, width: 2.2, dash: []))
                if let lbl, !lbl.isEmpty {
                    let mid = (from + sweep / 2) * .pi / 180
                    let lr = Double(r) + 28
                    items += label(lbl, size: Self.labelSize - 1, at: CGPoint(x: Double(c.x) + cos(mid) * lr, y: Double(c.y) - sin(mid) * lr),
                                   anchor: CGPoint(x: 0.5, y: 0.5))
                }
            case .unknown:
                continue
            }
        }
        return items
    }
}
#endif
