import Foundation

/// The kinds of record in a board (schema v1). See docs/BOARD-FORMAT.md.
public enum RecordType: String, Codable, Sendable, CaseIterable {
    case screen, stroke, shape, image, math, graph, mark, line, problem

    /// Records drawn on a screen, in `order` (z-order: later is on top).
    public var isDrawable: Bool {
        switch self {
        case .stroke, .shape, .image, .math, .graph: return true
        default: return false
        }
    }
}

// MARK: - Screen

/// A 16:9 page of the board. A board is a stack of screens (at most `ScreenRecord.maxScreens`), never
/// an infinite canvas: the camera stays on the current one and the tutor reads one at a time.
public struct ScreenRecord: Equatable, Sendable {
    public static let maxScreens = 50

    public var id: RecordID
    /// The screens' order (fractional index).
    public var order: OrderKey
    /// The screen's rect in its own page space: 0,0,1600,900 for every new screen. A converted page
    /// that predates screens gets a 16:9 rect grown around its ink (the web's `screenForContent`).
    public var rect: Box
    public var name: String?
    public var meta: Meta

    public init(id: RecordID = .make(.screen), order: OrderKey, rect: Box = .screen, name: String? = nil, meta: Meta = [:]) {
        self.id = id
        self.order = order
        self.rect = rect
        self.name = name
        self.meta = meta
    }
}

// MARK: - Stroke

/// One pen-down … pen-up of ink: the kid's or the tutor's.
public struct StrokeRecord: Equatable, Sendable {
    public var id: RecordID
    public var screen: RecordID
    /// z-order on the screen (fractional index)
    public var order: OrderKey
    public var author: Author
    public var color: InkColor
    /// The pen's base width in page units (tldraw's `(STROKE_SIZES[size] + 1) × scale`: the kid's pen
    /// is 6, the grown-up pen 4.5, the tutor's hand 3 × its weight).
    public var width: Double
    public var pressure: PressureMode
    /// The stroke's origin on the screen; `points` are relative to it.
    public var x: Double
    public var y: Double
    /// radians, about the origin
    public var rotation: Double
    public var points: [InkPoint]
    /// Pen down, ms since the Unix epoch (replay). Nil on a converted stroke that was never timed.
    public var start: Double?
    /// The outline is closed (a shape the tutor shades): `fill` paints its inside.
    public var closed: Bool
    public var fill: FillStyle
    public var meta: Meta

    public init(
        id: RecordID = .make(.stroke), screen: RecordID, order: OrderKey, author: Author, color: InkColor,
        width: Double, pressure: PressureMode, x: Double = 0, y: Double = 0, rotation: Double = 0,
        points: [InkPoint], start: Double? = nil, closed: Bool = false, fill: FillStyle = .none, meta: Meta = [:]
    ) {
        self.id = id
        self.screen = screen
        self.order = order
        self.author = author
        self.color = color
        self.width = width
        self.pressure = pressure
        self.x = x
        self.y = y
        self.rotation = rotation
        self.points = points
        self.start = start
        self.closed = closed
        self.fill = fill
        self.meta = meta
    }

    /// The stroke as the store keeps it: points normalized to the compact encoding, and the kid's ink
    /// never in the tutor's colour.
    public func normalized() -> StrokeRecord {
        var s = self
        s.points = PointCodec.normalize(points)
        if s.author == .kid && s.color == .tutor { s.color = .blue }
        return s
    }

    /// Pen up, ms since the epoch (the last point's time after `start`).
    public var end: Double? {
        guard let start else { return nil }
        return start + Double(points.last?.t ?? 0)
    }

    /// A point of the stroke on the screen (page space).
    @inline(__always) public func pagePoint(_ p: InkPoint) -> Vec2 {
        let v = Vec2(Double(p.x), Double(p.y))
        return (rotation == 0 ? v : v.rotated(by: rotation)) + Vec2(x, y)
    }
}

// MARK: - Shape

public enum ShapeKind: String, Codable, Sendable {
    case rect, ellipse, line, arrow
}

