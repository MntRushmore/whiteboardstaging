import AgathonBrain
import Foundation

/// A line the kid crossed out: one long, flat, straight stroke drawn through the middle of the
/// writing, going through its digits and letters. It is the kid's "not this one" — never judged,
/// never ringed, never a step the lines under it follow from (the Training Center's `rw-strike-ok`:
/// `10 × 7 = 17` struck through, then `10 × 7 = 70` under it, was ringed).
///
/// Not a strike: a fraction bar or a stacked sum's rule (the writing is above and below it, nothing
/// goes through it), an underline (under the writing), an `=` or a minus (short).
public enum StruckLine {
    /// The id of the stroke that strikes these strokes out, or nil.
    public static func strike(in strokes: [BrainStroke]) -> String? {
        guard strokes.count >= 3 else { return nil }
        let boxes = strokes.map(box)
        for (i, s) in strokes.enumerated() {
            let b = boxes[i]
            let others = boxes.indices.filter { $0 != i }.map { boxes[$0] }
            let u = others.dropFirst().reduce(others[0]) { $0.union($1) }
            guard u.w > 0, u.h > 0 else { continue }
            // long: across (nearly) all the writing, from its start to its end
            guard b.w >= 0.7 * u.w, b.minX <= u.minX + 0.15 * u.w, b.maxX >= u.maxX - 0.15 * u.w else { continue }
            // flat and straight: a stroke, not a scribble or a loop
            guard b.h <= max(0.35 * u.h, 1), straightness(s) >= 0.85 else { continue }
            // through the middle of the writing, not under it
            let y = b.midY
            guard y >= u.minY + 0.2 * u.h, y <= u.maxY - 0.2 * u.h else { continue }
            // through the writing: strokes above and below it at once, three at least
            let through = others.filter { o in o.minY < y - 0.05 * u.h && o.maxY > y + 0.05 * u.h && o.midX >= b.minX && o.midX <= b.maxX }
            if through.count >= 3 { return s.id }
        }
        return nil
    }

    /// A read that says the line is struck (`\sout{…}`, `\cancel{…}`, `\xcancel{…}`, `\st{…}` round it all).
    public static func readStruck(_ latex: String) -> Bool {
        latex.range(of: #"^\s*\\(?:sout|xout|cancel|xcancel|bcancel|st)\s*\{.*\}\s*$"#, options: .regularExpression) != nil
    }

    struct Box {
        var minX, minY, maxX, maxY: Double
        var w: Double { maxX - minX }
        var h: Double { maxY - minY }
        var midX: Double { (minX + maxX) / 2 }
        var midY: Double { (minY + maxY) / 2 }
        func union(_ o: Box) -> Box { Box(minX: min(minX, o.minX), minY: min(minY, o.minY), maxX: max(maxX, o.maxX), maxY: max(maxY, o.maxY)) }
    }

    static func box(_ s: BrainStroke) -> Box {
        Box(minX: s.x.min() ?? 0, minY: s.y.min() ?? 0, maxX: s.x.max() ?? 0, maxY: s.y.max() ?? 0)
    }

    /// The stroke's end-to-end distance over its length (1: a straight line).
    static func straightness(_ s: BrainStroke) -> Double {
        let n = min(s.x.count, s.y.count)
        guard n >= 2 else { return 0 }
        var length = 0.0
        for k in 1..<n { length += hypot(s.x[k] - s.x[k - 1], s.y[k] - s.y[k - 1]) }
        guard length > 0 else { return 0 }
        return hypot(s.x[n - 1] - s.x[0], s.y[n - 1] - s.y[0]) / length
    }
}
