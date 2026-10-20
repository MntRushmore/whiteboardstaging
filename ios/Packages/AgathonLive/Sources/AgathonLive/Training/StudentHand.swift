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
        let layout: MathLayout = try await brain.call("layoutMath", LayoutArgs(latex: handLatex(latex), size: handSize, seed: hand.seed))
        guard layout.unsupported.isEmpty, !layout.strokes.isEmpty else { return nil }
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
