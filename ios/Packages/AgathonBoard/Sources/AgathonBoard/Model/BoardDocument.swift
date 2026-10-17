import Foundation

/// A whole board: every record, keyed by id. A plain value (Sendable), so it can be decoded and
/// encoded off the main thread; the live board is a `BoardStore`.
///
/// JSON (schema v1, docs/BOARD-FORMAT.md):
///
///     {"format":"agathon.board","schema":1,"records":{"<id>":{…},…},"meta":{…}}
public struct BoardDocument: Equatable, Sendable {
    public static let format = "agathon.board"
    /// The schema this build writes. A document with a higher one is refused (`BoardFormatError.newerSchema`):
    /// an older app must never save over a newer app's board.
    public static let currentSchema = 1

    public var records: [RecordID: BoardRecord]
    public var meta: Meta

    public init(records: [RecordID: BoardRecord] = [:], meta: Meta = [:]) {
        self.records = records
        self.meta = meta
    }

    public init<S: Sequence>(_ records: S, meta: Meta = [:]) where S.Element == BoardRecord {
        var map: [RecordID: BoardRecord] = [:]
        for r in records { map[r.id] = r }
        self.init(records: map, meta: meta)
    }

    /// A board with one empty screen.
    public static func blank() -> BoardDocument {
        BoardDocument([.screen(ScreenRecord(order: .first))])
    }

    // MARK: reading

    public var screens: [ScreenRecord] {
        records.values.compactMap(\.screen).sorted { ($0.order, $0.id) < ($1.order, $1.id) }
    }

    public var strokes: [StrokeRecord] { records.values.compactMap(\.stroke) }

    /// Drawn records of a screen, bottom to top.
    public func drawables(on screen: RecordID) -> [BoardRecord] {
        records.values
            .filter { $0.isDrawable && $0.screenID == screen }
            .sorted { ($0.order!, $0.id) < ($1.order!, $1.id) }
    }

    // MARK: JSON

    public enum BoardFormatError: Error, Equatable {
        case notABoard
        case newerSchema(Int)
        case noMigration(from: Int)
    }

    /// The JSON bytes. `sortedKeys` makes them deterministic (same document, same bytes).
    public func encoded(sortedKeys: Bool = true) throws -> Data {
        let enc = JSONEncoder()
        enc.outputFormatting = sortedKeys ? [.sortedKeys, .withoutEscapingSlashes] : [.withoutEscapingSlashes]
        return try enc.encode(Envelope(format: Self.format, schema: Self.currentSchema, records: records, meta: meta.isEmpty ? nil : meta))
    }

    /// Reads a board, migrating an older schema first (`migrations`).
    public static func decode(_ data: Data, migrations: BoardMigrations = .standard) throws -> BoardDocument {
        let dec = JSONDecoder()
        let head: Header
        do {
            head = try dec.decode(Header.self, from: data)
        } catch {
            throw BoardFormatError.notABoard
        }
        guard head.format == format else { throw BoardFormatError.notABoard }
        if head.schema > migrations.current { throw BoardFormatError.newerSchema(head.schema) }
        var bytes = data
        if head.schema < migrations.current {
            var json = try JSONValue.parse(data).objectValue ?? [:]
            try migrations.migrate(&json, from: head.schema)
            bytes = try JSONEncoder().encode(json)
        }
        let env = try dec.decode(Envelope.self, from: bytes)
        return BoardDocument(records: env.records, meta: env.meta ?? [:])
    }

    private struct Header: Decodable {
        var format: String
        var schema: Int
    }

    private struct Envelope: Codable {
        var format: String
        var schema: Int
        var records: [RecordID: BoardRecord]
        var meta: Meta?

        enum CodingKeys: String, CodingKey { case format, schema, records, meta }

        init(format: String, schema: Int, records: [RecordID: BoardRecord], meta: Meta?) {
            self.format = format
            self.schema = schema
            self.records = records
            self.meta = meta
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            format = try c.decode(String.self, forKey: .format)
            schema = try c.decode(Int.self, forKey: .schema)
            meta = try c.decodeIfPresent(Meta.self, forKey: .meta)
            // keyed by id: decode as [String: record] (a [RecordID: …] dictionary would want an array)
            let raw = try c.decode([String: BoardRecord].self, forKey: .records)
            var map: [RecordID: BoardRecord] = [:]
            map.reserveCapacity(raw.count)
            for (_, r) in raw { map[r.id] = r }
            records = map
        }

        func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encode(format, forKey: .format)
            try c.encode(schema, forKey: .schema)
            var raw: [String: BoardRecord] = [:]
            raw.reserveCapacity(records.count)
            for (id, r) in records { raw[id.rawValue] = r }
            try c.encode(raw, forKey: .records)
            try c.encodeIfPresent(meta, forKey: .meta)
        }
    }
}

/// The migration hook: steps that each turn the raw JSON of schema N into schema N + 1. Run before
/// the typed decode, so the records types only ever know the current schema.
///
/// Adding schema 2: bump `BoardDocument.currentSchema`, add a step `1: { json in … }` to `standard`
/// that rewrites the v1 JSON into v2 (and sets nothing else: `migrate` writes `schema`), document
/// it in docs/BOARD-FORMAT.md, and keep a v1 fixture in the tests.
public struct BoardMigrations: Sendable {
    public typealias Step = @Sendable (inout [String: JSONValue]) throws -> Void

    /// the schema the steps lead to
    public var current: Int
    /// `steps[n]` migrates schema n to n + 1
    public var steps: [Int: Step]

    public init(current: Int, steps: [Int: Step]) {
        self.current = current
        self.steps = steps
    }

    /// The migrations this build ships: none yet (v1 is the first schema).
    public static let standard = BoardMigrations(current: BoardDocument.currentSchema, steps: [:])

    public func migrate(_ json: inout [String: JSONValue], from schema: Int) throws {
        var v = schema
        while v < current {
            guard let step = steps[v] else { throw BoardDocument.BoardFormatError.noMigration(from: v) }
            try step(&json)
            v += 1
            json["schema"] = .number(Double(v))
        }
    }
}
