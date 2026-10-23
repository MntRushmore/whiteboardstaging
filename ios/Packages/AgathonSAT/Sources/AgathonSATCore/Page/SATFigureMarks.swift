import Foundation

// "Write on the figure" (docs/SAT-V2.md): a question's plot is a board object the student can write
// on. The plot maps page ↔ graph coordinates, and what the student drew on it is understood in the
// graph's own terms ("circled near (2, 0)", "a line through about (0, 4) and (2, 0)") for the tutor's
// checks and hints. The ink itself stays ordinary ink.

/// A question's coordinate plane on its page: its grid's rect (page units, screen-relative) and the
/// axes' window.
public struct SATPlotMap: Hashable, Sendable {
    public var grid: SATRect
    public var x: SATPlot.Axis
    public var y: SATPlot.Axis

    public init(grid: SATRect, x: SATPlot.Axis, y: SATPlot.Axis) {
        self.grid = grid
        self.x = x
        self.y = y
    }

    public init?(layout: SATPageLayout, plot: SATPlot) {
        guard let grid = layout.plotGrid, plot.x.max > plot.x.min, plot.y.max > plot.y.min else { return nil }
        self.init(grid: grid, x: plot.x, y: plot.y)
    }

    /// The page point of graph point (gx, gy).
    public func page(_ gx: Double, _ gy: Double) -> (x: Double, y: Double) {
        let fx = (gx - x.min) / (x.max - x.min), fy = (gy - y.min) / (y.max - y.min)
        return (grid.x + fx * grid.w, grid.maxY - fy * grid.h)
    }

    /// The graph point under page point (px, py).
    public func graph(_ px: Double, _ py: Double) -> (x: Double, y: Double) {
        let fx = (px - grid.x) / max(1e-9, grid.w), fy = (grid.maxY - py) / max(1e-9, grid.h)
        return (x.min + fx * (x.max - x.min), y.min + fy * (y.max - y.min))
    }

    /// Graph units per page unit, across and up.
    public var unitsPerPage: (x: Double, y: Double) { ((x.max - x.min) / max(1e-9, grid.w), (y.max - y.min) / max(1e-9, grid.h)) }

    /// A page point over the grid (with a little slack round it: a circle round a point on the edge).
    public func covers(_ px: Double, _ py: Double, slack: Double = 24) -> Bool {
        grid.insetBy(-slack, -slack).contains(px, py)
    }
}

/// What a stroke on a figure is, and its words for the tutor.
public enum SATFigureMark: Hashable, Sendable {
    /// a closed loop round a place (its centre, graph units)
    case circled(x: Double, y: Double)
    /// a straight stroke from one place to another
    case line(x0: Double, y0: Double, x1: Double, y1: Double)
    /// a dot or a tick
    case dot(x: Double, y: Double)
    /// anything else: where it starts and ends
    case sketch(x0: Double, y0: Double, x1: Double, y1: Double)

    /// The words for the tutor ("circled near (2, 0)").
    public var words: String {
        func p(_ a: Double, _ b: Double) -> String { "(\(SATFigureMarks.number(a)), \(SATFigureMarks.number(b)))" }
        switch self {
        case .circled(let x, let y): return "circled near \(p(x, y))"
        case .line(let x0, let y0, let x1, let y1): return "a line through about \(p(x0, y0)) and \(p(x1, y1))"
        case .dot(let x, let y): return "a mark at about \(p(x, y))"
        case .sketch(let x0, let y0, let x1, let y1): return "a curve from about \(p(x0, y0)) to \(p(x1, y1))"
        }
    }
}

public enum SATFigureMarks {
    /// Shorter than this (page units) is a dot.
    public static let dotExtent = 22.0
    /// A stroke ending this close to its start (of its extent) and long enough to go round is closed.
    public static let closedGap = 0.35
    public static let closedLength = 2.2
    /// A stroke whose points stay this close to its chord (of the chord's length) is straight.
    public static let straightness = 0.09
    /// At most this many marks are told (the newest).
    public static let maxMarks = 6

    /// One stroke's points (page units) as a mark on `map`'s plane.
    public static func classify(_ points: [(x: Double, y: Double)], on map: SATPlotMap) -> SATFigureMark? {
        guard let first = points.first, let last = points.last else { return nil }
        let xs = points.map(\.x), ys = points.map(\.y)
        let minX = xs.min()!, maxX = xs.max()!, minY = ys.min()!, maxY = ys.max()!
        let extent = max(maxX - minX, maxY - minY)
        let step = (x: map.x.step, y: map.y.step)
        func g(_ px: Double, _ py: Double) -> (Double, Double) {
            let v = map.graph(px, py)
            return (snap(v.x, step.x), snap(v.y, step.y))
        }
        if extent < dotExtent {
            let c = g((minX + maxX) / 2, (minY + maxY) / 2)
            return .dot(x: c.0, y: c.1)
        }
        var length = 0.0
        for i in 1..<points.count { length += hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y) }
        let gap = hypot(last.x - first.x, last.y - first.y)
        if gap <= closedGap * extent && length >= closedLength * extent {
            let c = g((minX + maxX) / 2, (minY + maxY) / 2)
            return .circled(x: c.0, y: c.1)
        }
        let chord = gap
        if chord > dotExtent {
            let (dx, dy) = ((last.x - first.x) / chord, (last.y - first.y) / chord)
            let off = points.map { abs(($0.x - first.x) * dy - ($0.y - first.y) * dx) }.max() ?? 0
            if off <= straightness * chord {
                let a = g(first.x, first.y), b = g(last.x, last.y)
                // left to right, as a line is read
                return a.0 <= b.0 ? .line(x0: a.0, y0: a.1, x1: b.0, y1: b.1) : .line(x0: b.0, y0: b.1, x1: a.0, y1: a.1)
            }
        }
        let a = g(first.x, first.y), b = g(last.x, last.y)
        return .sketch(x0: a.0, y0: a.1, x1: b.0, y1: b.1)
    }

    /// What the student drew on the plane, as one line for the tutor's context; nil when nothing.
    public static func summary(_ strokes: [[(x: Double, y: Double)]], on map: SATPlotMap) -> String? {
        let marks = strokes.suffix(maxMarks).compactMap { classify($0, on: map) }
        guard !marks.isEmpty else { return nil }
        return "On the question's graph the student drew: " + marks.map(\.words).joined(separator: "; ") + "."
    }

    /// A graph value to the nearest half step (a hand is no finer than that).
    static func snap(_ v: Double, _ step: Double) -> Double {
        let q = step > 0 ? step / 2 : 0.5
        let r = (v / q).rounded() * q
        return abs(r) < q / 100 ? 0 : r
    }

    /// "2", "-1.5", "0.25".
    static func number(_ v: Double) -> String {
        let r = (v * 100).rounded() / 100
        if r == r.rounded() { return String(Int(r)) }
        return String(format: "%g", r)
    }
}
