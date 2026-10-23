import AgathonBoard
import AgathonBrain
import Foundation

/// A student writing a line by hand, on the iPad: the web scoreboard's `handInk`
/// (src/__eval__/handwriting.ts) in Swift. The glyphs are the tutor's own hand (`layoutMath` in the
/// brain, at the scoreboard's size 44 and the hand's seed); what changes per hand is how the pen moves
/// across the line — slant, scale, a tilt, a little wobble per stroke, uneven glyph sizes, a wandering
/// baseline — exactly as the scoreboard's four student hands do it (`kid-hands.json` is the web's
/// output, and the tests hold this port to it). Then it is scaled to a kid's size on the page.
///
/// Nothing here is a real child's writing: all of it is synthetic.
public enum StudentHand {
    /// the scoreboard's hand size (page units): a student's line on a 1600 × 900 screen
    public static let handSize = 44.0

    /// The brain's `layoutMath`: one expression laid out in the hand, layout coordinates.
    struct MathLayout: Decodable, Sendable {
        struct Stroke: Decodable, Sendable {
            struct P: Decodable, Sendable { var x: Double; var y: Double }
            var points: [P]
        }
        var strokes: [Stroke]
        var width: Double
        var height: Double
        var baseline: Double
        var unsupported: [String]
    }

    private struct LayoutArgs: Encodable, Sendable {
        var latex: String
        var size: Double
        var seed: Int
    }

    /// `latex` in `hand`: its strokes in page units, the ink box's top-left at (0, 0), scaled by the
    /// hand's size. Nil when the hand cannot write it (something it has no glyph for).
    public static func ink(_ latex: String, hand: TrainingHand, brain: Brain) async throws -> [[Vec2]]? {
        let laid: MathLayout = try await brain.call("layoutMath", LayoutArgs(latex: handLatex(latex), size: handSize, seed: hand.seed))
        guard laid.unsupported.isEmpty, !laid.strokes.isEmpty else { return nil }
        let layout = withRules(laid, latex: latex)
        let strokes = perturb(layout, latex: latex, hand: hand)
        let pts = strokes.flatMap { $0 }
        guard let x0 = pts.map(\.x).min(), let y0 = pts.map(\.y).min() else { return nil }
        return strokes.map { s in s.map { Vec2(($0.x - x0) * hand.scale, ($0.y - y0) * hand.scale) } }
    }

    /// The unscaled strokes (page units at the scoreboard's size, its origin), the scoreboard's own
    /// numbers: what the fixture parity test compares.
    static func scoreboardInk(_ latex: String, hand: TrainingHand, brain: Brain) async throws -> [[Vec2]]? {
        let layout: MathLayout = try await brain.call("layoutMath", LayoutArgs(latex: handLatex(latex), size: handSize, seed: hand.seed))
        guard layout.unsupported.isEmpty, !layout.strokes.isEmpty else { return nil }
        return perturb(layout, latex: latex, hand: hand)
    }

