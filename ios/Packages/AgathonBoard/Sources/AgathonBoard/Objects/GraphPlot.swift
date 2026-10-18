import CoreGraphics
import Foundation

/// A graph record's picture, worked out: each function sampled across the window and cut at its
/// asymptotes, the y range (fixed, or following the functions), the ticks, grid, axes and points.
/// A port of the web's `buildPlot` (src/shapes/graph/plot.ts) with the same numbers (240 samples, a
/// break where a jump spans 8 views or reverses past the edge, ticks at 1/2/5·10ⁿ), so a converted
/// graph plots as it did. Coordinates are in the plot area's own space: (0, 0) top-left, y down.
public struct GraphPlot: Sendable, Equatable {
    public struct Curve: Sendable, Equatable {
        public var id: String
        public var color: InkColor
        /// one polyline per continuous run (an asymptote starts a new one)
        public var runs: [[CGPoint]]
    }

    public struct Label: Sendable, Equatable {
        public enum Axis: Sendable { case x, y }
        public var at: CGPoint
        public var text: String
        public var axis: Axis
    }

    public struct Point: Sendable, Equatable {
        public var at: CGPoint
        public var x: Double
        public var y: Double
        public var label: String
    }

    public var w: Double
    public var h: Double
    public var curves: [Curve]
    public var xRange: ClosedRange<Double>
    public var yRange: ClosedRange<Double>
    public var xTicks: [Double]
    public var yTicks: [Double]
    /// the plot coordinate of the y axis (x = 0) and the x axis (y = 0), nil when off the window
    public var axisX: Double?
    public var axisY: Double?
    public var gridLines: [(CGPoint, CGPoint)]
    public var labels: [Label]
    public var points: [Point]

    public static func == (a: GraphPlot, b: GraphPlot) -> Bool {
        a.w == b.w && a.h == b.h && a.curves == b.curves && a.xRange == b.xRange && a.yRange == b.yRange
            && a.xTicks == b.xTicks && a.yTicks == b.yTicks && a.axisX == b.axisX && a.axisY == b.axisY
            && a.labels == b.labels && a.points == b.points && a.gridLines.count == b.gridLines.count
    }

    /// A jump between neighbouring samples wider than this many y-ranges is an asymptote.
    public static let breakFactor = 8.0
    public static let defaultSamples = 240
    /// room inside the edges so a stroke on the edge is not clipped
    public static let pad = 4.0

    public struct Function: Sendable {
        public var id: String
        public var color: InkColor
        public var sampler: MathExpr.Sampler?

        public init(id: String, color: InkColor, sampler: MathExpr.Sampler?) {
            self.id = id
            self.color = color
            self.sampler = sampler
        }
    }

    /// The plot of a graph record in a `w` × `h` area. Functions compile with `MathExpr` (at most 6,
    /// as the web draws).
    public static func build(_ g: GraphRecord, w: Double, h: Double, samples: Int = defaultSamples, tickSize: Double = 9) -> GraphPlot {
        let fns = g.functions.prefix(6).map { Function(id: $0.id, color: $0.color, sampler: MathExpr.compile($0.expr)) }
        return build(fns, points: g.points, window: g.window, grid: g.grid, w: w, h: h, samples: samples, tickSize: tickSize)
    }

