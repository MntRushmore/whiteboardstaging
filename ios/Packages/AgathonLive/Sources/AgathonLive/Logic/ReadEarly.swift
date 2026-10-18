import AgathonBrain
import Foundation

/// The kid's rhythm at the pen, for reading a line before its quiet gate runs out
/// (`LiveLoop+ReadEarly`): which line the pen is on (the box of its ink so far), how long this kid
/// pauses between strokes inside a line, and whether a hovering Pencil has left the line.
///
/// The early read waits a little longer than nine in ten of the kid's own pauses inside a line, so it
/// rarely starts while a line is still being written (a read started then is a read wasted). Until
/// the kid's rhythm is known it waits the longest; a kid whose long pauses are longer still gets no
/// early read on a pause at all (the gain would be small and the waste not), only on hover.
struct PenRhythm: Equatable {
    /// pauses kept (the latest)
    static let keep = 40
    /// pauses needed before the kid's own rhythm is trusted
    static let minSamples = 8
    /// the wait before then (the longest: an unknown kid may be a slow one)
    static let defaultDelayMs = 450.0
    static let minDelayMs = 200.0
    static let maxDelayMs = 450.0
    /// added to the kid's long pause
    static let marginMs = 40.0
    static let percentile = 0.9
    /// pauses at least this long are not rhythm: the quiet gate reads the line then anyway
    static let longPauseMs = LiveTiming.quietMs

    /// the line being written: the box of its strokes so far (page units)
    private(set) var line: BrainRect?
    /// pauses between strokes inside a line (ms), oldest first
    private(set) var pauses: [Double] = []
    private var lastUpAt: Double?
    private var downAt: Double?

    /// The pen went down (ms on the loop's clock).
    mutating func penDown(at t: Double) {
        downAt = t
    }

    /// A finished stroke landed when the pen lifted at `t`. True when it joined the line being written
    /// (its pause before it is then one of the kid's pauses inside a line).
    @discardableResult
    mutating func stroke(_ box: BrainRect, at t: Double) -> Bool {
        let joined = line.map { Self.joins(box, $0) } ?? false
        if joined, let up = lastUpAt {
            // the pause is pen-up to pen-down; without a pen-down (a replay) pen-up to pen-up
            let down = downAt.map { $0 > up ? $0 : t } ?? t
            let pause = down - up
            if pause > 0 && pause < Self.longPauseMs {
                pauses.append(pause)
                if pauses.count > Self.keep { pauses.removeFirst(pauses.count - Self.keep) }
            }
        }
        line = joined ? line.map { $0.union(box) } : box
        lastUpAt = t
        downAt = nil
        return joined
    }

    /// How long after a pen-up a line that looks finished is read (ms); nil: not on a pause, this
    /// kid's long pauses are too long for it.
    var delayMs: Double? {
        guard pauses.count >= Self.minSamples else { return Self.defaultDelayMs }
        let sorted = pauses.sorted()
        let i = min(sorted.count - 1, max(0, Int((Self.percentile * Double(sorted.count)).rounded(.up)) - 1))
        let wait = sorted[i] + Self.marginMs
        return wait > Self.maxDelayMs ? nil : max(wait, Self.minDelayMs)
    }

    /// A Pencil hovering at `p` has left the line: under it or above it by more than half its
    /// height, before its start, or well past its end. (Thinking over the line, or over the place
    /// for the next glyph, is not leaving it.)
    func leftLine(_ p: AgathonBrain.Point) -> Bool {
        guard let b = line else { return false }
        let h = max(b.h, 24)
        return p.y > b.maxY + 0.6 * h || p.y < b.y - 0.8 * h || p.x < b.x - h || p.x > b.maxX + 4 * h
    }

    mutating func reset() {
        self = PenRhythm()
    }

    /// A stroke belongs with the line's ink: level with it and not far past its end, or over or
    /// under it (a fraction's parts, an exponent).
    static func joins(_ s: BrainRect, _ line: BrainRect) -> Bool {
        let h = max(line.h, s.h, 1)
        let level = min(s.maxY, line.maxY) - max(s.y, line.y)
        let smaller = max(min(s.h, line.h), 1)
        let near = s.x <= line.maxX + 2.5 * h && s.maxX >= line.x - h
        if level >= 0.3 * smaller && near { return true }
        let over = s.x <= line.maxX + 0.5 * h && s.maxX >= line.x - 0.5 * h
        let gap = max(line.y - s.maxY, s.y - line.maxY)
        return over && gap < 0.6 * h
    }
}

/// What a line's ink looks like before it is read (the page boxes of its strokes): enough to tell a
/// line that is probably finished from one still being written.
enum LineShape {
    /// The height of a glyph on the line: high among its strokes that are not flat bars (three in
    /// four are no taller), so the short strokes of an `x` or a `+` do not shrink it.
    static func glyphHeight(_ boxes: [BrainRect]) -> Double {
        let tall = boxes.filter { $0.h >= 0.5 * $0.w }.map(\.h).sorted()
        if !tall.isEmpty { return max(tall[min(tall.count - 1, tall.count * 3 / 4)], 1) }
        return max(boxes.map(\.h).max() ?? 1, 1)
    }

    /// A flat bar (a minus, half an `=`, a fraction bar).
    static func isBar(_ b: BrainRect, glyph: Double) -> Bool {
        b.w >= 2 * max(b.h, 1) && b.h <= 0.35 * glyph
    }

    /// The rightmost `=` on the line: two bars of about the same width, one above the other. Its box.
    static func equalsSign(_ boxes: [BrainRect]) -> BrainRect? {
        let glyph = glyphHeight(boxes)
        let bars = boxes.filter { isBar($0, glyph: glyph) }
        var best: BrainRect?
        for i in bars.indices {
            for j in bars.indices where j > i {
                let a = bars[i], b = bars[j]
                let overlap = min(a.maxX, b.maxX) - max(a.x, b.x)
                let ratio = min(a.w, b.w) / max(a.w, b.w, 1)
                let apart = abs((a.y + a.h / 2) - (b.y + b.h / 2))
                guard overlap >= 0.5 * min(a.w, b.w), ratio >= 0.5, apart >= 0.12 * glyph, apart <= 0.8 * glyph else { continue }
                let box = a.union(b)
                if best.map({ box.maxX > $0.maxX }) ?? true { best = box }
            }
        }
        return best
    }

    /// The line probably ends with the stroke just written (`last`): the stroke ends at the right
    /// of the line's ink, and the line is a relation whose right side is under way (`2x = 8`). With
    /// `answerAfterEquals` (Solve, or the grown-ups' "answer after =") a line that ends with its
    /// `=` is finished too (`36 + 2 =`: the answer is wanted). Anything else waits for the gate.
    static func looksFinished(_ boxes: [BrainRect], last: BrainRect, answerAfterEquals: Bool) -> Bool {
        guard !boxes.isEmpty else { return false }
        let glyph = glyphHeight(boxes)
        let right = boxes.map(\.maxX).max() ?? last.maxX
        guard last.maxX >= right - 0.5 * glyph, let eq = equalsSign(boxes) else { return false }
        let pastEquals = boxes.filter { $0.x >= eq.maxX - 0.15 * glyph }
        if pastEquals.isEmpty {
            // the `=` is the end of the line: finished only when an answer is wanted after it
            return answerAfterEquals && last.intersects(eq.expanded(1))
        }
        return last.x >= eq.maxX - 0.15 * glyph
    }
}
