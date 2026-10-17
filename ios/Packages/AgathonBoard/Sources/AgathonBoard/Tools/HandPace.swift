import Foundation

/// One stroke the tutor will write: points in page units on the screen, with the hand engine's
/// pressure hint, and the pen's weight (1 = the tutor's usual pen).
public struct TutorStroke: Sendable, Equatable {
    public var points: [FreehandInput]
    public var weight: Double

    public init(points: [FreehandInput], weight: Double = 1) {
        self.points = points
        self.weight = weight
    }

    public init(_ xy: [(Double, Double)], pressure: Double = 0.45, weight: Double = 1) {
        self.init(points: xy.map { FreehandInput(Vec2($0.0, $0.1), pressure) }, weight: weight)
    }

    public static func == (a: TutorStroke, b: TutorStroke) -> Bool {
        a.weight == b.weight && a.points.count == b.points.count
            && zip(a.points, b.points).allSatisfy { $0.p == $1.p && $0.pressure == $1.pressure }
    }
}

/// One line of the tutor's writing (a step of a solution, a mark): written stroke by stroke, then a pause.
public struct TutorLine: Sendable, Equatable {
    public var strokes: [TutorStroke]
    /// what the line says, stamped on its strokes (`meta.handLine`)
    public var latex: String
    public var color: InkColor
    /// closed shapes (a bar, a box) are filled once the pen has gone all the way round
    public var closed: Bool
    public var fill: FillStyle

    public init(strokes: [TutorStroke], latex: String = "", color: InkColor = .tutor, closed: Bool = false, fill: FillStyle = .none) {
        self.strokes = strokes
        self.latex = latex
        self.color = color
        self.closed = closed
        self.fill = fill
    }
}

/// The tutor's handwriting pace, as the web writes it (src/lib/live/handwriting.ts, src/lib/hand/mathLayout.ts):
/// strokes resampled every 2 px, a stroke takes 60 ms + its length at 0.45 px/ms (60…900 ms), 40 ms
/// between strokes, 450 ms between lines, and a long block sped up so it is written within seconds.
public enum HandPace {
    public static let resampleStep = 2.0
    public static let maxPointsPerStroke = 400
    public static let penSpeed = 0.45 // px per ms
    public static let strokeMinMs = 60.0
    public static let strokeMaxMs = 900.0
    public static let strokeGapMs = 40.0
    public static let lineGapMs = 450.0
    /// the web's animation tick; the iPad reveals at the display's own rate instead, on the same clock
    public static let webFrameMs = 32.0
    public static let naturalUpToMs = 4_000.0
    public static let maxWallMs = 6_000.0
    public static let maxPace = 5.0

    /// Resampled so no two points are more than `step` apart (pressure lerped); a stroke too long
    /// for the point cap is resampled more coarsely, never cut short.
    public static func densify(_ points: [FreehandInput], step: Double = resampleStep) -> [FreehandInput] {
        guard points.count >= 2 else { return points }
        var length = 0.0
        for i in 1..<points.count { length += points[i].p.dist(points[i - 1].p) }
        let room = Double(max(1, maxPointsPerStroke - points.count))
        let pitch = max(step, length / room)
        var out = [points[0]]
        for i in 1..<points.count {
            let a = points[i - 1]
            let b = points[i]
            let n = max(1, Int((a.p.dist(b.p) / pitch).rounded(.up)))
            for k in 1...n {
                let t = Double(k) / Double(n)
                out.append(FreehandInput(a.p.lerp(b.p, t), a.pressure + (b.pressure - a.pressure) * t))
            }
        }
        return out
    }

    public static func strokeDurationMs(_ points: [FreehandInput]) -> Double {
        var len = 0.0
        if points.count > 1 { for i in 1..<points.count { len += points[i].p.dist(points[i - 1].p) } }
        return min(strokeMaxMs, max(strokeMinMs, strokeMinMs + len / penSpeed))
    }

    /// How much faster than natural a block of `naturalMs` is written (1 up to 4 s).
    public static func paceFor(_ naturalMs: Double) -> Double {
        guard naturalMs > naturalUpToMs else { return 1 }
        let wall = min(maxWallMs, naturalUpToMs + (naturalMs - naturalUpToMs) / 3)
        return min(maxPace, naturalMs / wall)
    }