/// A drawn shape from the Shapes tool: rectangle, ellipse, line or arrow.
public struct ShapeRecord: Equatable, Sendable {
    public var id: RecordID
    public var screen: RecordID
    public var order: OrderKey
    public var author: Author
    public var kind: ShapeKind
    public var x: Double
    public var y: Double
    public var rotation: Double
    /// rect, ellipse: the box (from x, y)
    public var w: Double
    public var h: Double
    /// line, arrow: the points (relative to x, y), first to last; an arrow's head is at the last
    public var points: [Vec2]
    public var color: InkColor
    public var width: Double
    public var fill: FillStyle
    public var meta: Meta

    public init(
        id: RecordID = .make(.shape), screen: RecordID, order: OrderKey, author: Author = .kid, kind: ShapeKind,
        x: Double, y: Double, rotation: Double = 0, w: Double = 0, h: Double = 0, points: [Vec2] = [],
        color: InkColor, width: Double, fill: FillStyle = .none, meta: Meta = [:]
    ) {
        self.id = id
        self.screen = screen
        self.order = order
        self.author = author
        self.kind = kind
        self.x = x
        self.y = y
        self.rotation = rotation
        self.w = w
        self.h = h
        self.points = points
        self.color = color
        self.width = width
        self.fill = fill
        self.meta = meta
    }
}

// MARK: - Image

/// Where an image's bytes are: the `board-assets` bucket's public URL (never a data URL in a saved board).
public struct AssetRef: Equatable, Sendable, Codable {
    public var src: String
    public var mime: String?
    /// the image's own size in pixels, when known
    public var w: Double?
    public var h: Double?

    public init(src: String, mime: String? = nil, w: Double? = nil, h: Double? = nil) {
        self.src = src
        self.mime = mime
        self.w = w
        self.h = h
    }
}

/// A picture or a PDF page on a screen.
public struct ImageRecord: Equatable, Sendable {
    public var id: RecordID
    public var screen: RecordID
    public var order: OrderKey
    public var author: Author
    public var x: Double
    public var y: Double
    public var w: Double
    public var h: Double
    public var rotation: Double
    public var asset: AssetRef
    public var meta: Meta

    public init(
        id: RecordID = .make(.image), screen: RecordID, order: OrderKey, author: Author = .kid,
        x: Double, y: Double, w: Double, h: Double, rotation: Double = 0, asset: AssetRef, meta: Meta = [:]
    ) {
        self.id = id
        self.screen = screen
        self.order = order
        self.author = author
        self.x = x
        self.y = y
        self.w = w
        self.h = h
        self.rotation = rotation
        self.asset = asset
        self.meta = meta
    }
}

// MARK: - Math

public enum MathRole: String, Codable, Sendable {
    /// the grey echo of what the tutor read from a line (shows on hover / when the hand is off)
    case readback
    /// typeset maths the tutor wrote (when its hand lacks a symbol)
    case answer
    /// a note or a typed line
    case note
}

/// Typeset maths (LaTeX). Rendered natively in Phase 1.
public struct MathRecord: Equatable, Sendable {
    public var id: RecordID
    public var screen: RecordID
    public var order: OrderKey
    public var author: Author
    public var role: MathRole
    public var latex: String
    public var x: Double
    public var y: Double
    public var w: Double
    public var h: Double
    /// the type size in page units (the web's MATH_FONT_PX: s 18, m 24, l 32)
    public var fontSize: Double
    /// the `line` this reads back or answers
    public var line: RecordID?
    public var meta: Meta

    public init(
        id: RecordID = .make(.math), screen: RecordID, order: OrderKey, author: Author = .tutor, role: MathRole,
        latex: String, x: Double, y: Double, w: Double, h: Double, fontSize: Double = 24, line: RecordID? = nil, meta: Meta = [:]
    ) {
        self.id = id
        self.screen = screen
        self.order = order
        self.author = author
        self.role = role
        self.latex = latex
        self.x = x
        self.y = y
        self.w = w
        self.h = h
        self.fontSize = fontSize
        self.line = line
        self.meta = meta
    }
}

// MARK: - Graph

