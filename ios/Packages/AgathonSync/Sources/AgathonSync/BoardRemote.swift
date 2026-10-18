import AgathonKit
import Foundation

/// What a version-checked write came back with (the web's `PersistResult`).
public enum PersistResult: Equatable, Sendable {
    /// written; the version the trigger bumped the row to
    case ok(version: Int)
    /// the row moved on (another device saved first): fetch, merge, write again
    case conflict
    case failed(PersistFailure, message: String?)
}

public enum PersistFailure: String, Sendable, Equatable {
    /// no network (retried with backoff)
    case offline
    /// no answer in time, or the database's statement timeout (retried)
    case timeout
    /// over the database's 8 MB cap (refused until the board shrinks)
    case tooLarge
    /// the board is gone (deleted, or not ours): stop
    case gone
    /// anything else (retried)
    case other
    /// the database cannot hold the app's board (no `doc` column: the 20261017000000_agathon_doc
    /// migration is not applied there yet): never retried; edits stay on this device
    case unsupported
}

/// What the app writes: the document's JSON bytes, the thumbnail, the time.
public struct BoardWrite: Sendable {
    public enum Preview: Sendable, Equatable {
        /// leave the stored thumbnail
        case keep
        /// nothing left on the board: clear it
        case clear
        /// a `data:image/jpeg;base64,…` URL within `BoardThumbnail.maxChars`
        case set(String)
    }

    public var doc: Data
    public var preview: Preview
    public var updatedAt: Date

    public init(doc: Data, preview: Preview = .keep, updatedAt: Date = Date()) {
        self.doc = doc
        self.preview = preview
        self.updatedAt = updatedAt
    }

    /// The PATCH body: `{"doc":<the document>,"updated_at":…,"preview":…}`, the document spliced in as
    /// its bytes (never re-encoded).
    public func body() -> Data {
        var out = Data("{\"doc\":".utf8)
        out.append(doc)
        let stamp = ISO8601DateFormatter.withFractions.string(from: updatedAt)
        out.append(Data(",\"updated_at\":\"\(stamp)\"".utf8))
        switch preview {
        case .keep: break
        case .clear: out.append(Data(",\"preview\":null".utf8))
        case .set(let url):
            let quoted = (try? JSONEncoder().encode(url)) ?? Data("null".utf8)
            out.append(Data(",\"preview\":".utf8))
            out.append(quoted)
        }
        out.append(Data("}".utf8))
        return out
    }
}

extension ISO8601DateFormatter {
    static let withFractions: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
}

/// A board as the server has it.
public struct RemoteBoard: Sendable {
    public enum Body: Sendable {
        /// the Agathon document (current: written after the last `data` write)
        case doc(Data)
        /// the web's tldraw board (`data`), to convert
        case tldraw(Data)
        /// a new board: nothing in either column (`data` is `{}`)
        case empty
    }

    public var version: Int
    public var body: Body
    /// The database has the app's `doc` column. False on a database before the migration
    /// (production until the owner applies it): the board opens from `data`, and nothing is written.
    public var docColumn: Bool

    public init(version: Int, body: Body, docColumn: Bool = true) {
        self.version = version
        self.body = body
        self.docColumn = docColumn
    }
}

/// The `whiteboards` row, read and written as the user (RLS).
public protocol BoardRemote: Sendable {
    /// The board as stored, or nil when it is gone (deleted, or not visible to this user).
    func fetch(boardId: String) async throws -> RemoteBoard?
    /// `UPDATE whiteboards SET doc, preview, updated_at WHERE id AND version = expected RETURNING version`.
    /// Cancelling the task cancels the request.
    func persist(boardId: String, write: BoardWrite, expectedVersion: Int?) async -> PersistResult
}

/// `BoardRemote` over PostgREST.
public struct PostgrestBoardRemote: BoardRemote {
    public let connection: SupabaseConnection
    static let table = "rest/v1/whiteboards"

    public init(connection: SupabaseConnection) {
        self.connection = connection
    }

