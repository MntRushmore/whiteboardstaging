import Foundation

// The picture tutor (Reed's hackathon system, sped up): a picture of the board goes up, the tutor's
// picture comes back to lay over it. Admin only for now. The contract (the server route is
// `src/app/api/board/draw`):
//
//     POST /api/board/draw   {image, mode, source, instructions?, boardId?, clientRunId}
//       200 application/x-ndjson, one object per line:
//         {"type":"status","stage":"reading","runId":"…"}
//         {"type":"status","stage":"drawing","instructions":"…"}
//         {"type":"none","reason":"…"}                 (the end: nothing to show)
//         {"type":"done","overlay":"data:image/png;base64,…","picture":"…","width":W,"height":H,
//          "instructions":"…","strokes":[{"points":[x0,y0,x1,y1,…],"width":w}],
//          "timings":{"tutorMs":n,"paintMs":n,"diffMs":n,"traceMs":n,"totalMs":n},"costUsd":n}
//         ({"type":"error"} only after a 200; refusals before the stream are plain JSON with their status:)
//         {"type":"error","message":"…","retryable":true|false}
//       401/404/503 not an admin (or off), 400 a bad body, 413 too big, 429 rate limited: `APIError.http`
//     `runId` (the first status line's, the server's) is what the outcome names; `clientRunId` is only logged.
//     `strokes` (≤ 400) may be empty.
//     POST /api/board/draw/outcome   {runId, outcome}  → 204
//
// `overlay` and `picture` are exactly the size of the image sent; `strokes` are in those pixels, in
// the order a hand would write them.

/// How much the picture tutor gives (Reed's modes; "Solve" is `answer`).
public enum BoardDrawMode: String, Codable, Sendable, CaseIterable {
    case feedback, suggest, answer
}

/// What started a run: the pause after the pen lifts, or the grown-up's "Draw now" (always draws).
public enum BoardDrawSource: String, Codable, Sendable {
    case auto, voice
}

public struct BoardDrawRequest: Encodable, Sendable, Equatable {
    /// `data:image/png;base64,…`
    public var image: String
    public var mode: BoardDrawMode
    public var source: BoardDrawSource
    public var instructions: String?
    public var boardId: String?
    public var clientRunId: String

    public init(png: Data, mode: BoardDrawMode, source: BoardDrawSource, instructions: String? = nil, boardId: String? = nil,
                clientRunId: String = UUID().uuidString.lowercased()) {
        image = "data:image/png;base64,\(png.base64EncodedString())"
        self.mode = mode
        self.source = source
        self.instructions = instructions
        self.boardId = boardId
        self.clientRunId = clientRunId
    }
}

public enum BoardDrawStage: String, Sendable, Equatable {
    case reading, drawing
}

/// One stroke of the tutor's picture, in the overlay's pixels: `[x0, y0, x1, y1, …]`.
public struct BoardDrawStroke: Sendable, Equatable, Codable {
    public var points: [Double]
    public var width: Double

    public init(points: [Double], width: Double) {
        self.points = points
        self.width = width
    }

    /// Its length in pixels (the reveal's pace).
    public var length: Double {
        var total = 0.0
        var i = 2
        while i + 1 < points.count {
            let dx = points[i] - points[i - 2], dy = points[i + 1] - points[i - 1]
            total += (dx * dx + dy * dy).squareRoot()
            i += 2
        }
        return total
    }
}

public struct BoardDrawTimings: Sendable, Equatable, Codable {
    public var tutorMs: Double?
    public var paintMs: Double?
    public var diffMs: Double?
    /// tracing the overlay into reveal strokes (in `totalMs`)
    public var traceMs: Double?
    public var totalMs: Double?

    public init(tutorMs: Double? = nil, paintMs: Double? = nil, diffMs: Double? = nil, traceMs: Double? = nil, totalMs: Double? = nil) {
        self.tutorMs = tutorMs
        self.paintMs = paintMs
        self.diffMs = diffMs
        self.traceMs = traceMs
        self.totalMs = totalMs
    }
}