    /// A line as a student WRITES it (the scoreboard's `handLatex`): `\mathrm{~km}`'s spacing is not
    /// ink, and a power inside `\mathrm` is a superscript on the page.
    static func handLatex(_ latex: String) -> String {
        var s = latex.replacingOccurrences(of: #"\\mathrm\s*\{\s*~\s*"#, with: #"\\,\\mathrm{"#, options: .regularExpression)
        s = s.replacingOccurrences(of: "~", with: " ")
        s = s.replacingOccurrences(of: #"\\mathrm\s*\{([^{}]*?)\^\{([^{}]*)\}\s*\}"#, with: #"\\mathrm{$1}^{$2}"#, options: .regularExpression)
        return s
    }

    /// A stacked sum's bars (`\hline` in an array): the hand's layout leaves them out, and no kid does. A
    /// bar is drawn across the sum's width between the row above and the row under it, in writing order
    /// (after the row above). The layout's rows are its strokes' vertical bands, top to bottom.
    static func withRules(_ layout: MathLayout, latex: String) -> MathLayout {
        guard latex.contains("\\hline"), let begin = latex.range(of: "\\begin{array}"), let end = latex.range(of: "\\end{array}"),
              begin.upperBound < end.lowerBound else { return layout }
        var body = String(latex[begin.upperBound..<end.lowerBound])
        // the column spec (`{r}`)
        if body.hasPrefix("{"), let close = body.firstIndex(of: "}") { body = String(body[body.index(after: close)...]) }
        let rows = body.components(separatedBy: "\\\\")
        let ruled = rows.enumerated().filter { $0.offset > 0 && $0.element.contains("\\hline") }.map(\.offset)
        guard !ruled.isEmpty else { return layout }
        // the strokes' bands: overlapping vertical spans merged
        let spans = layout.strokes.enumerated().compactMap { i, s -> (i: Int, y0: Double, y1: Double)? in
            guard let y0 = s.points.map(\.y).min(), let y1 = s.points.map(\.y).max() else { return nil }
            return (i, y0, y1)
        }.sorted { $0.y0 < $1.y0 }
        var bands: [(y0: Double, y1: Double, last: Int)] = []
        for s in spans {
            if let b = bands.last, s.y0 <= b.y1 + 1 {
                bands[bands.count - 1] = (b.y0, max(b.y1, s.y1), max(b.last, s.i))
            } else {
                bands.append((s.y0, s.y1, s.i))
            }
        }
        guard bands.count == rows.count else { return layout }
        let xs = layout.strokes.flatMap { $0.points.map(\.x) }
        guard let x0 = xs.min(), let x1 = xs.max() else { return layout }
        var strokes = layout.strokes
        // last first, so the indices of the earlier rows hold
        for r in ruled.sorted(by: >) {
            let y = (bands[r - 1].y1 + bands[r].y0) / 2
            let n = 8
            let bar = MathLayout.Stroke(points: (0...n).map { k in .init(x: x0 - 4 + (x1 - x0 + 8) * Double(k) / Double(n), y: y) })
            strokes.insert(bar, at: min(strokes.count, bands[r - 1].last + 1))
        }
        var out = layout
        out.strokes = strokes
        return out
    }

    /// `handInk`'s pen: the warp (uneven sizes, a wandering baseline), the slant, the scale, the tilt
    /// about the line's middle and a random nudge per stroke, at the scoreboard's origin (240, 320).
    static func perturb(_ layout: MathLayout, latex: String, hand v: TrainingHand) -> [[Vec2]] {
        let size = handSize
        // `latex.length` in JavaScript counts UTF-16 code units
        let length = latex.utf16.count
        var rand = Mulberry32(seed: UInt32(truncatingIfNeeded: v.seed &* 7919 &+ length))
        let cx = layout.width / 2
        let cy = layout.height / 2
        let angle = v.rotateDeg * .pi / 180
        let c = cos(angle), s = sin(angle)
        let origin = (x: 240.0, y: 320.0)
        let A = v.sizeDrift
        let W = v.wander * size
        var warpRand = Mulberry32(seed: UInt32(truncatingIfNeeded: v.seed &* 104_729 &+ length))
        let phi = warpRand.next() * 2 * .pi
        let psi = warpRand.next() * 2 * .pi
        let k = (2 * Double.pi) / (4 * size)
        func warp(_ px: Double, _ py: Double) -> (Double, Double) {
            if A == 0 && W == 0 { return (px, py) }
            let sc = 1 + A * sin(k * px + phi)
            let x = A == 0 ? px : px - (A / k) * (cos(k * px + phi) - cos(phi))
            let y = layout.baseline + (py - layout.baseline) * sc + W * sin(((2 * Double.pi) / (7 * size)) * px + psi)
            return (x, y)
        }
        return layout.strokes.map { st in
            let dx = (rand.next() - 0.5) * 2 * v.jitter * size
            let dy = (rand.next() - 0.5) * 2 * v.jitter * size
            return st.points.map { raw in
                let (wx, wy) = warp(raw.x, raw.y)
                var x = wx + v.slant * (layout.baseline - wy)
                var y = wy
                x = (x - cx) * v.sx
                y = (y - cy) * v.sy
                return Vec2(origin.x + cx + x * c - y * s + dx, origin.y + cy + x * s + y * c + dy)
            }
        }
    }
}

/// The hand's random numbers (`mulberry32` in src/lib/hand/path.ts), bit for bit.
struct Mulberry32 {
    private var a: UInt32

    init(seed: UInt32) {
        a = seed
    }

    mutating func next() -> Double {
        a = a &+ 0x6D2B_79F5
        var t = a
        t = (t ^ (t >> 15)) &* (t | 1)
        t ^= t &+ ((t ^ (t >> 7)) &* (t | 61))
        return Double(t ^ (t >> 14)) / 4_294_967_296
    }
}
