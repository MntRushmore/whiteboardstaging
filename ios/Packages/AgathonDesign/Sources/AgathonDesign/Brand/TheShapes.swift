import SwiftUI

/// Blocks has no mascot. The ring, the bar and the dot from the mark get eyes only for big moments:
/// a finished set, a new streak, a skill mastered, and the few times the app has to say something
/// hard (out of ink). Drawn as vector in a 220 × 130 box (the brand page's "The shapes"), from
/// 24 pt to 200 pt and beyond. They blink and bob while idle; under Reduce Motion they hold still.
public struct TheShapes: View {
    public enum Pose: String, CaseIterable, Identifiable, Sendable {
        /// Waving hello: the bar waves, the dot smiles.
        case hello
        /// Thinking: eyes up, the dot rocks, three thought dots rise.
        case thinking
        /// A big win: happy eyes, the dot hops, flat confetti made of the mark's parts.
        case celebrate
        /// Out of ink: the ring runs pale, the bar lies down, everyone rests.
        case outOfInk

        public var id: String { rawValue }

        public var accessibilityLabel: String {
            switch self {
            case .hello: "The ring, the bar and the dot, waving hello"
            case .thinking: "The ring, the bar and the dot, thinking"
            case .celebrate: "The ring, the bar and the dot, celebrating"
            case .outOfInk: "The ring, the bar and the dot, resting. Help is paused."
            }
        }
    }

    /// Width over height of the drawing.
    public static let aspectRatio: CGFloat = 220.0 / 130.0

    let pose: Pose
    let showsGround: Bool
    let animated: Bool

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// `animated: false` holds the pose still (as Reduce Motion does).
    public init(_ pose: Pose = .hello, showsGround: Bool = false, animated: Bool = true) {
        self.pose = pose
        self.showsGround = showsGround
        self.animated = animated
    }

    public var body: some View {
        let still = reduceMotion || !animated
        TimelineView(.animation(minimumInterval: 1.0 / 30, paused: still)) { context in
            let t = still ? 0 : context.date.timeIntervalSinceReferenceDate
            Canvas { gc, size in
                ShapesPainter(pose: pose, showsGround: showsGround, t: t, still: still).paint(&gc, size: size)
            }
        }
        .aspectRatio(Self.aspectRatio, contentMode: .fit)
        .accessibilityElement()
        .accessibilityLabel(pose.accessibilityLabel)
        .accessibilityAddTraits(.isImage)
    }
}

/// Paints the shapes for a pose at a moment. Pure, so a test can paint any frame.
struct ShapesPainter {
    let pose: TheShapes.Pose
    let showsGround: Bool
    let t: Double
    let still: Bool

    private let ink = DS.Color.ink
    private let soft = DS.Color.inkSecondary

    // The base layout, from the brand page.
    static let ringCenter = CGPoint(x: 56, y: 74)
    static let ringRadius: CGFloat = 38
    static let ringWidth: CGFloat = 18
    static let bar = CGRect(x: 118, y: 22, width: 22, height: 100)
    static let dotCenter = CGPoint(x: 186, y: 96)
    static let dotRadius: CGFloat = 22
    static let ground: CGFloat = 122

    func paint(_ gc: inout GraphicsContext, size: CGSize) {
        let u = min(size.width / 220, size.height / 130)
        guard u > 0 else { return }
        var g = gc
        g.translateBy(x: (size.width - 220 * u) / 2, y: (size.height - 130 * u) / 2)
        g.scaleBy(x: u, y: u)
        // Small (under about 72 pt wide): bigger eyes, no confetti or thought dots.
        let small = 220 * u < 72
        let eye: CGFloat = small ? 1.45 : 1

        if showsGround {
            g.fill(Path(roundedRect: CGRect(x: 0, y: Self.ground, width: 220, height: 4), cornerRadius: 2),
                   with: .color(DS.Color.line))
        }

        switch pose {
        case .hello: hello(g, eye: eye)
        case .thinking: thinking(g, eye: eye, small: small)
        case .celebrate: celebrate(g, eye: eye, small: small)
        case .outOfInk: outOfInk(g, eye: eye, small: small)
        }
    }