    public static func build(
        _ fns: [Function], points: [GraphPoint], window: GraphWindow, grid: Bool, w: Double, h: Double,
        samples: Int = defaultSamples, tickSize: Double = 9
    ) -> GraphPlot {
        let w = max(1, w), h = max(1, h)
        let n = max(8, samples)
        let (xMin, xMax) = normalize(window.xMin, window.xMax)

        // 1. sample
        let xs = (0...n).map { xMin + (xMax - xMin) * Double($0) / Double(n) }
        let sampled: [[Double]?] = fns.map { f in
            guard let s = f.sampler else { return nil }
            return xs.map { x in
                let y = s(x)
                return y.isFinite ? y : (y.isNaN ? .nan : y)
            }
        }

        // 2. y range
        let yMin: Double, yMax: Double
        if window.autoY {
            var all: [Double] = []
            for ys in sampled { if let ys { all += ys.filter(\.isFinite) } }
            all += points.map(\.y).filter(\.isFinite)
            (yMin, yMax) = autoYRange(all, fallback: (window.yMin, window.yMax))
        } else {
            (yMin, yMax) = normalize(window.yMin, window.yMax)
        }
        let ySpan = yMax - yMin, xSpan = xMax - xMin
        func sx(_ x: Double) -> Double { pad + (x - xMin) / xSpan * (w - pad * 2) }
        func sy(_ y: Double) -> Double { h - pad - (y - yMin) / ySpan * (h - pad * 2) }
        func clampY(_ y: Double) -> Double { min(yMax + ySpan, max(yMin - ySpan, y)) }

        // 3. runs, broken at asymptotes
        var curves: [Curve] = []
        for (fi, f) in fns.enumerated() {
            guard let ys = sampled[fi] else { continue }
            var runs: [[CGPoint]] = []
            var run: [CGPoint] = []
            var prevY = Double.nan
            var prevDir = 0.0
            var open = false
            for i in 0...n {
                let y = ys[i]
                let finite = y.isFinite
                var jump = false
                if open && finite {
                    let dy = y - prevY
                    let dir = dy > 0 ? 1.0 : dy < 0 ? -1.0 : 0
                    jump = abs(dy) > breakFactor * ySpan
                        || (abs(dy) > ySpan && prevDir != 0 && dir != 0 && dir != prevDir)
                        || (prevY > yMax && y < yMin && dir != prevDir)
                        || (prevY < yMin && y > yMax && dir != prevDir)
                    prevDir = jump ? 0 : dir
                } else {
                    prevDir = 0
                }
                if !finite || jump {
                    if run.count > 0 { runs.append(run) }
                    run = []
                    open = false
                    prevY = .nan
                    if !finite { continue }
                }
                run.append(CGPoint(x: sx(xs[i]), y: sy(clampY(y))))
                open = true
                prevY = y
            }
            if run.count > 0 { runs.append(run) }
            if !runs.isEmpty { curves.append(Curve(id: f.id, color: f.color, runs: runs)) }
        }

        // 4. ticks, grid, axes, labels
        let xTicks = niceTicks(xMin, xMax, target: max(3, Int((w / 50).rounded())))
        let yTicks = niceTicks(yMin, yMax, target: max(3, Int((h / 40).rounded())))
        var gridLines: [(CGPoint, CGPoint)] = []
        if grid {
            for t in xTicks { gridLines.append((CGPoint(x: sx(t), y: pad), CGPoint(x: sx(t), y: h - pad))) }
            for t in yTicks { gridLines.append((CGPoint(x: pad, y: sy(t)), CGPoint(x: w - pad, y: sy(t)))) }
        }
        let x0: Double? = xMin <= 0 && xMax >= 0 ? sx(0) : nil
        let y0: Double? = yMin <= 0 && yMax >= 0 ? sy(0) : nil
        let labelX = x0 ?? (xMin > 0 ? pad : w - pad)
        let labelY = y0 ?? (yMin > 0 ? h - pad : pad)
        var labels: [Label] = []
        for t in xTicks {
            if t == 0 && x0 != nil && y0 != nil { continue }
            let text = formatTick(t)
            labels.append(Label(at: CGPoint(x: clampLabelX(sx(t), text, w: w, size: tickSize), y: min(h - 2, labelY + tickSize + 2)), text: text, axis: .x))
        }
        for t in yTicks {
            if t == 0 && x0 != nil && y0 != nil { continue }
            let text = formatTick(t)
            let x = min(max(2, labelX + 3), max(2, w - 1 - labelWidth(text, size: tickSize)))
            labels.append(Label(at: CGPoint(x: x, y: max(tickSize, sy(t) - 2)), text: text, axis: .y))
        }
        let pts = points.filter { $0.x.isFinite && $0.y.isFinite }
            .map { Point(at: CGPoint(x: sx($0.x), y: sy(clampY($0.y))), x: $0.x, y: $0.y, label: $0.label) }

        return GraphPlot(
            w: w, h: h, curves: curves, xRange: xMin...xMax, yRange: yMin...yMax, xTicks: xTicks, yTicks: yTicks,
            axisX: x0, axisY: y0, gridLines: gridLines, labels: labels, points: pts)
    }

