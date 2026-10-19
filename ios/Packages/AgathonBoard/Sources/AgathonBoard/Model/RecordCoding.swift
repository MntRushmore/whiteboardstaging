import Foundation

/// JSON coding of the records (schema v1). Defaults are left out (`rotation` 0, `closed` false,
/// `fill` none, empty `meta`…) so a board stays small; docs/BOARD-FORMAT.md lists every field.

struct AnyKey: CodingKey, Hashable {
    var stringValue: String
    var intValue: Int? { nil }
    init(_ s: String) { stringValue = s }
    init?(stringValue: String) { self.stringValue = stringValue }
    init?(intValue: Int) { nil }
}

extension KeyedDecodingContainer where K == AnyKey {
    @inline(__always) func req<T: Decodable>(_ key: String, _ type: T.Type = T.self) throws -> T {
        try decode(T.self, forKey: AnyKey(key))
    }

    @inline(__always) func opt<T: Decodable>(_ key: String, _ type: T.Type = T.self) throws -> T? {
        try decodeIfPresent(T.self, forKey: AnyKey(key))
    }

    @inline(__always) func meta() throws -> Meta {
        try decodeIfPresent(Meta.self, forKey: AnyKey("meta")) ?? [:]
    }
}

extension KeyedEncodingContainer where K == AnyKey {
    @inline(__always) mutating func put<T: Encodable>(_ key: String, _ value: T) throws {
        try encode(value, forKey: AnyKey(key))
    }

    @inline(__always) mutating func putIf<T: Encodable>(_ key: String, _ value: T?) throws {
        if let value { try encode(value, forKey: AnyKey(key)) }
    }

    @inline(__always) mutating func putUnless<T: Encodable & Equatable>(_ key: String, _ value: T, _ dflt: T) throws {
        if value != dflt { try encode(value, forKey: AnyKey(key)) }
    }

    @inline(__always) mutating func putMeta(_ meta: Meta) throws {
        if !meta.isEmpty { try encode(meta, forKey: AnyKey("meta")) }
    }
}