    // MARK: Poses

    private func hello(_ g: GraphicsContext, eye: CGFloat) {
        ring(g, dy: bob(0), color: DS.Color.cobalt) { c in
            openEyes(c, [CGPoint(x: 46, y: 70), CGPoint(x: 64, y: 70)], r: 4.5 * eye, blink: blink(0))
        }
        bar(g, angle: still ? -7 : waveAngle()) { c in
            openEyes(c, [CGPoint(x: 125, y: 44), CGPoint(x: 134, y: 44)], r: 3.6 * eye, blink: blink(0.6))
        }
        dot(g, dy: bob(0.35)) { c in
            openEyes(c, [CGPoint(x: 179, y: 92), CGPoint(x: 193, y: 92)], r: 3.6 * eye, blink: blink(1.1))
            smile(c, from: CGPoint(x: 181, y: 102), width: 10, depth: 5, lineWidth: 3)
        }
    }

    private func thinking(_ g: GraphicsContext, eye: CGFloat, small: Bool) {
        let look = CGVector(dx: 1.8, dy: -2.4)
        ring(g, dy: bob(0), color: DS.Color.cobalt) { c in
            openEyes(c, [CGPoint(x: 46, y: 70), CGPoint(x: 64, y: 70)], r: 4.5 * eye, blink: blink(0), look: look)
        }
        bar(g, angle: -4 + (still ? 0 : 1.2 * sin(t * 2 * .pi / 3.4))) { c in
            openEyes(c, [CGPoint(x: 125, y: 44), CGPoint(x: 134, y: 44)], r: 3.6 * eye, blink: blink(0.9), look: look)
        }
        let rock = still ? 6 : 6 * sin(t * 2 * .pi / 2.6)
        transformed(g, pivot: CGPoint(x: 186, y: 118), angle: rock) { c in
            c.fill(circle(Self.dotCenter, Self.dotRadius), with: .color(DS.Color.sunny))
            openEyes(c, [CGPoint(x: 179, y: 92), CGPoint(x: 193, y: 92)], r: 3.6 * eye, blink: blink(1.4), look: look)
            var m = Path()
            m.move(to: CGPoint(x: 183, y: 104))
            m.addLine(to: CGPoint(x: 191, y: 104))
            c.stroke(m, with: .color(ink), style: StrokeStyle(lineWidth: 3, lineCap: .round))
        }
        guard !small else { return }
        // Three thought dots rise from the ring, one after another.
        let dots: [(CGPoint, CGFloat)] = [(CGPoint(x: 94, y: 30), 3.2), (CGPoint(x: 101, y: 18), 4.4), (CGPoint(x: 110, y: 6), 5.4)]
        let phase = still ? 1 : (t.truncatingRemainder(dividingBy: 1.8)) / 1.8
        for (i, d) in dots.enumerated() {
            let on = still ? 1 : min(max((phase - Double(i) * 0.22) / 0.12, 0), 1)
            var c = g
            c.opacity = on
            c.fill(circle(d.0, d.1), with: .color(soft))
        }
    }