/// The tutor's picture: `overlay` (only what it added, transparent elsewhere) and the whole `picture`.
public struct BoardDrawResult: Sendable, Equatable {
    public var overlay: Data
    public var picture: Data?
    public var width: Int
    public var height: Int
    public var instructions: String?
    public var strokes: [BoardDrawStroke]
    public var timings: BoardDrawTimings?
    public var costUsd: Double?

    public init(overlay: Data, picture: Data? = nil, width: Int, height: Int, instructions: String? = nil, strokes: [BoardDrawStroke] = [],
                timings: BoardDrawTimings? = nil, costUsd: Double? = nil) {
        self.overlay = overlay
        self.picture = picture
        self.width = width
        self.height = height
        self.instructions = instructions
        self.strokes = strokes
        self.timings = timings
        self.costUsd = costUsd
    }
}

public enum BoardDrawEvent: Sendable, Equatable {
    case status(BoardDrawStage, runId: String?, instructions: String?)
    case none(reason: String?)
    case done(BoardDrawResult)
    case error(message: String, retryable: Bool)

    /// The stream ends after it.
    public var isTerminal: Bool {
        switch self {
        case .status: return false
        case .none, .done, .error: return true
        }
    }
}

public enum BoardDrawOutcome: String, Codable, Sendable {
    case accepted, rejected, cancelled, shown
}

// MARK: - NDJSON

/// Cuts a byte stream into lines. Chunks may split a line anywhere (a `done` line carries a picture
/// in base64, far longer than one chunk); a line is handed back only once its newline is in.
public struct NDJSONLineBuffer: Sendable {
    private var pending = Data()

    public init() {}

    /// The whole lines `chunk` finishes (without their newline; blank lines dropped).
    public mutating func push(_ chunk: Data) -> [Data] {
        pending.append(chunk)
        var lines: [Data] = []
        while let nl = pending.firstIndex(of: 0x0A) {
            var line = pending[pending.startIndex..<nl]
            if line.last == 0x0D { line = line.dropLast() }
            if !line.allSatisfy({ $0 == 0x20 || $0 == 0x09 }) { lines.append(Data(line)) }
            pending = Data(pending[pending.index(after: nl)...])
        }
        return lines
    }

    /// What is left when the stream ends (a last line without its newline).
    public mutating func finish() -> [Data] {
        defer { pending = Data() }
        let rest = pending.filter { $0 != 0x0D }
        return rest.allSatisfy({ $0 == 0x20 || $0 == 0x09 || $0 == 0x0A }) ? [] : [Data(rest)]
    }
}

public enum BoardDrawDecoding {
    private struct Line: Decodable {
        var type: String
        var stage: String?
        var runId: String?
        var instructions: String?
        var reason: String?
        var overlay: String?
        var picture: String?
        var width: Double?
        var height: Double?
        var strokes: [BoardDrawStroke]?
        var timings: BoardDrawTimings?
        var costUsd: Double?
        var message: String?
        var retryable: Bool?
    }

    /// One line as an event; nil for a line this app does not know (a newer server's) or can't read.
    public static func event(_ line: Data) -> BoardDrawEvent? {
        guard let l = try? JSONDecoder().decode(Line.self, from: line) else { return nil }
        switch l.type {
        case "status":
            guard let stage = l.stage.flatMap(BoardDrawStage.init(rawValue:)) else { return nil }
            return .status(stage, runId: l.runId, instructions: l.instructions)
        case "none":
            return .none(reason: l.reason)
        case "done":
            guard let overlay = l.overlay.flatMap(dataURLBytes) else {
                return .error(message: "The picture didn't come through.", retryable: true)
            }
            return .done(BoardDrawResult(
                overlay: overlay, picture: l.picture.flatMap(dataURLBytes), width: Int(l.width ?? 0), height: Int(l.height ?? 0),
                instructions: l.instructions, strokes: l.strokes ?? [], timings: l.timings, costUsd: l.costUsd))
        case "error":
            return .error(message: l.message ?? "Something went wrong.", retryable: l.retryable ?? false)
        default:
            return nil
        }
    }

    /// The bytes of a `data:…;base64,` URL.
    public static func dataURLBytes(_ s: String) -> Data? {
        guard s.hasPrefix("data:"), let comma = s.firstIndex(of: ",") else { return nil }
        return Data(base64Encoded: String(s[s.index(after: comma)...]), options: .ignoreUnknownCharacters)
    }
}

