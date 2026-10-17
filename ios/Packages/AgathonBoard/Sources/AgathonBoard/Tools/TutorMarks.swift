import Foundation

/// The tutor's marks as strokes: a tick after a right line, a ring round a wrong one, a question mark
/// beside ink it could not read. The geometry of the web's `src/lib/live/marks.ts` (same constants,
/// same seeded wobble), written by `TutorWriter` like any other tutor line.
public enum TutorMarks {
    public static let gap = 18.0
    public static let checkFactor = 0.8
    public static let checkMin = 18.0
    public static let checkMax = 44.0
    public static let ringPadX = 14.0
    public static let ringPadY = 10.0

    /// mulberry32, as the web's
    struct Mulberry32 {
        var a: UInt32
        init(_ seed: UInt32) { a = seed }
        mutating func next() -> Double {
            a = a &+ 0x6D2B_79F5
            var t = a
            t = (t ^ (t >> 15)) &* (t | 1)
            t ^= t &+ ((t ^ (t >> 7)) &* (t | 61))
            return Double(t ^ (t >> 14)) / 4_294_967_296
        }
    }

    public static func ringRadii(_ line: Box) -> (rx: Double, ry: Double) {
        ((line.w / 2) * 2.0.squareRoot() + ringPadX / 2, (line.h / 2) * 2.0.squareRoot() + ringPadY / 2)
    }

    public static func anchor(_ line: Box) -> (x: Double, y: Double, h: Double) {
        let h = min(checkMax, max(checkMin, line.h * checkFactor))
        return (line.x + line.w + gap, line.y + line.h / 2 - h / 2, h)
    }

    /// The mark's strokes for a line with these page bounds.
    public static func strokes(_ kind: MarkKind, line: Box, seed: UInt32) -> [TutorStroke] {
        var j = Mulberry32(seed)
        func polyline(_ pts: [(Double, Double)], _ amount: Double) -> TutorStroke {
            TutorStroke(points: pts.enumerated().map { i, p in
                let x = p.0 + (j.next() - 0.5) * amount
                let y = p.1 + (j.next() - 0.5) * amount
                return FreehandInput(Vec2(x, y), 0.5 + 0.1 * sin(Double(i) / 3))
            })
        }
        switch kind {
        case .ring:
            let cx = line.x + line.w / 2
            let cy = line.y + line.h / 2
            let (rx, ry) = ringRadii(line)
            let tilt = (j.next() - 0.5) * 0.06
            let start = Double.pi * 1.08
            let sweep = Double.pi * 2.12
            let n = 48
            var pts: [(Double, Double)] = []
            for i in 0...n {
                let t = start + sweep * Double(i) / Double(n)
                let wob = 1 + (j.next() - 0.5) * 0.03
                let x = rx * wob * cos(t)
                let y = ry * wob * sin(t)
                pts.append((cx + x * cos(tilt) - y * sin(tilt), cy + x * sin(tilt) + y * cos(tilt)))
            }
            return [polyline(pts, 1.2)]
        case .tick:
            let a = anchor(line)
            let w = a.h * 0.9
            return [polyline([
                (a.x, a.y + a.h * 0.55), (a.x + w * 0.18, a.y + a.h * 0.72), (a.x + w * 0.36, a.y + a.h * 0.95),
                (a.x + w * 0.6, a.y + a.h * 0.55), (a.x + w * 0.82, a.y + a.h * 0.22), (a.x + w, a.y),
            ], 1)]
        case .question:
            let a = anchor(line)
            let w = a.h * 0.55
            let r = w / 2
            let cx = a.x + r
            let cy = a.y + r
            var hook: [(Double, Double)] = []
            for i in 0...14 {
                let t = Double.pi * (1.1 - (Double(i) / 14) * 1.55)
                hook.append((cx + r * cos(t), cy - r * sin(t)))
            }
            hook.append((cx, a.y + a.h * 0.7))
            let dotY = a.y + a.h * 0.95
            return [polyline(hook, 0.8), polyline([(cx, dotY), (cx + 0.5, dotY + 1)], 0.2)]
        }
    }
}