    private func celebrate(_ g: GraphicsContext, eye: CGFloat, small: Bool) {
        if !small { confetti(g) }
        ring(g, dy: still ? -2 : bob(0, period: 0.9, height: 3.4), color: DS.Color.cobalt) { c in
            happyEyes(c, [CGPoint(x: 46, y: 70), CGPoint(x: 64, y: 70)], r: 4.5 * eye)
        }
        bar(g, angle: still ? 8 : 8 + 4 * sin(t * 2 * .pi / 0.9)) { c in
            happyEyes(c, [CGPoint(x: 124, y: 44), CGPoint(x: 134, y: 44)], r: 3.4 * eye, spread: 0.72)
        }
        // The dot hops, and squashes a little as it lands.
        let hop = still ? 10 : abs(sin(t * .pi / 0.9)) * 16
        let squash: CGFloat = hop < 2.5 ? 0.92 : 1
        transformed(g, pivot: CGPoint(x: 186, y: 118), angle: 0, dy: -hop, sx: 2 - squash, sy: squash) { c in
            c.fill(circle(Self.dotCenter, Self.dotRadius), with: .color(DS.Color.sunny))
            happyEyes(c, [CGPoint(x: 179, y: 91), CGPoint(x: 193, y: 91)], r: 3.6 * eye)
            var m = Path()
            m.move(to: CGPoint(x: 180.5, y: 100))
            m.addLine(to: CGPoint(x: 191.5, y: 100))
            m.addArc(center: CGPoint(x: 186, y: 100), radius: 5.5, startAngle: .degrees(0), endAngle: .degrees(180), clockwise: false)
            m.closeSubpath()
            c.fill(m, with: .color(ink))
        }
    }

    private func outOfInk(_ g: GraphicsContext, eye: CGFloat, small: Bool) {
        let breathe = still ? 1 : 1 + 0.018 * sin(t * 2 * .pi / 3.2)
        // The ring has run pale: the tutor's ink is used up for now.
        transformed(g, pivot: CGPoint(x: 56, y: 121), angle: 0, sy: breathe) { c in
            c.stroke(circle(Self.ringCenter, Self.ringRadius), with: .color(DS.Color.tutorInkEmpty), lineWidth: Self.ringWidth)
            sleepyEyes(c, [CGPoint(x: 46, y: 72), CGPoint(x: 64, y: 72)], r: 4.5 * eye)
        }
        // The bar lies down; the dot rests on it.
        let lying = CGRect(x: 112, y: 100, width: 100, height: 22)
        g.fill(Path(roundedRect: lying, cornerRadius: 5), with: .color(DS.Color.tomato))
        sleepyEyes(g, [CGPoint(x: 122, y: 110), CGPoint(x: 133, y: 110)], r: 3.4 * eye, spread: 0.72)
        transformed(g, pivot: CGPoint(x: 180, y: 100), angle: 0, sy: breathe) { c in
            c.fill(circle(CGPoint(x: 180, y: 78), Self.dotRadius), with: .color(DS.Color.sunny))
            sleepyEyes(c, [CGPoint(x: 173, y: 76), CGPoint(x: 187, y: 76)], r: 3.6 * eye)
            c.fill(Path(ellipseIn: CGRect(x: 178, y: 85, width: 4.4, height: 5)), with: .color(ink))
        }
        guard !small else { return }
        let drift = still ? 0.4 : (t.truncatingRemainder(dividingBy: 2.6)) / 2.6
        for (i, z) in [(CGPoint(x: 199, y: 46), CGFloat(9)), (CGPoint(x: 208, y: 26), CGFloat(6.5))].enumerated() {
            let p = (drift + Double(i) * 0.5).truncatingRemainder(dividingBy: 1)
            var c = g
            c.opacity = still ? 1 : sin(p * .pi)
            let o = CGPoint(x: z.0.x, y: z.0.y - CGFloat(p) * 6)
            var path = Path()
            path.move(to: o)
            path.addLine(to: CGPoint(x: o.x + z.1, y: o.y))
            path.addLine(to: CGPoint(x: o.x, y: o.y + z.1))
            path.addLine(to: CGPoint(x: o.x + z.1, y: o.y + z.1))
            c.stroke(path, with: .color(soft), style: StrokeStyle(lineWidth: 2.4, lineCap: .round, lineJoin: .round))
        }
    }

    // MARK: Members

    private func ring(_ g: GraphicsContext, dy: CGFloat, color: SwiftUI.Color, face: (GraphicsContext) -> Void) {
        transformed(g, pivot: CGPoint(x: 56, y: 121), angle: 0, dy: dy) { c in
            c.stroke(circle(Self.ringCenter, Self.ringRadius), with: .color(color), lineWidth: Self.ringWidth)
            face(c)
        }
    }