// MARK: - The client

/// `POST /api/board/draw` as a stream of events as their lines arrive, and the outcome report.
///
/// - a non-2xx before the stream throws `APIError.http` (a 401 refreshes the session once first)
/// - nothing arriving for `stallTimeout` throws `APIError.timeout`
/// - a stream that closes before `none`, `done` or `error` throws `APIError.incomplete`
/// - stopping the iteration (or cancelling its task) cancels the request (its URLSession task)
public final class BoardDrawClient: Sendable {
    public static let path = "/api/board/draw"
    public static let outcomePath = "/api/board/draw/outcome"

    public let api: APIClient
    public let stallTimeout: Duration

    public init(api: APIClient, stallTimeout: Duration = .seconds(60)) {
        self.api = api
        self.stallTimeout = stallTimeout
    }

    public func draw(_ request: BoardDrawRequest) -> AsyncThrowingStream<BoardDrawEvent, Error> {
        let api = self.api
        let stall = stallTimeout
        let body: Data
        do {
            body = try APIClient.encoder.encode(request)
        } catch {
            return AsyncThrowingStream { $0.finish(throwing: error) }
        }
        let (stream, continuation) = AsyncThrowingStream<BoardDrawEvent, Error>.makeStream()
        let task = Task {
            do {
                let ended = try await Self.run(api: api, body: body, stallTimeout: stall) { event in
                    if case .terminated = continuation.yield(event) { return false }
                    return !event.isTerminal
                }
                if !ended && !Task.isCancelled {
                    continuation.finish(throwing: APIError.incomplete)
                } else {
                    continuation.finish()
                }
            } catch is CancellationError {
                continuation.finish()
            } catch {
                continuation.finish(throwing: APIError.wrap(error))
            }
        }
        continuation.onTermination = { _ in task.cancel() }
        return stream
    }

    /// Tells the server what became of a run's picture.
    public func report(runId: String, outcome: BoardDrawOutcome) async throws {
        struct Body: Encodable { var runId: String; var outcome: BoardDrawOutcome }
        let _: EmptyResponse = try await api.post(Self.outcomePath, body: Body(runId: runId, outcome: outcome))
    }

    /// Reads the stream, handing each event to `onEvent` until it answers false (then returns true) or
    /// the stream ends (false). A watchdog fails the read after `stallTimeout` of silence.
    static func run(api: APIClient, body: Data, stallTimeout: Duration, onEvent: @escaping @Sendable (BoardDrawEvent) -> Bool) async throws -> Bool {
        let activity = ActivityClock()
        return try await withThrowingTaskGroup(of: Bool.self) { group in
            group.addTask {
                var attempt = 0
                var opened: (HTTPURLResponse, AsyncThrowingStream<Data, Error>)
                while true {
                    attempt += 1
                    let request = try await api.makeRequest(.post, path, body: body, accept: "application/x-ndjson")
                    opened = try await api.transport.stream(for: request)
                    activity.touch()
                    if (200 ..< 300).contains(opened.0.statusCode) { break }
                    var data = Data()
                    for try await chunk in opened.1 {
                        activity.touch()
                        data.append(chunk)
                        if data.count > 64 * 1024 { break }
                    }
                    if attempt == 1, await api.refreshedAfterUnauthorized(status: opened.0.statusCode, body: data) { continue }
                    throw APIError.http(HTTPFailure(response: opened.0, body: data))
                }
                var lines = NDJSONLineBuffer()
                for try await chunk in opened.1 {
                    activity.touch()
                    for line in lines.push(chunk) {
                        guard let event = BoardDrawDecoding.event(line) else { continue }
                        if !onEvent(event) { return true }
                    }
                }
                try Task.checkCancellation()
                for line in lines.finish() {
                    guard let event = BoardDrawDecoding.event(line) else { continue }
                    if !onEvent(event) { return true }
                }
                return false
            }
            group.addTask {
                let tick = max(.milliseconds(10), min(.seconds(1), stallTimeout / 10))
                while true {
                    try await Task.sleep(for: tick)
                    if activity.idle() >= stallTimeout { throw APIError.timeout }
                }
            }
            defer { group.cancelAll() }
            return try await group.next() ?? false
        }
    }
}