    public func fetch(boardId: String) async throws -> RemoteBoard? {
        // the doc first (with the version it was written at); the tldraw data only when the doc is not the board
        let (data, response) = try await connection.send(
            "GET", Self.table, query: [.init(name: "id", value: "eq.\(boardId)"), .init(name: "select", value: "version,doc_version,doc")],
            headers: ["Accept": "application/vnd.pgrst.object+json"])
        if response.statusCode == 406 { return nil } // PGRST116: no row
        if response.statusCode == 400, Self.isMissingColumn(PostgrestError(data)) {
            // a database before the doc columns: the tldraw board is the board, and it cannot be saved
            return try await fetchData(boardId, docColumn: false)
        }
        try Self.check(data, response)
        let fields = try TopLevelJSON.fields(of: data)
        guard let version = fields.int("version") else { throw RemoteError.unreadable("no version") }
        if let dv = fields.int("doc_version"), dv >= version, let doc = fields.raw("doc"), !TopLevelJSON.isNull(doc) {
            return RemoteBoard(version: version, body: .doc(doc))
        }
        return try await fetchData(boardId)
    }

    /// Postgres's undefined column (42703, a select) or PostgREST's unknown column (PGRST204, a write).
    static func isMissingColumn(_ e: PostgrestError?) -> Bool {
        guard let e else { return false }
        return e.code == "42703" || e.code == "PGRST204"
    }

    func fetchData(_ boardId: String, docColumn: Bool = true) async throws -> RemoteBoard? {
        let (data, response) = try await connection.send(
            "GET", Self.table, query: [.init(name: "id", value: "eq.\(boardId)"), .init(name: "select", value: "version,data")],
            headers: ["Accept": "application/vnd.pgrst.object+json"])
        if response.statusCode == 406 { return nil }
        try Self.check(data, response)
        let fields = try TopLevelJSON.fields(of: data)
        guard let version = fields.int("version") else { throw RemoteError.unreadable("no version") }
        guard let raw = fields.raw("data"), !TopLevelJSON.isNull(raw), !TopLevelJSON.isEmptyObject(raw) else {
            return RemoteBoard(version: version, body: .empty, docColumn: docColumn)
        }
        return RemoteBoard(version: version, body: .tldraw(raw), docColumn: docColumn)
    }

    public func persist(boardId: String, write: BoardWrite, expectedVersion: Int?) async -> PersistResult {
        var query: [URLQueryItem] = [.init(name: "id", value: "eq.\(boardId)")]
        if let expectedVersion { query.append(.init(name: "version", value: "eq.\(expectedVersion)")) }
        query.append(.init(name: "select", value: "version"))
        do {
            let (data, response) = try await connection.send(
                "PATCH", Self.table, query: query,
                headers: ["Content-Type": "application/json", "Prefer": "return=representation", "Accept": "application/json"],
                body: write.body())
            if !(200..<300).contains(response.statusCode) {
                return Self.failure(PostgrestError(data), status: response.statusCode, body: data)
            }
            let rows = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] ?? []
            if let first = rows.first {
                if let v = first["version"] as? Int { return .ok(version: v) }
                if let s = first["version"] as? String, let v = Int(s) { return .ok(version: v) }
                return .failed(.other, message: "Saved, but the database returned no version")
            }
            // no row matched: the version moved on (conflict), or the board is gone
            guard expectedVersion != nil else { return .failed(.gone, message: nil) }
            do {
                return try await exists(boardId) ? .conflict : .failed(.gone, message: nil)
            } catch {
                return .conflict // could not tell: fetch and merge rather than give up
            }
        } catch {
            return Self.failure(thrown: error)
        }
    }

    func exists(_ boardId: String) async throws -> Bool {
        let (data, response) = try await connection.send(
            "GET", Self.table, query: [.init(name: "id", value: "eq.\(boardId)"), .init(name: "select", value: "version")])
        try Self.check(data, response)
        let rows = (try? JSONSerialization.jsonObject(with: data)) as? [Any] ?? []
        return !rows.isEmpty
    }

    // MARK: errors

    public enum RemoteError: Error, Equatable, LocalizedError {
        case http(status: Int, code: String?, message: String?)
        case unreadable(String)

        public var errorDescription: String? {
            switch self {
            case let .http(status, code, message): return "\(message ?? "HTTP \(status)")\(code.map { " (\($0))" } ?? "")"
            case let .unreadable(why): return "The board could not be read (\(why))."
            }
        }
    }

    static func check(_ data: Data, _ response: HTTPURLResponse) throws {
        guard (200..<300).contains(response.statusCode) else {
            let e = PostgrestError(data)
            throw RemoteError.http(status: response.statusCode, code: e?.code, message: e?.message)
        }
    }

    /// A PostgREST error → how the queue reacts (the web's `persistErrorResult`).
    static func failure(_ e: PostgrestError?, status: Int, body: Data) -> PersistResult {
        let code = e?.code ?? ""
        let message = e?.message ?? String(decoding: body.prefix(200), as: UTF8.self)
        if code == "57014" || message.localizedCaseInsensitiveContains("statement timeout") { return .failed(.timeout, message: nil) }
        if code == "23514" { return .failed(.tooLarge, message: nil) }
        if isMissingColumn(e) { return .failed(.unsupported, message: nil) }
        if code.hasPrefix("PGRST0") || status == 502 || status == 503 || status == 504 { return .failed(.offline, message: nil) }
        return .failed(.other, message: code.isEmpty ? message : "\(message) (code: \(code))")
    }

    /// A thrown error (the transport) → how the queue reacts.
    static func failure(thrown error: Error) -> PersistResult {
        if error is CancellationError { return .failed(.timeout, message: nil) }
        if let u = error as? URLError {
            switch u.code {
            case .cancelled, .timedOut: return .failed(.timeout, message: nil)
            case .notConnectedToInternet, .networkConnectionLost, .cannotFindHost, .cannotConnectToHost, .dnsLookupFailed,
                 .dataNotAllowed, .internationalRoamingOff, .secureConnectionFailed:
                return .failed(.offline, message: nil)
            default: return .failed(.other, message: u.localizedDescription)
            }
        }
        return .failed(.other, message: error.localizedDescription)
    }
}