    private func bar(_ g: GraphicsContext, angle: Double, face: (GraphicsContext) -> Void) {
        transformed(g, pivot: CGPoint(x: Self.bar.midX, y: Self.bar.maxY), angle: angle) { c in
            c.fill(Path(roundedRect: Self.bar, cornerRadius: 5), with: .color(DS.Color.tomato))
            face(c)
        }
    }

    private func dot(_ g: GraphicsContext, dy: CGFloat, face: (GraphicsContext) -> Void) {
        transformed(g, pivot: CGPoint(x: 186, y: 118), angle: 0, dy: dy) { c in
            c.fill(circle(Self.dotCenter, Self.dotRadius), with: .color(DS.Color.sunny))
            face(c)
        }
    }

    private func confetti(_ g: GraphicsContext) {
        enum Piece { case star(CGFloat), ring(CGFloat), bar(CGFloat, CGFloat), dot(CGFloat) }
        let pieces: [(Piece, CGPoint, Double, SwiftUI.Color)] = [
            (.star(15), CGPoint(x: 18, y: 14), -10, DS.Color.sunny),
            (.dot(3.5), CGPoint(x: 42, y: 10), 0, DS.Color.success),
            (.ring(5), CGPoint(x: 80, y: 12), 0, DS.Color.cobalt),
            (.bar(4, 12), CGPoint(x: 104, y: 9), 25, DS.Color.tomato),
            (.ring(4), CGPoint(x: 158, y: 10), 0, DS.Color.success),
            (.bar(4, 11), CGPoint(x: 174, y: 32), -30, DS.Color.cobalt),
            (.star(16), CGPoint(x: 198, y: 16), 12, DS.Color.sunny),
            (.dot(3), CGPoint(x: 212, y: 52), 0, DS.Color.tomato),
        ]
        for (i, piece) in pieces.enumerated() {
            let s = still ? 1 : 0.85 + 0.15 * sin(t * 2 * .pi / 1.2 + Double(i) * 1.1)
            transformed(g, pivot: piece.1, angle: piece.2, sx: s, sy: s) { c in
                switch piece.0 {
                case .star(let size):
                    let r = CGRect(x: piece.1.x - size / 2, y: piece.1.y - size / 2, width: size, height: size)
                    let path = StarShape().path(in: r)
                    c.fill(path, with: .color(piece.3))
                    c.stroke(path, with: .color(piece.3), style: StrokeStyle(lineWidth: size / 12, lineJoin: .round))
                case .ring(let r):
                    c.stroke(circle(piece.1, r), with: .color(piece.3), lineWidth: r * 0.6)
                case .bar(let w, let h):
                    c.fill(Path(roundedRect: CGRect(x: piece.1.x - w / 2, y: piece.1.y - h / 2, width: w, height: h),
                                cornerRadius: w / 3), with: .color(piece.3))
                case .dot(let r):
                    c.fill(circle(piece.1, r), with: .color(piece.3))
                }
            }
        }
    }

    // MARK: Faces

    private func openEyes(_ g: GraphicsContext, _ centers: [CGPoint], r: CGFloat, blink: CGFloat,
                          look: CGVector = .zero) {
        for p in centers {
            let h = r * 2 * blink
            g.fill(Path(ellipseIn: CGRect(x: p.x + look.dx - r, y: p.y + look.dy - h / 2, width: r * 2, height: h)),
                   with: .color(ink))
        }
    }

