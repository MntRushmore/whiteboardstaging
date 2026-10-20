import AgathonBoard
import AgathonBrain
import Foundation

/// A kid's pace at the pen, for replaying the handwriting fixtures (the Live Lab, the timing bench in
/// the tests, and the Training Center's bench, which is in Release builds too): how long each stroke
/// takes and the pause before it, from the strokes' own geometry — short inside a glyph (the second
/// bar of an `=`), longer between glyphs, longest before the answer after an `=` (working it out),
/// and the pause before the next line. Seeded: the same seed, the
/// same pauses.
///
/// Not measured on children: the ranges are assumptions in the spirit of handwriting studies'
/// in-air pauses for 8–12 year-olds (about 100–250 ms inside a letter, 200–500 ms between letters),
/// with thinking time added for maths. Early reads follow the kid's own pauses (`PenRhythm`), so the
/// exact numbers matter less than their spread.
public struct KidPace: Sendable, Equatable {
    public var name: String
    public var withinGlyph: ClosedRange<Double>
    public var betweenGlyphs: ClosedRange<Double>
    public var beforeAnswer: ClosedRange<Double>
    public var betweenLines: ClosedRange<Double>
    /// how fast the pen moves while drawing (page units per second)
    public var speed: Double

    public static let brisk = KidPace(name: "brisk", withinGlyph: 80...180, betweenGlyphs: 150...320, beforeAnswer: 200...700,
                                      betweenLines: 900...1_600, speed: 500)
    public static let typical = KidPace(name: "typical", withinGlyph: 100...250, betweenGlyphs: 200...480, beforeAnswer: 300...1_200,
                                        betweenLines: 1_200...2_500, speed: 350)
    public static let slow = KidPace(name: "slow", withinGlyph: 150...350, betweenGlyphs: 300...700, beforeAnswer: 500...2_000,
                                     betweenLines: 1_800...3_500, speed: 250)
    public static let all = [brisk, typical, slow]

    /// One stroke as replayed: the pause before it (ms; 0 for a line's first) and how long it takes.
    public struct Step: Sendable, Equatable {
        public var pauseMs: Double
        public var drawMs: Double
        /// what the pause is
        public var kind: Kind
        public enum Kind: String, Sendable { case first, withinGlyph, betweenGlyphs, beforeAnswer }
    }

    /// The steps for a line's strokes (page coordinates, in writing order).
    public func steps(_ strokes: [[Vec2]], rng: inout SplitMix) -> [Step] {
        let boxes = strokes.map(Self.box)
        var out: [Step] = []
        for (i, pts) in strokes.enumerated() {
            let length = zip(pts, pts.dropFirst()).reduce(0) { $0 + $1.0.dist($1.1) }
            let draw = max(60, length / speed * 1_000)
            guard i > 0 else {
                out.append(Step(pauseMs: 0, drawMs: draw, kind: .first))
                continue
            }
            let kind: Step.Kind
            let before = Array(boxes.prefix(i))
            let prev = boxes[i - 1], cur = boxes[i]
            let overlap = min(prev.maxX, cur.maxX) - max(prev.x, cur.x)
            if let eq = LineShape.equalsSign(before), eq.maxX >= (before.map(\.maxX).max() ?? 0) - 1, cur.x >= eq.maxX - 2 {
                kind = .beforeAnswer
            } else if overlap >= 0.3 * max(1, min(prev.w, cur.w)) {
                kind = .withinGlyph
            } else {
                kind = .betweenGlyphs
            }
            let range = kind == .withinGlyph ? withinGlyph : kind == .beforeAnswer ? beforeAnswer : betweenGlyphs
            out.append(Step(pauseMs: Self.logUniform(range, &rng), drawMs: draw, kind: kind))
        }
        return out
    }

    /// The pause before the next line (ms).
    public func lineBreak(_ rng: inout SplitMix) -> Double {
        Self.logUniform(betweenLines, &rng)
    }

    static func logUniform(_ r: ClosedRange<Double>, _ rng: inout SplitMix) -> Double {
        let u = Double(rng.next() % 1_000_000) / 1_000_000
        return exp(log(r.lowerBound) + u * (log(r.upperBound) - log(r.lowerBound)))
    }

    static func box(_ pts: [Vec2]) -> BrainRect {
        let xs = pts.map(\.x), ys = pts.map(\.y)
        let x0 = xs.min() ?? 0, y0 = ys.min() ?? 0
        return BrainRect(x: x0, y: y0, w: (xs.max() ?? x0) - x0, h: (ys.max() ?? y0) - y0)
    }
}

/// A small seeded generator (SplitMix64).
public struct SplitMix: RandomNumberGenerator, Sendable {
    var state: UInt64
    public init(seed: UInt64) { state = seed }
    public mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }
}