/// The members of a JSON object, each as its raw bytes, found without parsing the values: a board's
/// document comes back from PostgREST as one member of `{"version":…,"doc":{…}}` and is handed to its
/// own decoder as it is.
enum TopLevelJSON {
    struct Fields {
        var bytes: [UInt8]
        var ranges: [String: Range<Int>]

        func raw(_ key: String) -> Data? { ranges[key].map { Data(bytes[$0]) } }

        func int(_ key: String) -> Int? {
            guard let raw = raw(key) else { return nil }
            let s = String(decoding: raw, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(in: CharacterSet(charactersIn: "\""))
            return Int(s) ?? Double(s).map { Int($0) }
        }
    }

    enum ScanError: Error { case notAnObject, truncated }

    static func isNull(_ raw: Data) -> Bool {
        String(decoding: raw, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines) == "null"
    }

    static func isEmptyObject(_ raw: Data) -> Bool {
        String(decoding: raw, as: UTF8.self).filter { !$0.isWhitespace } == "{}"
    }

    static func fields(of data: Data) throws -> Fields {
        let b = [UInt8](data)
        var i = 0
        func skipSpace() { while i < b.count, b[i] == 0x20 || b[i] == 0x0A || b[i] == 0x0D || b[i] == 0x09 { i += 1 } }
        func skipString() throws {
            // at the opening quote
            i += 1
            while i < b.count {
                if b[i] == 0x5C { i += 2; continue } // backslash: skip the escaped byte
                if b[i] == 0x22 { i += 1; return }
                i += 1
            }
            throw ScanError.truncated
        }
        func skipValue() throws {
            skipSpace()
            guard i < b.count else { throw ScanError.truncated }
            switch b[i] {
            case 0x22: try skipString()
            case 0x7B, 0x5B:
                var depth = 0
                while i < b.count {
                    switch b[i] {
                    case 0x22: try skipString(); continue
                    case 0x7B, 0x5B: depth += 1
                    case 0x7D, 0x5D:
                        depth -= 1
                        if depth == 0 { i += 1; return }
                    default: break
                    }
                    i += 1
                }
                throw ScanError.truncated
            default:
                while i < b.count, ![0x2C, 0x7D, 0x5D].contains(b[i]) { i += 1 }
            }
        }
        skipSpace()
        guard i < b.count, b[i] == 0x7B else { throw ScanError.notAnObject }
        i += 1
        var ranges: [String: Range<Int>] = [:]
        while true {
            skipSpace()
            guard i < b.count else { throw ScanError.truncated }
            if b[i] == 0x7D { break }
            if b[i] == 0x2C { i += 1; continue }
            guard b[i] == 0x22 else { throw ScanError.notAnObject }
            let keyStart = i
            try skipString()
            let keyData = Data(b[keyStart..<i])
            let key = (try? JSONDecoder().decode(String.self, from: keyData)) ?? ""
            skipSpace()
            guard i < b.count, b[i] == 0x3A else { throw ScanError.notAnObject }
            i += 1
            skipSpace()
            let start = i
            try skipValue()
            ranges[key] = start..<i
        }
        return Fields(bytes: b, ranges: ranges)
    }
}