    /// Arc eyes (happy ∩, sleepy ∪). `spread` narrows them where the eyes sit close (the bar).
    private func happyEyes(_ g: GraphicsContext, _ centers: [CGPoint], r: CGFloat, spread: CGFloat = 1.05) {
        for p in centers {
            var path = Path()
            path.move(to: CGPoint(x: p.x - r * spread, y: p.y + r * 0.55))
            path.addQuadCurve(to: CGPoint(x: p.x + r * spread, y: p.y + r * 0.55), control: CGPoint(x: p.x, y: p.y - r * 1.35))
            g.stroke(path, with: .color(ink), style: StrokeStyle(lineWidth: r * 0.72, lineCap: .round))
        }
    }

    private func sleepyEyes(_ g: GraphicsContext, _ centers: [CGPoint], r: CGFloat, spread: CGFloat = 1.05) {
        for p in centers {
            var path = Path()
            path.move(to: CGPoint(x: p.x - r * spread, y: p.y - r * 0.2))
            path.addQuadCurve(to: CGPoint(x: p.x + r * spread, y: p.y - r * 0.2), control: CGPoint(x: p.x, y: p.y + r * 1.15))
            g.stroke(path, with: .color(ink), style: StrokeStyle(lineWidth: r * 0.66, lineCap: .round))
        }
    }

    private func smile(_ g: GraphicsContext, from p: CGPoint, width: CGFloat, depth: CGFloat, lineWidth: CGFloat) {
        var path = Path()
        path.move(to: p)
        path.addQuadCurve(to: CGPoint(x: p.x + width, y: p.y), control: CGPoint(x: p.x + width / 2, y: p.y + depth))
        g.stroke(path, with: .color(ink), style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
    }

    // MARK: Time

    /// Eye height while blinking: 1 open, 0.1 shut, a short blink every 4.2 s.
    func blink(_ offset: Double) -> CGFloat {
        guard !still else { return 1 }
        let c = (t + offset).truncatingRemainder(dividingBy: DS.Motion.blinkPeriod) / DS.Motion.blinkPeriod
        guard c > 0.92 else { return 1 }
        let k = (c - 0.92) / 0.08
        return CGFloat(1 - 0.9 * (1 - abs(k * 2 - 1)))
    }

    /// An idle bob: up only (never through the ground), `height` units at the top.
    func bob(_ phase: Double, period: Double = DS.Motion.bobPeriod, height: CGFloat = 2.4) -> CGFloat {
        guard !still else { return 0 }
        return -CGFloat(1 - cos(2 * .pi * (t / period + phase))) / 2 * height
    }

    /// Hello's wave: two quick swings of the bar, then a rest, every 3.2 s.
    func waveAngle() -> Double {
        let c = t.truncatingRemainder(dividingBy: 3.2)
        guard c < 1.2 else { return 0 }
        return 9 * sin(2 * .pi * c / 0.6) * sin(.pi * c / 1.2)
    }

    // MARK: Helpers

    private func circle(_ c: CGPoint, _ r: CGFloat) -> Path {
        Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2))
    }

    private func transformed(_ g: GraphicsContext, pivot: CGPoint, angle: Double, dx: CGFloat = 0, dy: CGFloat = 0,
                             sx: CGFloat = 1, sy: CGFloat = 1, _ body: (GraphicsContext) -> Void) {
        var c = g
        c.translateBy(x: pivot.x + dx, y: pivot.y + dy)
        c.rotate(by: .degrees(angle))
        c.scaleBy(x: sx, y: sy)
        c.translateBy(x: -pivot.x, y: -pivot.y)
        body(c)
    }
}

#Preview("The shapes") {
    VStack(spacing: 24) {
        HStack(spacing: 24) {
            ForEach(TheShapes.Pose.allCases) { pose in
                VStack {
                    TheShapes(pose, showsGround: true).frame(width: 200)
                    Text(pose.rawValue).dsFont(.caption)
                }
            }
        }
        HStack(alignment: .bottom, spacing: 24) {
            TheShapes(.hello).frame(width: 24)
            TheShapes(.hello).frame(width: 48)
            TheShapes(.hello).frame(width: 96)
            TheShapes(.hello).frame(width: 200)
        }
    }
    .padding(40)
    .background(DS.Color.paper)
}