    // MARK: - The web's helpers (plot.ts)

    static func normalize(_ a: Double, _ b: Double) -> (Double, Double) {
        if !a.isFinite || !b.isFinite { return (-10, 10) }
        if b < a { return (b, a) }
        if a == b { return (a - 1, b + 1) }
        return (a, b)
    }

    public static func niceStep(_ raw: Double) -> Double {
        guard raw > 0, raw.isFinite else { return 1 }
        let e = floor(log10(raw))
        let base = pow(10, e)
        let f = raw / base
        let nice: Double = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10
        return nice * base
    }

    /// Ticks at multiples of a 1/2/5·10ⁿ step covering `lo…hi`, about `target` of them.
    public static func niceTicks(_ lo: Double, _ hi: Double, target: Int = 6) -> [Double] {
        guard lo.isFinite, hi.isFinite else { return [] }
        var a = lo, b = hi
        if b < a { swap(&a, &b) }
        let range = b - a
        if range == 0 { return [a] }
        let step = niceStep(range / Double(max(1, target)))
        let first = ceil(a / step - 1e-9) * step
        var out: [Double] = []
        var v = first
        while v <= b + step * 1e-9 && out.count < 200 {
            let r = (v / step).rounded() * step
            out.append(abs(r) < step * 1e-9 ? 0 : Double(String(format: "%.12g", r)) ?? r)
            v += step
        }
        return out
    }

    static func percentile(_ sorted: [Double], _ p: Double) -> Double {
        guard !sorted.isEmpty else { return .nan }
        let idx = Double(sorted.count - 1) * p
        let lo = Int(floor(idx)), hi = Int(ceil(idx))
        if lo == hi { return sorted[lo] }
        let t = idx - Double(lo)
        return sorted[lo] * (1 - t) + sorted[hi] * t
    }

    /// The padded 5th–95th percentile range of the values (the web's `autoYRange`).
    public static func autoYRange(_ values: [Double], fallback: (Double, Double)) -> (Double, Double) {
        let finite = values.filter(\.isFinite).sorted()
        if finite.isEmpty { return normalize(fallback.0, fallback.1) }
        var lo = percentile(finite, 0.05)
        var hi = percentile(finite, 0.95)
        if hi - lo < 1e-9 {
            let pad = max(1, abs(lo) * 0.5)
            let c = lo
            lo = c - pad
            hi = c + pad
        } else {
            let pad = (hi - lo) * 0.1
            lo -= pad
            hi += pad
        }
        // keep the x axis in view when it is close
        if lo > 0 && lo < (hi - lo) * 0.5 { lo = 0 }
        if hi < 0 && -hi < (hi - lo) * 0.5 { hi = 0 }
        return (lo, hi)
    }

    public static func formatTick(_ v: Double) -> String {
        if abs(v) >= 1e6 || (abs(v) < 1e-4 && v != 0) { return String(format: "%.1e", v) }
        // six significant digits, no trailing zeros (JavaScript's Number(v.toPrecision(6)).toString())
        var s = String(format: "%.6g", v)
        if s.contains("e") { return s }
        if s.contains(".") {
            while s.hasSuffix("0") { s.removeLast() }
            if s.hasSuffix(".") { s.removeLast() }
        }
        return s == "-0" ? "0" : s
    }

    static func labelWidth(_ text: String, size: Double) -> Double { Double(text.count) * size * 0.6 }

    static func clampLabelX(_ x: Double, _ text: String, w: Double, size: Double) -> Double {
        let half = labelWidth(text, size: size) / 2 + 1
        if w <= half * 2 { return w / 2 }
        return min(w - half, max(half, x))
    }
}
