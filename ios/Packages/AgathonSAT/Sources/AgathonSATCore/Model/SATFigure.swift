import Foundation

// A question's figure (the `figure` jsonb), drawn natively by the iPad, never an image: a table, a
// coordinate plane, or a geometry figure. Field for field as the web's `SatFigureSchema`
// (src/lib/sat/contracts.ts). An item of a type this build does not know is kept as `.unknown` and
// not drawn, so a newer bank never breaks an older app.

public enum SATFigure: Codable, Hashable, Sendable {
    case table(SATTable)
    case plot(SATPlot)
    case shape(SATShape)

    enum Kind: String, CodingKey { case kind }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Kind.self)
        switch try c.decode(String.self, forKey: .kind) {
        case "table": self = .table(try SATTable(from: decoder))
        case "plot": self = .plot(try SATPlot(from: decoder))
        case "shape": self = .shape(try SATShape(from: decoder))
        case let other:
            throw DecodingError.dataCorruptedError(forKey: .kind, in: c, debugDescription: "unknown figure kind \(other)")
        }
    }

    public func encode(to encoder: Encoder) throws {
        switch self {
        case .table(let t): try t.encode(to: encoder)
        case .plot(let p): try p.encode(to: encoder)
        case .shape(let s): try s.encode(to: encoder)
        }
    }

    /// "Note: Figure not drawn to scale." and the like.
    public var note: String? {
        switch self {
        case .table(let t): t.note
        case .plot(let p): p.note
        case .shape(let s): s.note
        }
    }

    public var kind: String {
        switch self {
        case .table: "table"
        case .plot: "plot"
        case .shape: "shape"
        }
    }
}

/// A point `[x, y]`.
public struct SATPoint: Codable, Hashable, Sendable {
    public var x: Double
    public var y: Double

    public init(_ x: Double, _ y: Double) {
        self.x = x
        self.y = y
    }

    public init(from decoder: Decoder) throws {
        var c = try decoder.unkeyedContainer()
        x = try c.decode(Double.self)
        y = try c.decode(Double.self)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.unkeyedContainer()
        try c.encode(x)
        try c.encode(y)
    }
}

// MARK: - table

public struct SATTable: Codable, Hashable, Sendable {
    public var headers: [String]
    public var rows: [[String]]
    public var note: String?

    public init(headers: [String], rows: [[String]], note: String? = nil) {
        self.headers = headers
        self.rows = rows
        self.note = note
    }

    enum CodingKeys: String, CodingKey { case kind, headers, rows, note }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        headers = try c.decode([String].self, forKey: .headers)
        rows = try c.decode([[String]].self, forKey: .rows)
        note = try c.decodeIfPresent(String.self, forKey: .note)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode("table", forKey: .kind)
        try c.encode(headers, forKey: .headers)
        try c.encode(rows, forKey: .rows)
        try c.encodeIfPresent(note, forKey: .note)
    }
}

// MARK: - plot

/// A coordinate plane with lines, segments, points or bars on it.
public struct SATPlot: Codable, Hashable, Sendable {
    public struct Axis: Codable, Hashable, Sendable {
        public var min: Double
        public var max: Double
        public var step: Double
        public var label: String?

        public init(min: Double, max: Double, step: Double, label: String? = nil) {
            self.min = min
            self.max = max
            self.step = step
            self.label = label
        }

        /// The tick values from `min` to `max` (at most 41, so a step too small for its range never
        /// floods the axis).
        public var ticks: [Double] {
            guard step > 0, max > min else { return [] }
            let first = (min / step).rounded(.up) * step
            var out: [Double] = []
            var v = first
            while v <= max + step * 1e-6 && out.count < 41 {
                out.append(abs(v) < step * 1e-9 ? 0 : v)
                v += step
            }
            return out
        }
    }

    public enum Item: Codable, Hashable, Sendable {
        /// `expr` is a JavaScript-style expression in x ("2*x+1"); `domain` limits it
        case function(expr: String, label: String?, dashed: Bool, domain: [Double]?)
        case segment(from: SATPoint, to: SATPoint, label: String?, dashed: Bool)
        case point(at: SATPoint, label: String?, open: Bool)
        case bar(x: Double, height: Double, label: String?, width: Double?)
        case unknown(String)