extension BoardRecord: Codable {
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: AnyKey.self)
        let type = try c.req("type", String.self)
        let id = try c.req("id", RecordID.self)
        switch RecordType(rawValue: type) {
        case .screen:
            self = .screen(ScreenRecord(id: id, order: try c.req("order"), rect: try c.req("rect"), name: try c.opt("name"), meta: try c.meta()))
        case .stroke:
            let encoded = try c.req("points", String.self)
            let points: [InkPoint]
            do {
                points = try PointCodec.decode(encoded)
            } catch {
                throw DecodingError.dataCorruptedError(forKey: AnyKey("points"), in: c, debugDescription: "points: \(error)")
            }
            self = .stroke(StrokeRecord(
                id: id, screen: try c.req("screen"), order: try c.req("order"), author: try c.req("author"),
                color: try c.req("color"), width: try c.req("width"), pressure: try c.req("pressure"),
                x: try c.req("x"), y: try c.req("y"), rotation: try c.opt("rotation") ?? 0, points: points,
                start: try c.opt("start"), closed: try c.opt("closed") ?? false, fill: try c.opt("fill") ?? .none, meta: try c.meta()))
        case .shape:
            self = .shape(ShapeRecord(
                id: id, screen: try c.req("screen"), order: try c.req("order"), author: try c.opt("author") ?? .kid,
                kind: try c.req("kind"), x: try c.req("x"), y: try c.req("y"), rotation: try c.opt("rotation") ?? 0,
                w: try c.opt("w") ?? 0, h: try c.opt("h") ?? 0, points: try c.opt("points") ?? [],
                color: try c.req("color"), width: try c.req("width"), fill: try c.opt("fill") ?? .none, meta: try c.meta()))
        case .image:
            self = .image(ImageRecord(
                id: id, screen: try c.req("screen"), order: try c.req("order"), author: try c.opt("author") ?? .kid,
                x: try c.req("x"), y: try c.req("y"), w: try c.req("w"), h: try c.req("h"),
                rotation: try c.opt("rotation") ?? 0, asset: try c.req("asset"), meta: try c.meta()))
        case .math:
            self = .math(MathRecord(
                id: id, screen: try c.req("screen"), order: try c.req("order"), author: try c.opt("author") ?? .tutor,
                role: try c.req("role"), latex: try c.req("latex"), x: try c.req("x"), y: try c.req("y"),
                w: try c.req("w"), h: try c.req("h"), fontSize: try c.opt("fontSize") ?? 24, line: try c.opt("line"), meta: try c.meta()))
        case .graph:
            self = .graph(GraphRecord(
                id: id, screen: try c.req("screen"), order: try c.req("order"), author: try c.opt("author") ?? .tutor,
                x: try c.req("x"), y: try c.req("y"), w: try c.req("w"), h: try c.req("h"),
                functions: try c.opt("functions") ?? [], points: try c.opt("points") ?? [],
                window: try c.opt("window") ?? GraphWindow(), grid: try c.opt("grid") ?? true,
                title: try c.opt("title") ?? "", line: try c.opt("line"), meta: try c.meta()))
        case .mark:
            self = .mark(MarkRecord(
                id: id, screen: try c.req("screen"), kind: try c.req("kind"), target: try c.opt("target"),
                strokes: try c.opt("strokes") ?? [], why: try c.opt("why"), meta: try c.meta()))
        case .line:
            self = .line(LineRecord(
                id: id, screen: try c.req("screen"), strokes: try c.opt("strokes") ?? [], latex: try c.opt("latex") ?? "",
                verdict: try c.opt("verdict") ?? .none, problem: try c.opt("problem"), meta: try c.meta()))
        case .problem:
            self = .problem(ProblemRecord(
                id: id, screen: try c.req("screen"), lines: try c.opt("lines") ?? [], latex: try c.opt("latex"),
                origin: try c.opt("origin"), meta: try c.meta()))
        case nil:
            let all = try decoder.singleValueContainer().decode([String: JSONValue].self)
            self = .unknown(UnknownRecord(id: id, type: type, json: all))
        }
    }

    public func encode(to encoder: Encoder) throws {
        if case .unknown(let u) = self {
            var c = encoder.singleValueContainer()
            try c.encode(u.json)
            return
        }
        var c = encoder.container(keyedBy: AnyKey.self)
        try c.put("id", id)
        try c.put("type", type!.rawValue)
        switch self {
        case .screen(let r):
            try c.put("order", r.order)
            try c.put("rect", r.rect)
            try c.putIf("name", r.name)
            try c.putMeta(r.meta)
        case .stroke(let r):
            try c.put("screen", r.screen)
            try c.put("order", r.order)
            try c.put("author", r.author)
            try c.put("color", r.color)
            try c.put("width", r.width)
            try c.put("pressure", r.pressure)
            try c.put("x", r.x)
            try c.put("y", r.y)
            try c.putUnless("rotation", r.rotation, 0)
            try c.put("points", PointCodec.encode(r.points))
            try c.putIf("start", r.start)
            try c.putUnless("closed", r.closed, false)
            try c.putUnless("fill", r.fill, .none)
            try c.putMeta(r.meta)
        case .shape(let r):
            try c.put("screen", r.screen)
            try c.put("order", r.order)
            try c.put("author", r.author)
            try c.put("kind", r.kind)
            try c.put("x", r.x)
            try c.put("y", r.y)
            try c.putUnless("rotation", r.rotation, 0)
            try c.putUnless("w", r.w, 0)
            try c.putUnless("h", r.h, 0)
            if !r.points.isEmpty { try c.put("points", r.points) }
            try c.put("color", r.color)
            try c.put("width", r.width)
            try c.putUnless("fill", r.fill, .none)
            try c.putMeta(r.meta)
        case .image(let r):
            try c.put("screen", r.screen)
            try c.put("order", r.order)
            try c.put("author", r.author)
            try c.put("x", r.x)
            try c.put("y", r.y)
            try c.put("w", r.w)
            try c.put("h", r.h)
            try c.putUnless("rotation", r.rotation, 0)
            try c.put("asset", r.asset)
            try c.putMeta(r.meta)
        case .math(let r):
            try c.put("screen", r.screen)
            try c.put("order", r.order)
            try c.put("author", r.author)
            try c.put("role", r.role)
            try c.put("latex", r.latex)
            try c.put("x", r.x)
            try c.put("y", r.y)
            try c.put("w", r.w)
            try c.put("h", r.h)
            try c.putUnless("fontSize", r.fontSize, 24)
            try c.putIf("line", r.line)
            try c.putMeta(r.meta)
        case .graph(let r):
            try c.put("screen", r.screen)
            try c.put("order", r.order)
            try c.put("author", r.author)
            try c.put("x", r.x)
            try c.put("y", r.y)
            try c.put("w", r.w)
            try c.put("h", r.h)
            try c.put("functions", r.functions)
            if !r.points.isEmpty { try c.put("points", r.points) }
            try c.put("window", r.window)
            try c.putUnless("grid", r.grid, true)
            try c.putUnless("title", r.title, "")
            try c.putIf("line", r.line)
            try c.putMeta(r.meta)
        case .mark(let r):
            try c.put("screen", r.screen)
            try c.put("kind", r.kind)
            try c.putIf("target", r.target)
            try c.put("strokes", r.strokes)
            try c.putIf("why", r.why)
            try c.putMeta(r.meta)
        case .line(let r):
            try c.put("screen", r.screen)
            try c.put("strokes", r.strokes)
            try c.put("latex", r.latex)
            try c.put("verdict", r.verdict)
            try c.putIf("problem", r.problem)
            try c.putMeta(r.meta)
        case .problem(let r):
            try c.put("screen", r.screen)
            try c.put("lines", r.lines)
            try c.putIf("latex", r.latex)
            try c.putIf("origin", r.origin)
            try c.putMeta(r.meta)
        case .unknown:
            break
        }
    }
}