public struct GraphFunction: Equatable, Sendable, Codable {
    public var id: String
    /// the engine's expression (mathjs syntax), what is plotted
    public var expr: String
    public var latex: String
    public var color: InkColor

    public init(id: String, expr: String, latex: String, color: InkColor = .tutor) {
        self.id = id
        self.expr = expr
        self.latex = latex
        self.color = color
    }
}

public struct GraphPoint: Equatable, Sendable, Codable {
    public var x: Double
    public var y: Double
    public var label: String

    public init(x: Double, y: Double, label: String = "") {
        self.x = x
        self.y = y
        self.label = label
    }
}

public struct GraphWindow: Equatable, Sendable, Codable {
    public var xMin: Double
    public var xMax: Double
    public var yMin: Double
    public var yMax: Double
    /// the y range follows the functions
    public var autoY: Bool

    public init(xMin: Double = -10, xMax: Double = 10, yMin: Double = -10, yMax: Double = 10, autoY: Bool = false) {
        self.xMin = xMin
        self.xMax = xMax
        self.yMin = yMin
        self.yMax = yMax
        self.autoY = autoY
    }
}

/// A plotted graph (the tutor's, or one asked for).
public struct GraphRecord: Equatable, Sendable {
    public var id: RecordID
    public var screen: RecordID
    public var order: OrderKey
    public var author: Author
    public var x: Double
    public var y: Double
    public var w: Double
    public var h: Double
    public var functions: [GraphFunction]
    public var points: [GraphPoint]
    public var window: GraphWindow
    public var grid: Bool
    public var title: String
    public var line: RecordID?
    public var meta: Meta

    public init(
        id: RecordID = .make(.graph), screen: RecordID, order: OrderKey, author: Author = .tutor,
        x: Double, y: Double, w: Double, h: Double, functions: [GraphFunction] = [], points: [GraphPoint] = [],
        window: GraphWindow = GraphWindow(), grid: Bool = true, title: String = "", line: RecordID? = nil, meta: Meta = [:]
    ) {
        self.id = id
        self.screen = screen
        self.order = order
        self.author = author
        self.x = x
        self.y = y
        self.w = w
        self.h = h
        self.functions = functions
        self.points = points
        self.window = window
        self.grid = grid
        self.title = title
        self.line = line
        self.meta = meta
    }
}

// MARK: - Semantic records (not drawn)

public enum MarkKind: String, Codable, Sendable {
    case tick, ring, question
}

/// A tutor's mark on a line. Its ink is ordinary tutor strokes (`strokes`), drawn in the tutor's hand;
/// this record says what they mean.
public struct MarkRecord: Equatable, Sendable {
    public var id: RecordID
    public var screen: RecordID
    public var kind: MarkKind
    /// the line it marks
    public var target: RecordID?
    /// the tutor strokes that draw it
    public var strokes: [RecordID]
    /// why: `mismatch`, `warn`, `unread`, `unjudged` … (the web's `meta.markWhy`)
    public var why: String?
    public var meta: Meta

    public init(id: RecordID = .make(.mark), screen: RecordID, kind: MarkKind, target: RecordID? = nil, strokes: [RecordID] = [], why: String? = nil, meta: Meta = [:]) {
        self.id = id
        self.screen = screen
        self.kind = kind
        self.target = target
        self.strokes = strokes
        self.why = why
        self.meta = meta
    }
}

public enum Verdict: String, Codable, Sendable {
    case none, pending, ok, warn, unknown, solved
}

/// A line of the kid's work as the recognizer read it: the strokes read together and what they say.
public struct LineRecord: Equatable, Sendable {
    public var id: RecordID
    public var screen: RecordID
    public var strokes: [RecordID]
    public var latex: String
    public var verdict: Verdict
    public var problem: RecordID?
    public var meta: Meta

    public init(id: RecordID = .make(.line), screen: RecordID, strokes: [RecordID], latex: String = "", verdict: Verdict = .none, problem: RecordID? = nil, meta: Meta = [:]) {
        self.id = id
        self.screen = screen
        self.strokes = strokes
        self.latex = latex
        self.verdict = verdict
        self.problem = problem
        self.meta = meta
    }
}