        enum CodingKeys: String, CodingKey { case type, expr, label, dashed, domain, from, to, at, open, x, height, width }

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            let type = try c.decode(String.self, forKey: .type)
            let label = try c.decodeIfPresent(String.self, forKey: .label)
            let dashed = try c.decodeIfPresent(Bool.self, forKey: .dashed) ?? false
            switch type {
            case "function":
                self = .function(expr: try c.decode(String.self, forKey: .expr), label: label, dashed: dashed,
                                 domain: try c.decodeIfPresent([Double].self, forKey: .domain))
            case "segment":
                self = .segment(from: try c.decode(SATPoint.self, forKey: .from), to: try c.decode(SATPoint.self, forKey: .to), label: label, dashed: dashed)
            case "point":
                self = .point(at: try c.decode(SATPoint.self, forKey: .at), label: label, open: try c.decodeIfPresent(Bool.self, forKey: .open) ?? false)
            case "bar":
                self = .bar(x: try c.decode(Double.self, forKey: .x), height: try c.decode(Double.self, forKey: .height), label: label,
                            width: try c.decodeIfPresent(Double.self, forKey: .width))
            default:
                self = .unknown(type)
            }
        }

        public func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            switch self {
            case .function(let expr, let label, let dashed, let domain):
                try c.encode("function", forKey: .type)
                try c.encode(expr, forKey: .expr)
                try c.encodeIfPresent(label, forKey: .label)
                if dashed { try c.encode(true, forKey: .dashed) }
                try c.encodeIfPresent(domain, forKey: .domain)
            case .segment(let from, let to, let label, let dashed):
                try c.encode("segment", forKey: .type)
                try c.encode(from, forKey: .from)
                try c.encode(to, forKey: .to)
                try c.encodeIfPresent(label, forKey: .label)
                if dashed { try c.encode(true, forKey: .dashed) }
            case .point(let at, let label, let open):
                try c.encode("point", forKey: .type)
                try c.encode(at, forKey: .at)
                try c.encodeIfPresent(label, forKey: .label)
                if open { try c.encode(true, forKey: .open) }
            case .bar(let x, let height, let label, let width):
                try c.encode("bar", forKey: .type)
                try c.encode(x, forKey: .x)
                try c.encode(height, forKey: .height)
                try c.encodeIfPresent(label, forKey: .label)
                try c.encodeIfPresent(width, forKey: .width)
            case .unknown(let type):
                try c.encode(type, forKey: .type)
            }
        }
    }

    public var x: Axis
    public var y: Axis
    /// grid lines at every tick (default on)
    public var grid: Bool
    public var items: [Item]
    public var note: String?

    public init(x: Axis, y: Axis, grid: Bool = true, items: [Item], note: String? = nil) {
        self.x = x
        self.y = y
        self.grid = grid
        self.items = items
        self.note = note
    }

    enum CodingKeys: String, CodingKey { case kind, x, y, grid, items, note }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        x = try c.decode(Axis.self, forKey: .x)
        y = try c.decode(Axis.self, forKey: .y)
        grid = try c.decodeIfPresent(Bool.self, forKey: .grid) ?? true
        items = try c.decode([Item].self, forKey: .items)
        note = try c.decodeIfPresent(String.self, forKey: .note)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode("plot", forKey: .kind)
        try c.encode(x, forKey: .x)
        try c.encode(y, forKey: .y)
        try c.encode(grid, forKey: .grid)
        try c.encode(items, forKey: .items)
        try c.encodeIfPresent(note, forKey: .note)
    }

    /// A bar chart (bars only, besides any line drawn over them): the x axis shows the bars' labels.
    public var isBarChart: Bool {
        items.contains { if case .bar = $0 { return true } else { return false } }
    }
}

// MARK: - shape

/// A geometry figure in its own units, y up.
public struct SATShape: Codable, Hashable, Sendable {
    public enum Item: Codable, Hashable, Sendable {
        case polygon(points: [SATPoint], dashed: Bool)
        case circle(center: SATPoint, r: Double, dashed: Bool)
        case segment(from: SATPoint, to: SATPoint, dashed: Bool)
        case point(at: SATPoint, label: String?)
        /// a label's text may hold `$…$` LaTeX
        case label(at: SATPoint, text: String)
        /// the small square at a right angle: its corner and the two directions of its sides
        case rightAngle(at: SATPoint, dirs: [SATPoint])
        /// an angle's arc at a vertex, from one direction to another (degrees, counterclockwise from +x)
        case arcAngle(at: SATPoint, from: Double, to: Double, label: String?)
        case unknown(String)