    /// A block laid out on the clock.
    public struct Plan: Sendable {
        public struct Stroke: Sendable {
            public var points: [FreehandInput]
            public var weight: Double
            /// natural ms from the line's start
            public var startMs: Double
            public var durationMs: Double
        }

        public struct Line: Sendable {
            public var source: TutorLine
            public var strokes: [Stroke]
            /// natural ms from the block's start
            public var startMs: Double
            public var durationMs: Double
        }

        public var lines: [Line]
        /// natural length of the block
        public var totalMs: Double
        /// speed-up (wall = natural / pace)
        public var pace: Double
        public var wallMs: Double { totalMs / pace }
    }

    public static func plan(_ lines: [TutorLine]) -> Plan {
        var out: [Plan.Line] = []
        var t = 0.0
        for line in lines {
            var strokes: [Plan.Stroke] = []
            var lt = 0.0
            for s in line.strokes where !s.points.isEmpty {
                let pts = densify(s.points)
                let d = strokeDurationMs(pts)
                strokes.append(Plan.Stroke(points: pts, weight: s.weight, startMs: lt, durationMs: d))
                lt += d + strokeGapMs
            }
            guard !strokes.isEmpty else { continue }
            let duration = max(0, lt - strokeGapMs)
            out.append(Plan.Line(source: line, strokes: strokes, startMs: t, durationMs: duration))
            t += duration + lineGapMs
        }
        let total = max(0, t - lineGapMs)
        return Plan(lines: out, totalMs: total, pace: paceFor(total))
    }

    /// How many points of each stroke of a line are drawn `localMs` (natural) into the line: 0 for a
    /// stroke the pen has not reached, all for a finished one, part of the one being drawn.
    public static func revealCounts(_ line: Plan.Line, localMs: Double) -> [Int] {
        var out = [Int](repeating: 0, count: line.strokes.count)
        for (i, s) in line.strokes.enumerated() {
            if localMs >= s.startMs + s.durationMs {
                out[i] = s.points.count
                continue
            }
            if localMs <= s.startMs { break }
            let frac = (localMs - s.startMs) / s.durationMs
            out[i] = min(s.points.count, max(2, Int((frac * Double(s.points.count)).rounded(.up))))
            break
        }
        return out
    }
}

extension HandPace {
    /// The meta key grouping one written block's strokes (the web's `meta.handBlock`).
    public static let blockMeta = "handBlock"
    /// The meta key with the LaTeX of the line a stroke belongs to (the web's `meta.handLine`).
    public static let lineMeta = "handLine"

    /// The record for stroke `j` of line `i` of a plan, as the tutor's ink: its points relative to
    /// its first, each timed at the pace it was revealed (so a replay writes it at the same speed).
    public static func strokeRecord(
        _ plan: Plan, line i: Int, stroke j: Int, screen: RecordID, order: OrderKey,
        blockStart: Double, block: String, meta: Meta
    ) -> StrokeRecord {
        let line = plan.lines[i]
        let s = line.strokes[j]
        let first = s.points.first?.p ?? .zero
        let n = s.points.count
        let wallDuration = s.durationMs / plan.pace
        let pts: [InkPoint] = s.points.enumerated().map { k, p in
            InkPoint(
                x: Float(p.p.x - first.x), y: Float(p.p.y - first.y), pressure: Float(min(1, max(0, p.pressure))),
                t: Float(n > 1 ? wallDuration * Double(k) / Double(n - 1) : 0))
        }
        var m = meta
        m[blockMeta] = .string(block)
        if !line.source.latex.isEmpty { m[lineMeta] = .string(line.source.latex) }
        return StrokeRecord(
            screen: screen, order: order, author: .tutor, color: line.source.color,
            width: InkStyle.tutorWidth(weight: s.weight), pressure: .real, x: first.x, y: first.y, points: pts,
            start: (blockStart + (line.startMs + s.startMs) / plan.pace).rounded(),
            closed: line.source.closed, fill: line.source.closed ? line.source.fill : .none, meta: m)
    }
}