/// A problem being worked: its lines in order (the statement first, when there is one).
public struct ProblemRecord: Equatable, Sendable {
    public var id: RecordID
    public var screen: RecordID
    public var lines: [RecordID]
    /// the problem as LaTeX, when known (a problem the tutor wrote)
    public var latex: String?
    /// where it came from: `student`, `chat`, `practice`, `nowYouTry`, `tour`, `taught`
    public var origin: String?
    public var meta: Meta

    public init(id: RecordID = .make(.problem), screen: RecordID, lines: [RecordID] = [], latex: String? = nil, origin: String? = nil, meta: Meta = [:]) {
        self.id = id
        self.screen = screen
        self.lines = lines
        self.latex = latex
        self.origin = origin
        self.meta = meta
    }
}

/// A record of a type this build does not know (a newer app's), kept whole.
public struct UnknownRecord: Equatable, Sendable {
    public var id: RecordID
    public var type: String
    public var json: [String: JSONValue]
}

// MARK: - BoardRecord

/// Any record of the store.
public enum BoardRecord: Equatable, Sendable {
    case screen(ScreenRecord)
    case stroke(StrokeRecord)
    case shape(ShapeRecord)
    case image(ImageRecord)
    case math(MathRecord)
    case graph(GraphRecord)
    case mark(MarkRecord)
    case line(LineRecord)
    case problem(ProblemRecord)
    case unknown(UnknownRecord)

    public var id: RecordID {
        switch self {
        case .screen(let r): return r.id
        case .stroke(let r): return r.id
        case .shape(let r): return r.id
        case .image(let r): return r.id
        case .math(let r): return r.id
        case .graph(let r): return r.id
        case .mark(let r): return r.id
        case .line(let r): return r.id
        case .problem(let r): return r.id
        case .unknown(let r): return r.id
        }
    }

    /// nil for an unknown record
    public var type: RecordType? {
        switch self {
        case .screen: return .screen
        case .stroke: return .stroke
        case .shape: return .shape
        case .image: return .image
        case .math: return .math
        case .graph: return .graph
        case .mark: return .mark
        case .line: return .line
        case .problem: return .problem
        case .unknown: return nil
        }
    }

    /// The screen a record belongs to (nil for a screen itself, or an unknown record).
    public var screenID: RecordID? {
        switch self {
        case .screen, .unknown: return nil
        case .stroke(let r): return r.screen
        case .shape(let r): return r.screen
        case .image(let r): return r.screen
        case .math(let r): return r.screen
        case .graph(let r): return r.screen
        case .mark(let r): return r.screen
        case .line(let r): return r.screen
        case .problem(let r): return r.screen
        }
    }

    /// z-order of a drawn record, the order of a screen; nil for the rest.
    public var order: OrderKey? {
        switch self {
        case .screen(let r): return r.order
        case .stroke(let r): return r.order
        case .shape(let r): return r.order
        case .image(let r): return r.order
        case .math(let r): return r.order
        case .graph(let r): return r.order
        default: return nil
        }
    }

    public var isDrawable: Bool { type?.isDrawable ?? false }

    public var author: Author? {
        switch self {
        case .stroke(let r): return r.author
        case .shape(let r): return r.author
        case .image(let r): return r.author
        case .math(let r): return r.author
        case .graph(let r): return r.author
        case .mark, .line, .problem: return .tutor
        default: return nil
        }
    }

    public var meta: Meta {
        switch self {
        case .screen(let r): return r.meta
        case .stroke(let r): return r.meta
        case .shape(let r): return r.meta
        case .image(let r): return r.meta
        case .math(let r): return r.meta
        case .graph(let r): return r.meta
        case .mark(let r): return r.meta
        case .line(let r): return r.meta
        case .problem(let r): return r.meta
        case .unknown: return [:]
        }
    }

    public var stroke: StrokeRecord? {
        if case .stroke(let s) = self { return s }
        return nil
    }

    public var screen: ScreenRecord? {
        if case .screen(let s) = self { return s }
        return nil
    }
}