        enum CodingKeys: String, CodingKey { case type, points, dashed, center, r, from, to, at, label, text, dirs }

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            let type = try c.decode(String.self, forKey: .type)
            let dashed = try c.decodeIfPresent(Bool.self, forKey: .dashed) ?? false
            switch type {
            case "polygon":
                self = .polygon(points: try c.decode([SATPoint].self, forKey: .points), dashed: dashed)
            case "circle":
                self = .circle(center: try c.decode(SATPoint.self, forKey: .center), r: try c.decode(Double.self, forKey: .r), dashed: dashed)
            case "segment":
                self = .segment(from: try c.decode(SATPoint.self, forKey: .from), to: try c.decode(SATPoint.self, forKey: .to), dashed: dashed)
            case "point":
                self = .point(at: try c.decode(SATPoint.self, forKey: .at), label: try c.decodeIfPresent(String.self, forKey: .label))
            case "label":
                self = .label(at: try c.decode(SATPoint.self, forKey: .at), text: try c.decode(String.self, forKey: .text))
            case "right_angle":
                self = .rightAngle(at: try c.decode(SATPoint.self, forKey: .at), dirs: try c.decode([SATPoint].self, forKey: .dirs))
            case "arc_angle":
                self = .arcAngle(at: try c.decode(SATPoint.self, forKey: .at), from: try c.decode(Double.self, forKey: .from),
                                 to: try c.decode(Double.self, forKey: .to), label: try c.decodeIfPresent(String.self, forKey: .label))
            default:
                self = .unknown(type)
            }
        }

        public func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            switch self {
            case .polygon(let points, let dashed):
                try c.encode("polygon", forKey: .type)
                try c.encode(points, forKey: .points)
                if dashed { try c.encode(true, forKey: .dashed) }
            case .circle(let center, let r, let dashed):
                try c.encode("circle", forKey: .type)
                try c.encode(center, forKey: .center)
                try c.encode(r, forKey: .r)
                if dashed { try c.encode(true, forKey: .dashed) }
            case .segment(let from, let to, let dashed):
                try c.encode("segment", forKey: .type)
                try c.encode(from, forKey: .from)
                try c.encode(to, forKey: .to)
                if dashed { try c.encode(true, forKey: .dashed) }
            case .point(let at, let label):
                try c.encode("point", forKey: .type)
                try c.encode(at, forKey: .at)
                try c.encodeIfPresent(label, forKey: .label)
            case .label(let at, let text):
                try c.encode("label", forKey: .type)
                try c.encode(at, forKey: .at)
                try c.encode(text, forKey: .text)
            case .rightAngle(let at, let dirs):
                try c.encode("right_angle", forKey: .type)
                try c.encode(at, forKey: .at)
                try c.encode(dirs, forKey: .dirs)
            case .arcAngle(let at, let from, let to, let label):
                try c.encode("arc_angle", forKey: .type)
                try c.encode(at, forKey: .at)
                try c.encode(from, forKey: .from)
                try c.encode(to, forKey: .to)
                try c.encodeIfPresent(label, forKey: .label)
            case .unknown(let type):
                try c.encode(type, forKey: .type)
            }
        }
    }

    public var items: [Item]
    public var note: String?

    public init(items: [Item], note: String? = nil) {
        self.items = items
        self.note = note
    }

    enum CodingKeys: String, CodingKey { case kind, items, note }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        items = try c.decode([Item].self, forKey: .items)
        note = try c.decodeIfPresent(String.self, forKey: .note)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode("shape", forKey: .kind)
        try c.encode(items, forKey: .items)
        try c.encodeIfPresent(note, forKey: .note)
    }

    /// Everything the figure draws, in its own units (labels as points; a circle as its box).
    public var bounds: (minX: Double, minY: Double, maxX: Double, maxY: Double)? {
        var xs: [Double] = []
        var ys: [Double] = []
        func add(_ p: SATPoint) {
            xs.append(p.x)
            ys.append(p.y)
        }
        for item in items {
            switch item {
            case .polygon(let points, _): points.forEach(add)
            case .circle(let c, let r, _):
                add(SATPoint(c.x - r, c.y - r))
                add(SATPoint(c.x + r, c.y + r))
            case .segment(let a, let b, _):
                add(a)
                add(b)
            case .point(let at, _), .label(let at, _), .rightAngle(let at, _), .arcAngle(let at, _, _, _): add(at)
            case .unknown: break
            }
        }
        guard let x0 = xs.min(), let x1 = xs.max(), let y0 = ys.min(), let y1 = ys.max() else { return nil }
        return (x0, y0, x1, y1)
    }
}
