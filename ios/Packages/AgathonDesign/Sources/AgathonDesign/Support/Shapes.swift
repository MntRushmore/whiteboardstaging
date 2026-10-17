import SwiftUI

// Shapes drawn from the brand page's own SVG paths, scaled from their boxes into any rect.

private func map(_ x: CGFloat, _ y: CGFloat, box: CGSize, in rect: CGRect) -> CGPoint {
    let s = min(rect.width / box.width, rect.height / box.height)
    let ox = rect.minX + (rect.width - box.width * s) / 2
    let oy = rect.minY + (rect.height - box.height * s) / 2
    return CGPoint(x: ox + x * s, y: oy + y * s)
}

/// The five-point star (24-unit box). Fill it and stroke it with a round join, as the page does, for
/// soft points: `RoundedStar` does both.
public struct StarShape: Shape {
    public init() {}
    static let points: [(CGFloat, CGFloat)] = [
        (12, 3.4), (14.6, 8.8), (20.5, 9.6), (16.2, 13.7), (17.2, 19.6),
        (12, 16.8), (6.8, 19.6), (7.8, 13.7), (3.5, 9.6), (9.4, 8.8),
    ]
    public func path(in rect: CGRect) -> Path {
        var p = Path()
        let box = CGSize(width: 24, height: 24)
        for (i, pt) in Self.points.enumerated() {
            let q = map(pt.0, pt.1, box: box, in: rect)
            if i == 0 { p.move(to: q) } else { p.addLine(to: q) }
        }
        p.closeSubpath()
        return p
    }
}

/// A star with rounded points, one flat colour.
public struct RoundedStar: View {
    let color: SwiftUI.Color
    public init(_ color: SwiftUI.Color = DS.Color.star) { self.color = color }
    public var body: some View {
        GeometryReader { geo in
            let w = min(geo.size.width, geo.size.height) * 2 / 24
            ZStack {
                StarShape().fill(color)
                StarShape().stroke(color, style: StrokeStyle(lineWidth: w, lineJoin: .round))
            }
        }
        .aspectRatio(1, contentMode: .fit)
    }
}

/// The streak flame (24-unit box).
public struct FlameShape: Shape {
    public init() {}
    public func path(in rect: CGRect) -> Path {
        let b = CGSize(width: 24, height: 24)
        func m(_ x: CGFloat, _ y: CGFloat) -> CGPoint { map(x, y, box: b, in: rect) }
        var p = Path()
        p.move(to: m(12, 21))
        p.addCurve(to: m(5.5, 14.8), control1: m(8.2, 21), control2: m(5.5, 18.3))
        p.addCurve(to: m(9.2, 6.2), control1: m(5.5, 11.2), control2: m(8.1, 9.2))
        p.addCurve(to: m(11.7, 9.8), control1: m(9.7, 8.0), control2: m(10.6, 9.2))
        p.addCurve(to: m(15.4, 3.0), control1: m(12.0, 7.0), control2: m(13.4, 4.6))
        p.addCurve(to: m(17.6, 9.4), control1: m(15.1, 6.1), control2: m(16.4, 7.7))
        p.addCurve(to: m(19.0, 13.7), control1: m(18.6, 10.8), control2: m(19.0, 12.1))
        p.addCurve(to: m(12, 21), control1: m(19.0, 18.1), control2: m(15.9, 21.0))
        p.closeSubpath()
        return p
    }
}

/// The tutor's tick: one stroke, drawn left to right (`trim` it to draw it). From the page's motion
/// demo, in an 82 × 78 box.
public struct TickShape: Shape {
    public init() {}
    public func path(in rect: CGRect) -> Path {
        let b = CGSize(width: 82, height: 78)
        func m(_ x: CGFloat, _ y: CGFloat) -> CGPoint { map(x, y, box: b, in: rect) }
        var p = Path()
        p.move(to: m(0, 44))
        p.addCurve(to: m(24, 78), control1: m(10, 54), control2: m(18, 66))
        p.addCurve(to: m(82, 0), control1: m(38, 48), control2: m(56, 22))
        return p
    }
}

/// A check mark (24-unit box), for strokes.
public struct CheckShape: Shape {
    public init() {}
    public func path(in rect: CGRect) -> Path {
        let b = CGSize(width: 24, height: 24)
        var p = Path()
        p.move(to: map(5, 12.5, box: b, in: rect))
        p.addLine(to: map(9.5, 17, box: b, in: rect))
        p.addLine(to: map(19, 7.5, box: b, in: rect))
        return p
    }
}
