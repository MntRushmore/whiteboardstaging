#if os(iOS)
import AgathonDesign
import SwiftUI
import UIKit

/// A geometry figure (`shape`), in its own units with y up, fitted to the panel with room for its
/// labels: polygons, circles, segments (dashed when asked), points, labels, the right-angle square
/// and an angle's arc (swept counter-clockwise from `from` to `to`, its label beyond the arc).
struct SATShapeView: View {
    let shape: SATShape

    var body: some View {
        GeometryReader { geo in
            Canvas { ctx, size in draw(&ctx, size) }
                .frame(width: geo.size.width, height: geo.size.height)
        }
        .frame(height: height)
        .frame(maxWidth: 520)
        .accessibilityElement()
        .accessibilityLabel(spoken)
    }

    /// The figure's own aspect, kept to a sensible height for the panel.
    private var height: CGFloat {
        guard let b = shape.bounds, b.maxX > b.minX else { return 220 }
        let aspect = CGFloat((b.maxY - b.minY) / (b.maxX - b.minX))
        return min(300, max(170, 400 * aspect + 2 * Self.margin))
    }

    static let margin: CGFloat = 30
    static let labelSize: CGFloat = 16

    /// Units to points: the figure's box fitted into `size`, centred, y flipped.
    struct Map {
        let scale: CGFloat
        let ox: CGFloat
        let oy: CGFloat

        func p(_ q: SATPoint) -> CGPoint { CGPoint(x: ox + CGFloat(q.x) * scale, y: oy - CGFloat(q.y) * scale) }
    }

    func map(_ size: CGSize) -> Map? {
        guard let b = shape.bounds else { return nil }
        let w = max(b.maxX - b.minX, 1e-6), h = max(b.maxY - b.minY, 1e-6)
        let m = Self.margin
        let scale = min((size.width - 2 * m) / CGFloat(w), (size.height - 2 * m) / CGFloat(h))
        let ox = (size.width - CGFloat(w) * scale) / 2 - CGFloat(b.minX) * scale
        let oy = (size.height + CGFloat(h) * scale) / 2 + CGFloat(b.minY) * scale
        return Map(scale: scale, ox: ox, oy: oy)
    }

    private func draw(_ ctx: inout GraphicsContext, _ size: CGSize) {
        guard let m = map(size) else { return }
        let ink = DS.Color.ink
        let line = StrokeStyle(lineWidth: 2.4, lineCap: .round, lineJoin: .round)
        let dashed = StrokeStyle(lineWidth: 2, lineCap: .round, dash: [7, 6])
        for item in shape.items {
            switch item {
            case .polygon(let points, let d):
                guard let first = points.first else { continue }
                var path = Path()
                path.move(to: m.p(first))
                for q in points.dropFirst() { path.addLine(to: m.p(q)) }
                path.closeSubpath()
                ctx.stroke(path, with: .color(ink), style: d ? dashed : line)
            case .circle(let c, let r, let d):
                let center = m.p(c), radius = CGFloat(r) * m.scale
                ctx.stroke(Path(ellipseIn: CGRect(x: center.x - radius, y: center.y - radius, width: 2 * radius, height: 2 * radius)),
                           with: .color(ink), style: d ? dashed : line)
            case .segment(let a, let b, let d):
                var path = Path()
                path.move(to: m.p(a))
                path.addLine(to: m.p(b))
                ctx.stroke(path, with: .color(ink), style: d ? dashed : line)
            case .point(let at, let label):
                let c = m.p(at)
                ctx.fill(Path(ellipseIn: CGRect(x: c.x - 4, y: c.y - 4, width: 8, height: 8)), with: .color(ink))
                if let label, !label.isEmpty {
                    SATFigureLabel.resolve(label, size: Self.labelSize, color: ink, in: ctx).draw(&ctx, CGPoint(x: c.x + 7, y: c.y - 5), .bottomLeading)
                }
            case .label(let at, let text):
                SATFigureLabel.resolve(text, size: Self.labelSize, color: ink, in: ctx).draw(&ctx, m.p(at), .center)
            case .rightAngle(let at, let dirs):
                guard dirs.count == 2 else { continue }
                let s: CGFloat = 13
                func unit(_ d: SATPoint) -> CGVector {
                    let l = max(1e-9, (d.x * d.x + d.y * d.y).squareRoot())
                    return CGVector(dx: CGFloat(d.x / l), dy: -CGFloat(d.y / l))
                }
                let c = m.p(at), u = unit(dirs[0]), v = unit(dirs[1])
                var path = Path()
                path.move(to: CGPoint(x: c.x + u.dx * s, y: c.y + u.dy * s))
                path.addLine(to: CGPoint(x: c.x + (u.dx + v.dx) * s, y: c.y + (u.dy + v.dy) * s))
                path.addLine(to: CGPoint(x: c.x + v.dx * s, y: c.y + v.dy * s))
                ctx.stroke(path, with: .color(ink), lineWidth: 1.6)
            case .arcAngle(let at, let from, let to, let label):
                let c = m.p(at)
                var sweep = (to - from).truncatingRemainder(dividingBy: 360)
                if sweep < 0 { sweep += 360 }
                let r: CGFloat = 24
                var path = Path()
                // y is flipped on screen: counter-clockwise in the figure is clockwise here
                path.addArc(center: c, radius: r, startAngle: .degrees(-from), endAngle: .degrees(-(from + sweep)), clockwise: true)
                ctx.stroke(path, with: .color(ink), lineWidth: 1.6)
                if let label, !label.isEmpty {
                    let mid = (from + sweep / 2) * .pi / 180
                    let lr = r + 20
                    let p = CGPoint(x: c.x + CGFloat(cos(mid)) * lr, y: c.y - CGFloat(sin(mid)) * lr)
                    SATFigureLabel.resolve(label, size: Self.labelSize - 1, color: ink, in: ctx).draw(&ctx, p, .center)
                }
            case .unknown:
                continue
            }
        }
    }

    private var spoken: String {
        var parts = ["A figure."]
        for item in shape.items {
            switch item {
            case .polygon(let points, _): parts.append("A shape with \(points.count) sides.")
            case .circle: parts.append("A circle.")
            case .label(_, let text): parts.append("Labelled \(SATRichText.plain(text)).")
            case .point(_, let label?): parts.append("Point \(SATRichText.plain(label)).")
            case .rightAngle: parts.append("A right angle.")
            case .arcAngle(_, _, _, let label?): parts.append("An angle of \(SATRichText.plain(label)).")
            default: break
            }
        }
        return parts.joined(separator: " ")
    }
}
#endif
